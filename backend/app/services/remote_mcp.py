"""Minimal client for remote MCP servers over streamable HTTP (JSON-RPC 2.0).

Supports the common case: a single POST endpoint that accepts JSON-RPC requests
and replies with either application/json or a text/event-stream containing the
JSON-RPC response. Enough for tools/list and tools/call.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

PROTOCOL_VERSION = "2024-11-05"


def _parse_response(resp: httpx.Response) -> dict:
    ctype = resp.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        # take the last `data:` JSON object that has a result/error
        last: dict = {}
        for line in resp.text.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                payload = line[len("data:"):].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and ("result" in obj or "error" in obj):
                    last = obj
        return last
    try:
        return resp.json()
    except Exception:
        return {}


async def _rpc(client: httpx.AsyncClient, url: str, method: str, params: dict | None, rid: int) -> dict:
    body = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        body["params"] = params
    r = await client.post(url, json=body, headers={"Accept": "application/json, text/event-stream"})
    r.raise_for_status()
    return _parse_response(r)


def _client(config: dict) -> tuple[httpx.AsyncClient, str]:
    url = config.get("url") or config.get("endpoint")
    if not url:
        raise ValueError("Remote MCP requires a 'url' in config")
    headers = dict(config.get("headers") or {})
    return httpx.AsyncClient(timeout=60, follow_redirects=True, headers=headers), url


async def _initialize(client: httpx.AsyncClient, url: str) -> None:
    await _rpc(
        client,
        url,
        "initialize",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "CheveluAI", "version": "0.1.0"},
        },
        1,
    )
    # best-effort notification that we're initialized
    try:
        await client.post(
            url,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers={"Accept": "application/json, text/event-stream"},
        )
    except Exception:
        pass


async def list_tools(config: dict) -> list[dict]:
    client, url = _client(config)
    async with client:
        await _initialize(client, url)
        resp = await _rpc(client, url, "tools/list", {}, 2)
        tools = (resp.get("result") or {}).get("tools") or []
        out = []
        for t in tools:
            out.append(
                {
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "parameters": t.get("inputSchema") or {"type": "object", "properties": {}},
                }
            )
        return out


async def call_tool(config: dict, name: str, arguments: dict) -> Any:
    client, url = _client(config)
    async with client:
        await _initialize(client, url)
        resp = await _rpc(client, url, "tools/call", {"name": name, "arguments": arguments}, 3)
        if "error" in resp:
            return {"error": resp["error"]}
        result = resp.get("result") or {}
        # MCP returns content blocks; flatten text content for the model
        content = result.get("content")
        if isinstance(content, list):
            texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
            if texts:
                return "\n".join(texts)
        return result
