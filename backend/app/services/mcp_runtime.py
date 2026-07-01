"""Aggregate tools across a project's MCPs and route tool execution."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..models import MCP
from . import code_mcp, openapi_tools, remote_mcp


def _slug(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", name).strip("_").lower()[:24] or "mcp"


@dataclass
class RoutedTool:
    public_name: str  # name exposed to the model (unique)
    mcp: MCP
    tool: dict  # underlying tool definition (incl. routing metadata for openapi)


@dataclass
class ToolRegistry:
    openai_tools: list[dict] = field(default_factory=list)
    routes: dict[str, RoutedTool] = field(default_factory=dict)


async def list_mcp_tools(mcp: MCP) -> list[dict]:
    """Return the raw tools exposed by a single MCP (name/description/parameters)."""
    if mcp.type == "openapi":
        spec = await openapi_tools.load_spec(mcp.config)
        return openapi_tools.build_tools(spec)
    if mcp.type == "remote":
        return await remote_mcp.list_tools(mcp.config)
    if mcp.type == "code":
        return code_mcp.list_tools(mcp.config)
    raise ValueError(f"unknown MCP type: {mcp.type}")


async def build_registry(mcps: list[MCP]) -> ToolRegistry:
    reg = ToolRegistry()
    used: set[str] = set()
    for mcp in mcps:
        if not mcp.enabled:
            continue
        try:
            tools = await list_mcp_tools(mcp)
        except Exception:
            # a broken MCP should not take down the whole chat
            continue
        prefix = _slug(mcp.name)
        disabled = set(mcp.disabled_tools or [])
        for t in tools:
            if t["name"] in disabled:
                continue
            base = f"{prefix}__{t['name']}"
            name = base
            i = 1
            while name in used:
                i += 1
                name = f"{base}_{i}"
            used.add(name)
            reg.routes[name] = RoutedTool(public_name=name, mcp=mcp, tool=t)
            reg.openai_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": t.get("description", ""),
                        "parameters": t.get("parameters") or {"type": "object", "properties": {}},
                    },
                }
            )
    return reg


async def execute(reg: ToolRegistry, public_name: str, arguments: dict) -> Any:
    route = reg.routes.get(public_name)
    if route is None:
        return {"error": f"unknown tool: {public_name}"}
    mcp = route.mcp
    try:
        if mcp.type == "openapi":
            return await openapi_tools.execute(mcp.config, route.tool, arguments)
        if mcp.type == "remote":
            return await remote_mcp.call_tool(mcp.config, route.tool["name"], arguments)
        if mcp.type == "code":
            return code_mcp.call_tool(mcp.config, route.tool["name"], arguments)
        return {"error": f"unknown MCP type: {mcp.type}"}
    except Exception as exc:  # surface execution errors back to the model
        return {"error": f"{type(exc).__name__}: {exc}"}
