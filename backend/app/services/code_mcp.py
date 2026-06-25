"""Run an MCP defined by user-supplied Python code.

Convention (kept deliberately simple and explicit):

    TOOLS = [
        {
            "name": "add",
            "description": "Add two numbers",
            "parameters": {
                "type": "object",
                "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                "required": ["a", "b"],
            },
        },
    ]

    def call(name, arguments):
        if name == "add":
            return arguments["a"] + arguments["b"]
        raise ValueError(f"unknown tool {name}")

NOTE: this executes code in-process. It is intended for a self-hosted, single-
user environment where you control the code you paste.
"""
from __future__ import annotations

from typing import Any


def _compile(code: str) -> dict:
    namespace: dict[str, Any] = {}
    exec(compile(code, "<mcp_code>", "exec"), namespace)  # noqa: S102 - intentional
    return namespace


def list_tools(config: dict) -> list[dict]:
    code = config.get("code") or ""
    if not code.strip():
        return []
    ns = _compile(code)
    tools = ns.get("TOOLS") or []
    out = []
    for t in tools:
        if not isinstance(t, dict) or "name" not in t:
            continue
        out.append(
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("parameters") or {"type": "object", "properties": {}},
            }
        )
    return out


def call_tool(config: dict, name: str, arguments: dict) -> Any:
    code = config.get("code") or ""
    ns = _compile(code)
    fn = ns.get("call")
    if not callable(fn):
        raise ValueError("code MCP must define a callable `call(name, arguments)`")
    return fn(name, arguments)
