"""Generate MCP-style tools from an OpenAPI (e.g. FastAPI) spec, on the fly.

Each operation in the spec becomes one tool whose JSON-schema parameters are
assembled from the operation's path/query parameters and requestBody. Executing
a tool issues the corresponding HTTP request against the resolved base URL.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from . import net

HTTP_METHODS = ("get", "post", "put", "patch", "delete")


def _sanitize(name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
    return name[:64] or "op"


def _resolve_ref(spec: dict, ref: str) -> dict:
    node: Any = spec
    for part in ref.lstrip("#/").split("/"):
        if not isinstance(node, dict):
            return {}
        node = node.get(part, {})
    return node if isinstance(node, dict) else {}


def _deref(spec: dict, schema: Any) -> Any:
    """Shallow-resolve $ref so the model sees usable schemas."""
    if isinstance(schema, dict):
        if "$ref" in schema:
            return _deref(spec, _resolve_ref(spec, schema["$ref"]))
        return {k: _deref(spec, v) for k, v in schema.items()}
    if isinstance(schema, list):
        return [_deref(spec, v) for v in schema]
    return schema


def base_url_from_spec(spec: dict, override: Optional[str] = None) -> str:
    if override:
        return override.rstrip("/")
    servers = spec.get("servers") or []
    if servers and isinstance(servers, list) and servers[0].get("url"):
        return str(servers[0]["url"]).rstrip("/")
    return ""


def build_tools(spec: dict) -> list[dict]:
    """Return OpenAI-style tool definitions plus routing metadata.

    Each item: {"name", "description", "parameters", "_method", "_path",
    "_param_locations"} where _param_locations maps param name -> "path"|"query".
    """
    tools: list[dict] = []
    paths = spec.get("paths") or {}
    for path, item in paths.items():
        if not isinstance(item, dict):
            continue
        for method in HTTP_METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue

            op_id = op.get("operationId") or f"{method}_{path}"
            name = _sanitize(op_id)
            description = op.get("summary") or op.get("description") or f"{method.upper()} {path}"

            properties: dict[str, Any] = {}
            required: list[str] = []
            locations: dict[str, str] = {}

            # path + query parameters (merge path-level and operation-level)
            params = (item.get("parameters") or []) + (op.get("parameters") or [])
            for p in params:
                p = _deref(spec, p)
                if not isinstance(p, dict) or "name" not in p:
                    continue
                loc = p.get("in")
                if loc not in ("path", "query"):
                    continue
                pname = p["name"]
                pschema = _deref(spec, p.get("schema") or {"type": "string"})
                if p.get("description"):
                    pschema = {**pschema, "description": p["description"]}
                properties[pname] = pschema
                locations[pname] = loc
                if p.get("required") or loc == "path":
                    required.append(pname)

            # request body (json) -> single "body" object param
            body = _deref(spec, op.get("requestBody") or {})
            has_body = False
            if isinstance(body, dict):
                content = body.get("content") or {}
                json_ct = content.get("application/json") or {}
                if json_ct:
                    body_schema = _deref(spec, json_ct.get("schema") or {"type": "object"})
                    properties["body"] = {**body_schema, "description": "JSON request body"}
                    if body.get("required"):
                        required.append("body")
                    has_body = True

            tools.append(
                {
                    "name": name,
                    "description": description[:1024],
                    "parameters": {
                        "type": "object",
                        "properties": properties,
                        "required": required,
                    },
                    "_method": method,
                    "_path": path,
                    "_param_locations": locations,
                    "_has_body": has_body,
                }
            )
    # de-duplicate tool names
    seen: dict[str, int] = {}
    for t in tools:
        if t["name"] in seen:
            seen[t["name"]] += 1
            t["name"] = f"{t['name']}_{seen[t['name']]}"
        else:
            seen[t["name"]] = 0
    return tools


async def fetch_spec(url: str) -> dict:
    async with net.async_client(timeout=30, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()


async def load_spec(config: dict) -> dict:
    """Load the spec from inline config or by fetching spec_url."""
    if config.get("spec"):
        return config["spec"]
    if config.get("spec_url"):
        return await fetch_spec(config["spec_url"])
    raise ValueError("OpenAPI MCP requires either 'spec' or 'spec_url' in config")


async def execute(config: dict, tool: dict, arguments: dict) -> Any:
    """Execute an OpenAPI-backed tool call."""
    spec = await load_spec(config)
    base = base_url_from_spec(spec, config.get("base_url"))
    if not base:
        # fall back to deriving from spec_url origin
        spec_url = config.get("spec_url", "")
        m = re.match(r"^(https?://[^/]+)", spec_url)
        base = m.group(1) if m else ""
    if not base:
        raise ValueError("No base_url available to call the API")

    path = tool["_path"]
    locations = tool["_param_locations"]
    query: dict[str, Any] = {}
    for pname, loc in locations.items():
        if pname in arguments:
            if loc == "path":
                path = path.replace("{" + pname + "}", str(arguments[pname]))
            elif loc == "query":
                query[pname] = arguments[pname]

    headers = dict(config.get("headers") or {})
    json_body = arguments.get("body") if tool.get("_has_body") else None

    async with net.async_client(timeout=60, follow_redirects=True) as client:
        r = await client.request(
            tool["_method"].upper(),
            base + path,
            params=query or None,
            json=json_body,
            headers=headers or None,
        )
    try:
        return {"status": r.status_code, "data": r.json()}
    except Exception:
        return {"status": r.status_code, "data": r.text}
