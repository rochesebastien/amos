"""Export / import the whole application as a single filterable JSON document.

Categories the user can include/exclude on either side:
  - settings       → the key/value Setting store (LLM config, language, ...)
  - projects       → projects and their MCP links
  - mcps           → MCP definitions
  - conversations  → conversations and their messages

Import *replaces* the data of every selected category that is present in the
uploaded document (the matching tables are wiped, then reloaded).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, SQLModel, delete, select

from ..db import get_session
from ..models import MCP, Conversation, Message, Project, ProjectMCPLink, Setting

router = APIRouter(prefix="/api/storage", tags=["storage"])

EXPORT_VERSION = 1

# category -> ordered list of (json key, model, [datetime fields]).
# Order matters for import: parents before children so we insert cleanly.
CATEGORIES: dict[str, list[tuple[str, type[SQLModel], list[str]]]] = {
    "settings": [("settings", Setting, [])],
    "projects": [
        ("projects", Project, ["created_at", "updated_at"]),
        ("project_mcp_links", ProjectMCPLink, []),
    ],
    "mcps": [("mcps", MCP, ["created_at", "updated_at"])],
    "conversations": [
        ("conversations", Conversation, ["created_at", "updated_at"]),
        ("messages", Message, ["created_at"]),
    ],
}

ALL_CATEGORIES = list(CATEGORIES.keys())


class ImportIn(BaseModel):
    data: dict[str, Any]
    categories: list[str] | None = None  # None = every category found in `data`


def _coerce(rows: list[dict], dt_fields: list[str]) -> list[dict]:
    out = []
    for row in rows:
        item = dict(row)
        for f in dt_fields:
            v = item.get(f)
            if isinstance(v, str):
                try:
                    item[f] = datetime.fromisoformat(v)
                except ValueError:
                    item.pop(f, None)
        out.append(item)
    return out


@router.get("/export")
def export_data(categories: str | None = None, session: Session = Depends(get_session)) -> dict:
    wanted = (
        [c.strip() for c in categories.split(",") if c.strip()]
        if categories
        else ALL_CATEGORIES
    )
    unknown = [c for c in wanted if c not in CATEGORIES]
    if unknown:
        raise HTTPException(400, f"Unknown categories: {', '.join(unknown)}")

    doc: dict[str, Any] = {"version": EXPORT_VERSION, "categories": wanted}
    for cat in wanted:
        for json_key, model, _ in CATEGORIES[cat]:
            rows = session.exec(select(model)).all()
            doc[json_key] = [r.model_dump(mode="json") for r in rows]
    return doc


@router.post("/import")
def import_data(body: ImportIn, session: Session = Depends(get_session)) -> dict:
    data = body.data or {}
    found = [c for c in CATEGORIES if any(k in data for k, _, _ in CATEGORIES[c])]
    selected = body.categories if body.categories is not None else found
    unknown = [c for c in selected if c not in CATEGORIES]
    if unknown:
        raise HTTPException(400, f"Unknown categories: {', '.join(unknown)}")

    # only act on categories that were both requested and present in the file
    to_apply = [c for c in selected if c in found]
    if not to_apply:
        raise HTTPException(400, "Nothing to import for the selected categories")

    counts: dict[str, int] = {}
    for cat in to_apply:
        specs = CATEGORIES[cat]
        # wipe children first, then parents
        for json_key, model, _ in reversed(specs):
            session.exec(delete(model))
        # insert parents first, then children
        n = 0
        for json_key, model, dt_fields in specs:
            for item in _coerce(data.get(json_key, []), dt_fields):
                session.add(model(**item))
                n += 1
        counts[cat] = n

    session.commit()
    return {"ok": True, "imported": counts}
