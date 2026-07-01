from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import MCP, ProjectMCPLink
from ..schemas import MCPIn, MCPOut, MCPTestResult, ParseOpenAPIIn, ToolPreview
from ..services import mcp_runtime, openapi_tools

router = APIRouter(prefix="/api/mcps", tags=["mcps"])


def _project_ids(session: Session, mcp_id: int) -> list[int]:
    rows = session.exec(select(ProjectMCPLink).where(ProjectMCPLink.mcp_id == mcp_id)).all()
    return [r.project_id for r in rows]


def _set_links(session: Session, mcp_id: int, project_ids: list[int]) -> None:
    existing = session.exec(select(ProjectMCPLink).where(ProjectMCPLink.mcp_id == mcp_id)).all()
    for row in existing:
        session.delete(row)
    for pid in dict.fromkeys(project_ids):
        session.add(ProjectMCPLink(project_id=pid, mcp_id=mcp_id))


async def _list_tools(m: MCP) -> list[dict]:
    """Best-effort list of tools exposed by an MCP; empty if it can't be reached."""
    if not m.enabled:
        return []
    try:
        return await mcp_runtime.list_mcp_tools(m)
    except Exception:
        return []


def _to_out(session: Session, m: MCP, tools: list[dict] | None = None) -> MCPOut:
    tools = tools or []
    disabled = set(m.disabled_tools or [])
    previews = [
        ToolPreview(
            name=t["name"],
            description=t.get("description", ""),
            parameters=t.get("parameters", {}),
        )
        for t in tools
    ]
    active = sum(1 for t in tools if t["name"] not in disabled)
    return MCPOut(
        id=m.id,
        name=m.name,
        description=m.description,
        type=m.type,
        enabled=m.enabled,
        disabled_tools=list(m.disabled_tools or []),
        config=m.config,
        project_ids=_project_ids(session, m.id),
        tools=previews,
        tool_count=active,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.get("", response_model=list[MCPOut])
async def list_mcps(session: Session = Depends(get_session)) -> list[MCPOut]:
    mcps = session.exec(select(MCP).order_by(MCP.updated_at.desc())).all()
    tools = await asyncio.gather(*(_list_tools(m) for m in mcps))
    return [_to_out(session, m, ts) for m, ts in zip(mcps, tools)]


@router.post("", response_model=MCPOut)
async def create_mcp(body: MCPIn, session: Session = Depends(get_session)) -> MCPOut:
    m = MCP(
        name=body.name.strip() or "Untitled MCP",
        description=body.description,
        type=body.type,
        enabled=body.enabled,
        disabled_tools=body.disabled_tools,
        config=body.config,
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    _set_links(session, m.id, body.project_ids)
    session.commit()
    return _to_out(session, m, await _list_tools(m))


@router.get("/{mcp_id}", response_model=MCPOut)
async def get_mcp(mcp_id: int, session: Session = Depends(get_session)) -> MCPOut:
    m = session.get(MCP, mcp_id)
    if not m:
        raise HTTPException(404, "MCP not found")
    return _to_out(session, m, await _list_tools(m))


@router.put("/{mcp_id}", response_model=MCPOut)
async def update_mcp(mcp_id: int, body: MCPIn, session: Session = Depends(get_session)) -> MCPOut:
    m = session.get(MCP, mcp_id)
    if not m:
        raise HTTPException(404, "MCP not found")
    m.name = body.name.strip() or m.name
    m.description = body.description
    m.type = body.type
    m.enabled = body.enabled
    m.disabled_tools = body.disabled_tools
    m.config = body.config
    m.updated_at = datetime.now(timezone.utc)
    session.add(m)
    _set_links(session, m.id, body.project_ids)
    session.commit()
    session.refresh(m)
    return _to_out(session, m, await _list_tools(m))


@router.delete("/{mcp_id}")
def delete_mcp(mcp_id: int, session: Session = Depends(get_session)) -> dict:
    m = session.get(MCP, mcp_id)
    if not m:
        raise HTTPException(404, "MCP not found")
    for row in session.exec(select(ProjectMCPLink).where(ProjectMCPLink.mcp_id == mcp_id)).all():
        session.delete(row)
    session.delete(m)
    session.commit()
    return {"ok": True}


@router.post("/{mcp_id}/test", response_model=MCPTestResult)
async def test_mcp(mcp_id: int, session: Session = Depends(get_session)) -> MCPTestResult:
    m = session.get(MCP, mcp_id)
    if not m:
        raise HTTPException(404, "MCP not found")
    try:
        tools = await mcp_runtime.list_mcp_tools(m)
    except Exception as exc:
        return MCPTestResult(ok=False, error=f"{type(exc).__name__}: {exc}")
    return MCPTestResult(
        ok=True,
        tools=[ToolPreview(name=t["name"], description=t.get("description", ""), parameters=t.get("parameters", {})) for t in tools],
    )


@router.post("/preview/openapi", response_model=MCPTestResult)
async def preview_openapi(body: ParseOpenAPIIn) -> MCPTestResult:
    """Parse an OpenAPI spec (inline or by URL) and preview generated tools."""
    config = {}
    if body.spec is not None:
        config["spec"] = body.spec
    if body.spec_url:
        config["spec_url"] = body.spec_url
    if body.base_url:
        config["base_url"] = body.base_url
    try:
        spec = await openapi_tools.load_spec(config)
        tools = openapi_tools.build_tools(spec)
    except Exception as exc:
        return MCPTestResult(ok=False, error=f"{type(exc).__name__}: {exc}")
    return MCPTestResult(
        ok=True,
        tools=[ToolPreview(name=t["name"], description=t.get("description", ""), parameters=t.get("parameters", {})) for t in tools],
    )
