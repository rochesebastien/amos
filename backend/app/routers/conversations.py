from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Conversation, Message
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


class RenameIn(BaseModel):
    title: str


@router.put("/{conversation_id}", response_model=ConversationOut)
def rename_conversation(conversation_id: int, body: RenameIn, session: Session = Depends(get_session)) -> ConversationOut:
    c = session.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(404, "Conversation not found")
    c.title = body.title.strip() or c.title
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
