"""SQLModel table definitions for CheveluAI."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import JSON, Column, Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ProjectMCPLink(SQLModel, table=True):
    """Many-to-many link between projects and MCPs."""

    __tablename__ = "project_mcp_link"

    project_id: int = Field(foreign_key="project.id", primary_key=True)
    mcp_id: int = Field(foreign_key="mcp.id", primary_key=True)


class Setting(SQLModel, table=True):
    """Single-row-ish key/value store for app configuration."""

    __tablename__ = "setting"

    key: str = Field(primary_key=True)
    value: str = ""


class Project(SQLModel, table=True):
    __tablename__ = "project"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str = ""
    system_prompt: str = ""  # the project "pre-prompt"
    model: str = ""  # optional per-project model override
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class MCP(SQLModel, table=True):
    __tablename__ = "mcp"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str = ""
    # type: "remote" | "code" | "openapi"
    type: str = "openapi"
    enabled: bool = True
    # individual tools (by their raw name) turned off globally. A tool is active
    # when the MCP is enabled AND its name is not in this list.
    disabled_tools: list = Field(default_factory=list, sa_column=Column(JSON))
    # type-specific configuration (urls, code, spec, headers, base_url, ...)
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class Conversation(SQLModel, table=True):
    __tablename__ = "conversation"

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = "New chat"
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class Message(SQLModel, table=True):
    __tablename__ = "message"

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    role: str  # system | user | assistant | tool
    content: str = ""
    # extra payload: tool_calls (assistant), tool_call_id/name (tool), meta
    extra: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_now)
