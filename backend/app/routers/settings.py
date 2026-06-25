from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..schemas import SettingsIn, SettingsOut
from ..services import config as cfg
from ..services import llm

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def read_settings(session: Session = Depends(get_session)) -> SettingsOut:
    s = cfg.all_settings(session)
    return SettingsOut(
        llm_base_url=s.get("llm_base_url", ""),
        llm_model=s.get("llm_model", ""),
        has_api_key=bool(s.get("llm_api_key")),
        max_tool_iterations=int(s.get("max_tool_iterations", "6") or 6),
    )


@router.put("", response_model=SettingsOut)
def update_settings(body: SettingsIn, session: Session = Depends(get_session)) -> SettingsOut:
    if body.llm_base_url is not None:
        cfg.set_setting(session, "llm_base_url", body.llm_base_url.strip())
    if body.llm_model is not None:
        cfg.set_setting(session, "llm_model", body.llm_model.strip())
    if body.llm_api_key is not None:
        # empty string clears the key
        cfg.set_setting(session, "llm_api_key", body.llm_api_key)
    if body.max_tool_iterations is not None:
        cfg.set_setting(session, "max_tool_iterations", str(max(1, min(20, body.max_tool_iterations))))
    session.commit()
    return read_settings(session)


@router.get("/models")
async def discover_models(session: Session = Depends(get_session)) -> dict:
    llm_cfg = cfg.get_llm_config(session)
    if not llm_cfg.configured:
        raise HTTPException(status_code=400, detail="Set the LLM base URL first")
    try:
        models = await llm.list_models(llm_cfg)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach the gateway: {exc}") from exc
    return {"models": models}
