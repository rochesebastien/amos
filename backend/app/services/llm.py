"""OpenAI-compatible LLM client (works against any LiteLLM gateway).

Nothing is hardcoded: base URL, API key and model all come from Settings. The
streaming chat runs an agentic loop — when the model asks for tool calls we run
them through the MCP runtime and feed the results back until it produces a final
answer.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, Optional

import httpx

from . import net
from .config import LLMConfig
from .mcp_runtime import ToolRegistry, execute


def _endpoint(base: str, path: str) -> str:
    base = base.rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/{path}"
    return f"{base}/v1/{path}"


def _headers(cfg: LLMConfig) -> dict:
    h = {"Content-Type": "application/json"}
    if cfg.api_key:
        h["Authorization"] = f"Bearer {cfg.api_key}"
    return h


async def list_models(cfg: LLMConfig) -> list[str]:
    async with net.async_client(timeout=20, follow_redirects=True) as client:
        r = await client.get(_endpoint(cfg.base_url, "models"), headers=_headers(cfg))
        r.raise_for_status()
        data = r.json()
    items = data.get("data") if isinstance(data, dict) else data
    out = []
    for m in items or []:
        if isinstance(m, dict):
            out.append(m.get("id") or m.get("name") or "")
        elif isinstance(m, str):
            out.append(m)
    return sorted(x for x in out if x)


async def _stream_completion(
    client: httpx.AsyncClient,
    cfg: LLMConfig,
    model: str,
    messages: list[dict],
    tools: list[dict],
) -> AsyncIterator[dict]:
    """Yield {"type": "token"|"tool_calls"|"done", ...} for a single completion."""
    payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    content_parts: list[str] = []
    tool_calls: dict[int, dict] = {}

    async with client.stream(
        "POST", _endpoint(cfg.base_url, "chat/completions"), json=payload, headers=_headers(cfg)
    ) as resp:
        if resp.status_code >= 400:
            body = (await resp.aread()).decode("utf-8", "replace")
            raise RuntimeError(f"LLM error {resp.status_code}: {body[:500]}")
        async for line in resp.aiter_lines():
            line = line.strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            if delta.get("content"):
                content_parts.append(delta["content"])
                yield {"type": "token", "text": delta["content"]}
            for tc in delta.get("tool_calls") or []:
                idx = tc.get("index", 0)
                slot = tool_calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if tc.get("id"):
                    slot["id"] = tc["id"]
                fn = tc.get("function") or {}
                if fn.get("name"):
                    slot["name"] += fn["name"]
                if fn.get("arguments"):
                    slot["arguments"] += fn["arguments"]

    ordered = [tool_calls[i] for i in sorted(tool_calls)]
    yield {"type": "done", "content": "".join(content_parts), "tool_calls": ordered}


async def stream_chat(
    cfg: LLMConfig,
    model: str,
    messages: list[dict],
    registry: Optional[ToolRegistry],
    max_iterations: int = 6,
) -> AsyncIterator[dict]:
    """Run the agentic chat loop, yielding UI events.

    Event types: token, tool_call, tool_result, assistant (final per turn),
    persist (a message to store), done, error.
    """
    tools = registry.openai_tools if registry else []
    working = list(messages)

    async with net.async_client(timeout=None) as client:
        for _ in range(max(1, max_iterations)):
            content = ""
            calls: list[dict] = []
            try:
                async for ev in _stream_completion(client, cfg, model, working, tools):
                    if ev["type"] == "token":
                        yield ev
                    elif ev["type"] == "done":
                        content = ev["content"]
                        calls = ev["tool_calls"]
            except Exception as exc:
                err = str(exc)
                # Persist the failure as an assistant "error" message so the red
                # error bubble survives a reload instead of only flashing live.
                yield {
                    "type": "persist",
                    "message": {"role": "assistant", "content": content, "extra": {"error": err}},
                }
                yield {"type": "error", "error": err}
                return

            if not calls:
                yield {"type": "persist", "message": {"role": "assistant", "content": content}}
                yield {"type": "done"}
                return

            # assistant turn that requested tools
            assistant_msg = {
                "role": "assistant",
                "content": content,
                "tool_calls": [
                    {
                        "id": c["id"] or f"call_{i}",
                        "type": "function",
                        "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                    }
                    for i, c in enumerate(calls)
                ],
            }
            working.append(assistant_msg)
            yield {
                "type": "persist",
                "message": {"role": "assistant", "content": content, "extra": {"tool_calls": assistant_msg["tool_calls"]}},
            }

            for i, c in enumerate(calls):
                call_id = c["id"] or f"call_{i}"
                try:
                    args = json.loads(c["arguments"]) if c["arguments"].strip() else {}
                except json.JSONDecodeError:
                    args = {}
                yield {"type": "tool_call", "name": c["name"], "arguments": args, "id": call_id}

                if registry is None:
                    result: Any = {"error": "no tools configured"}
                else:
                    result = await execute(registry, c["name"], args)
                result_str = result if isinstance(result, str) else json.dumps(result, default=str)

                tool_msg = {"role": "tool", "tool_call_id": call_id, "content": result_str}
                working.append(tool_msg)
                yield {"type": "tool_result", "name": c["name"], "id": call_id, "result": result}
                yield {
                    "type": "persist",
                    "message": {"role": "tool", "content": result_str, "extra": {"tool_call_id": call_id, "name": c["name"]}},
                }

        err = f"stopped after {max_iterations} tool iterations"
        yield {
            "type": "persist",
            "message": {"role": "assistant", "content": "", "extra": {"error": err}},
        }
        yield {"type": "error", "error": err}
