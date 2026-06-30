"""Run an MCP defined by user-supplied Python code.

A code MCP is a small Python *project* — one or more files forming a file tree.
One file is the **entry point**: it must define a `TOOLS` list and a
`call(name, arguments)` function. The other files are plain modules the entry
point can import (they sit next to it on the import path).

    # main.py  (entry)
    from helpers import double

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
            return double(arguments["a"]) + arguments["b"]
        raise ValueError(f"unknown tool {name}")

Config shape::

    {
        "files": {"main.py": "...", "lib/helpers.py": "..."},
        "entry": "main.py"
    }

A legacy single-file config (``{"code": "..."}``) is still accepted and treated
as a one-file project whose entry point is ``main.py``.

NOTE: this executes code in-process. It is intended for a self-hosted, single-
user environment where you control the code you paste/import.
"""
from __future__ import annotations

import os
import sys
import tempfile
from contextlib import contextmanager
from typing import Any, Iterator

DEFAULT_ENTRY = "main.py"


def _files(config: dict) -> dict[str, str]:
    """Normalise a config into a ``{path: source}`` map.

    Accepts the new ``files`` map and falls back to the legacy single ``code``
    string (wrapped as ``main.py``).
    """
    files = config.get("files")
    if isinstance(files, dict) and files:
        return {str(k): (v if isinstance(v, str) else "") for k, v in files.items()}
    code = config.get("code")
    if isinstance(code, str) and code.strip():
        return {DEFAULT_ENTRY: code}
    return {}


def _entry(config: dict, files: dict[str, str]) -> str:
    """Pick the entry file: the configured one, else main.py, else first .py."""
    entry = config.get("entry")
    if isinstance(entry, str) and entry in files:
        return entry
    if DEFAULT_ENTRY in files:
        return DEFAULT_ENTRY
    for path in files:
        if path.endswith(".py"):
            return path
    return next(iter(files), DEFAULT_ENTRY)


def _belongs_to(mod: Any, root_abs: str) -> bool:
    """True if a module was loaded out of (or namespaces into) the temp project."""
    mod_file = getattr(mod, "__file__", None)
    if mod_file and os.path.abspath(mod_file).startswith(root_abs):
        return True
    # namespace packages have no __file__ but carry a __path__ of directories
    for entry in getattr(mod, "__path__", []) or []:
        try:
            if os.path.abspath(entry).startswith(root_abs):
                return True
        except (TypeError, ValueError):
            continue
    return False


@contextmanager
def _project(files: dict[str, str], entry: str) -> Iterator[dict]:
    """Materialise the project to a temp dir, exec the entry, yield its namespace.

    The temp dir stays on ``sys.path`` for the duration of the ``with`` block so
    that ``call`` can perform lazy imports of sibling modules. Modules imported
    from the project are evicted from ``sys.modules`` on exit so each run sees a
    fresh copy of edited code.
    """
    with tempfile.TemporaryDirectory(prefix="mcp_code_") as root:
        for rel, content in files.items():
            dest = os.path.normpath(os.path.join(root, rel))
            # keep writes inside the temp root even if a path tries to escape
            if not dest.startswith(root):
                continue
            os.makedirs(os.path.dirname(dest) or root, exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(content)

        before = set(sys.modules)
        sys.path.insert(0, root)
        try:
            namespace: dict[str, Any] = {
                "__name__": "__mcp_main__",
                "__file__": os.path.join(root, entry),
            }
            src = files.get(entry, "")
            exec(compile(src, entry, "exec"), namespace)  # noqa: S102 - intentional
            yield namespace
        finally:
            try:
                sys.path.remove(root)
            except ValueError:
                pass
            # drop modules loaded out of the project so edits take effect next run
            root_abs = os.path.abspath(root)
            for name in set(sys.modules) - before:
                mod = sys.modules.get(name)
                if _belongs_to(mod, root_abs):
                    sys.modules.pop(name, None)


def list_tools(config: dict) -> list[dict]:
    files = _files(config)
    if not files:
        return []
    entry = _entry(config, files)
    with _project(files, entry) as ns:
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
    files = _files(config)
    if not files:
        raise ValueError("code MCP has no files to run")
    entry = _entry(config, files)
    with _project(files, entry) as ns:
        fn = ns.get("call")
        if not callable(fn):
            raise ValueError("code MCP entry must define a callable `call(name, arguments)`")
        return fn(name, arguments)
