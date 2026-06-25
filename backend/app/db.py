"""Database engine and session helpers (SQLite via SQLModel)."""
from __future__ import annotations

import os
from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

DB_PATH = os.environ.get("CHEVELUAI_DB", os.path.join(os.path.dirname(__file__), "..", "cheveluai.db"))
DB_URL = f"sqlite:///{os.path.abspath(DB_PATH)}"

engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})


def init_db() -> None:
    # Import models so they register with SQLModel.metadata before create_all.
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
