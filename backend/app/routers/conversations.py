from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Conversation, Message, Project
from ..schemas import ConversationDetail, ConversationOut, MessageOut

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationOut])
def list_conversations(session: Session = Depends(get_session)) -> list[ConversationOut]:
    convs = session.exec(select(Conversation).order_by(Conversation.updated_at.desc())).all()
    return [ConversationOut(**c.model_dump()) for c in convs]


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: int, session: Session = Depends(get_session)) -> ConversationDetail:
    c = session.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(404, "Conversation not found")
    msgs = session.exec(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.id)
    ).all()
    # hide internal tool plumbing from the transcript view
    visible = [m for m in msgs if m.role in ("user", "assistant", "tool")]
    return ConversationDetail(
        **c.model_dump(),
        messages=[MessageOut(**m.model_dump()) for m in visible],
    )


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    project_id: Optional[int] = None


@router.put("/{conversation_id}", response_model=ConversationOut)
def update_conversation(
    conversation_id: int, body: ConversationUpdate, session: Session = Depends(get_session)
) -> ConversationOut:
    c = session.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(404, "Conversation not found")
    fields = body.model_fields_set
    if "title" in fields and body.title is not None:
        c.title = body.title.strip() or c.title
    # project_id is explicitly settable to null ("Sans projet")
    if "project_id" in fields:
        if body.project_id is not None and not session.get(Project, body.project_id):
            raise HTTPException(404, "Project not found")
        c.project_id = body.project_id
    session.add(c)
    session.commit()
    session.refresh(c)
    return ConversationOut(**c.model_dump())


@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: int, session: Session = Depends(get_session)) -> dict:
    c = session.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(404, "Conversation not found")
    for m in session.exec(select(Message).where(Message.conversation_id == conversation_id)).all():
        session.delete(m)
    session.delete(c)
    session.commit()
    return {"ok": True}
