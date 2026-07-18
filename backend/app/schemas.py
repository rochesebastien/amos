"""Pydantic request/response schemas (API contract)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel

# ---- Settings ----------------------------------------------------------------


class EnabledModelOut(BaseModel):
    id: str
    base_url: str = ""  # per-model override; "" = use the global gateway
    has_api_key: bool = False  # never leak the per-model key


class EnabledModelIn(BaseModel):
    id: str
    base_url: Optional[str] = None  # None = keep existing
    api_key: Optional[str] = None  # write-only; None = keep, "" = clear


class SettingsOut(BaseModel):
    llm_base_url: str = ""
    llm_model: str = ""  # the default model
    has_api_key: bool = False  # never leak the key itself
    max_tool_iterations: int = 6
    language: str = "en"
    http_proxy: str = ""  # outbound proxy for backend HTTP calls ("" = direct)
    enabled_models: list[EnabledModelOut] = []  # models activated for use in chat


class SettingsIn(BaseModel):
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None  # write-only; "" clears it
    max_tool_iterations: Optional[int] = None
    language: Optional[str] = None
    http_proxy: Optional[str] = None  # "" clears it (direct connection)
    enabled_models: Optional[list[EnabledModelIn]] = None


# ---- Projects ----------------------------------------------------------------


class ProjectIn(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    model: str = ""
    directory: str = ""
    mcp_ids: list[int] = []


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str
    system_prompt: str
    model: str
    directory: str
    mcp_ids: list[int]
    created_at: datetime
    updated_at: datetime


# ---- MCPs --------------------------------------------------------------------

MCPType = Literal["remote", "code", "openapi"]


class ToolPreview(BaseModel):
    name: str
    description: str = ""
    parameters: dict[str, Any] = {}


class MCPIn(BaseModel):
    name: str
    description: str = ""
    type: MCPType = "openapi"
    enabled: bool = True
    disabled_tools: list[str] = []
    config: dict[str, Any] = {}
    project_ids: list[int] = []


class MCPOut(BaseModel):
    id: int
    name: str
    description: str
    type: str
    enabled: bool
    disabled_tools: list[str] = []
    config: dict[str, Any]
    project_ids: list[int]
    # every tool the MCP exposes (so the UI can render a switch per tool);
    # `tool_count` reflects only the currently *active* (non-disabled) tools.
    tools: list[ToolPreview] = []
    tool_count: int = 0
    created_at: datetime
    updated_at: datetime


class MCPTestResult(BaseModel):
    ok: bool
    tools: list[ToolPreview] = []
    error: Optional[str] = None


class ParseOpenAPIIn(BaseModel):
    spec_url: Optional[str] = None
    spec: Optional[dict[str, Any]] = None
    base_url: Optional[str] = None


# ---- Conversations & chat ----------------------------------------------------


class ConversationOut(BaseModel):
    id: int
    title: str
    project_id: Optional[int]
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    extra: dict[str, Any]
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut] = []


class ChatIn(BaseModel):
    conversation_id: Optional[int] = None
    project_id: Optional[int] = None
    message: str
    model: Optional[str] = None  # per-message model pick (overrides project/default)
