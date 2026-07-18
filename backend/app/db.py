"""Database engine and session helpers (SQLite via SQLModel)."""
from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

DB_PATH = os.environ.get("CHEVELUAI_DB", os.path.join(os.path.dirname(__file__), "..", "cheveluai.db"))
DB_URL = f"sqlite:///{os.path.abspath(DB_PATH)}"

engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


def _migrate() -> None:
    """Lightweight, additive migrations for columns SQLModel.create_all can't add
    to pre-existing tables. Each step is idempotent (guarded by a column check)."""
    insp = inspect(engine)
    mcp_cols = {c["name"] for c in insp.get_columns("mcp")}
    if "disabled_tools" not in mcp_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE mcp ADD COLUMN disabled_tools JSON DEFAULT '[]'"))
    project_cols = {c["name"] for c in insp.get_columns("project")}
    if "directory" not in project_cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE project ADD COLUMN directory VARCHAR DEFAULT ''"))


def init_db() -> None:
    # Import models so they register with SQLModel.metadata before create_all.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _migrate()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
