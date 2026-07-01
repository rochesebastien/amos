from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..schemas import EnabledModelOut, SettingsIn, SettingsOut
from ..services import config as cfg
from ..services import llm

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def read_settings(session: Session = Depends(get_session)) -> SettingsOut:
    s = cfg.all_settings(session)
    enabled = [
        EnabledModelOut(
            id=m["id"],
            base_url=m.get("base_url", ""),
            has_api_key=bool(m.get("api_key")),  # mask the per-model key
        )
        for m in cfg.parse_enabled_models(s.get("enabled_models", "[]"))
    ]
    # keep the in-process proxy in sync (covers restarts and data imports)
    cfg.refresh_proxy(session)
    return SettingsOut(
        llm_base_url=s.get("llm_base_url", ""),
        llm_model=s.get("llm_model", ""),
        has_api_key=bool(s.get("llm_api_key")),
        max_tool_iterations=int(s.get("max_tool_iterations", "6") or 6),
        language=s.get("language", "en") or "en",
        http_proxy=s.get("http_proxy", "") or "",
        enabled_models=enabled,
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
    if body.language is not None:
        cfg.set_setting(session, "language", body.language.strip() or "en")
    if body.http_proxy is not None:
        # empty string clears the proxy (direct connection)
        cfg.set_setting(session, "http_proxy", body.http_proxy.strip())
    if body.enabled_models is not None:
        existing = {m["id"]: m for m in cfg.get_enabled_models(session)}
        out: list[dict] = []
        seen: set[str] = set()
        for m in body.enabled_models:
            mid = m.id.strip()
            if not mid or mid in seen:
                continue
            seen.add(mid)
            prev = existing.get(mid, {})
            base_url = (m.base_url if m.base_url is not None else prev.get("base_url", "")) or ""
            # None keeps the stored key; "" clears it; a value replaces it
            api_key = prev.get("api_key", "") if m.api_key is None else m.api_key
            out.append({"id": mid, "base_url": base_url.strip(), "api_key": api_key})
        cfg.set_setting(session, "enabled_models", json.dumps(out))
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
