from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..db import engine
from ..models import MCP, Conversation, Message, Project, ProjectMCPLink
from ..schemas import ChatIn
from ..services import config as cfg
from ..services import llm, mcp_runtime

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def _to_openai_messages(system_prompt: str, msgs: list[Message]) -> list[dict]:
    out: list[dict] = []
    if system_prompt.strip():
        out.append({"role": "system", "content": system_prompt})
    for m in msgs:
        if m.role == "user":
            out.append({"role": "user", "content": m.content})
        elif m.role == "assistant":
            entry: dict = {"role": "assistant", "content": m.content or ""}
            if m.extra.get("tool_calls"):
                entry["tool_calls"] = m.extra["tool_calls"]
            out.append(entry)
        elif m.role == "tool":
            out.append(
                {
                    "role": "tool",
                    "tool_call_id": m.extra.get("tool_call_id", ""),
                    "content": m.content,
                }
            )
    return out


async def _event_stream(body: ChatIn) -> AsyncIterator[str]:
    with Session(engine) as session:
        # resolve / create conversation
        if body.conversation_id:
            conv = session.get(Conversation, body.conversation_id)
            if not conv:
                yield _sse({"type": "error", "error": "conversation not found"})
                return
        else:
            conv = Conversation(title="New chat", project_id=body.project_id)
            session.add(conv)
            session.commit()
            session.refresh(conv)

        yield _sse({"type": "start", "conversation_id": conv.id, "project_id": conv.project_id})

        # project context (pre-prompt + model + attached MCPs)
        project = session.get(Project, conv.project_id) if conv.project_id else None
        system_prompt = project.system_prompt if project else ""

        # set a title from the first user message (check BEFORE inserting it)
        had_messages = session.exec(
            select(Message).where(Message.conversation_id == conv.id).limit(1)
        ).first()
        if conv.title in ("New chat", "") and not had_messages:
            conv.title = body.message.strip()[:48] or "New chat"

        # persist user message
        session.add(Message(conversation_id=conv.id, role="user", content=body.message))
        conv.updated_at = datetime.now(timezone.utc)
        session.add(conv)
        session.commit()

        # build LLM config — resolve the per-model connection override if any.
        # precedence: explicit per-message pick > project override > default.
        default_model = cfg.get_setting(session, "llm_model", "")
        model = (
            (body.model or "").strip()
            or (project.model if project and project.model else "")
            or default_model
        )
        llm_cfg = cfg.get_llm_config_for_model(session, model)
        if not llm_cfg.configured:
            yield _sse({"type": "error", "error": "No model configured. Open Settings and connect your LiteLLM endpoint."})
            return
        if not model:
            yield _sse({"type": "error", "error": "No model selected. Pick a model in Settings."})
            return

        # gather tools from attached + enabled MCPs
        registry = None
        if project:
            link_rows = session.exec(select(ProjectMCPLink).where(ProjectMCPLink.project_id == project.id)).all()
            mcp_ids = [r.mcp_id for r in link_rows]
            mcps = [session.get(MCP, mid) for mid in mcp_ids]
            mcps = [m for m in mcps if m and m.enabled]
            if mcps:
                registry = await mcp_runtime.build_registry(mcps)

        # rebuild full history for the model
        history = session.exec(
            select(Message).where(Message.conversation_id == conv.id).order_by(Message.id)
        ).all()
        openai_messages = _to_openai_messages(system_prompt, history)

        max_iters = int(cfg.get_setting(session, "max_tool_iterations", "6") or 6)

        async for ev in llm.stream_chat(llm_cfg, model, openai_messages, registry, max_iters):
            if ev["type"] == "persist":
                msg = ev["message"]
                session.add(
                    Message(
                        conversation_id=conv.id,
                        role=msg["role"],
                        content=msg.get("content", ""),
                        extra=msg.get("extra", {}),
                    )
                )
                session.commit()
            else:
                yield _sse(ev)

        conv.updated_at = datetime.now(timezone.utc)
        session.add(conv)
        session.commit()


@router.post("")
async def chat(body: ChatIn) -> StreamingResponse:
    return StreamingResponse(
        _event_stream(body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
