"""Read/write the AI config files of a project's linked directory (Agents mode).

A project can optionally be linked to a directory on the machine (this backend
runs on the user's own machine — filesystem access is the point of the app).
This router exposes the known AI-config locations of that directory
(CLAUDE.md / AGENTS.md, .claude/agents, .claude/skills, .codex/...) so a later
frontend phase can view, edit, and symlink-sync them between Claude and Codex.

Every path coming from the client is validated by `_safe_path`, which refuses
absolute paths, parent traversal, and anything that (after resolving symlinks on
its parents) escapes the project directory.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..models import Project

router = APIRouter(prefix="/api/projects/{project_id}/agent-dir", tags=["agent-files"])

MAX_BYTES = 1024 * 1024  # 1MB — files larger than this are not editable


# ---- request bodies ----------------------------------------------------------


class AgentFileWriteIn(BaseModel):
    path: str
    content: str = ""


class SymlinkIn(BaseModel):
    link_path: str
    target_path: str


# ---- directory / path helpers ------------------------------------------------


def _project_dir(project: Project) -> Path:
    """The project's linked directory as an absolute Path, or a 400 explaining why
    it is unusable (unset, relative, or missing on disk)."""
    directory = (project.directory or "").strip()
    if not directory:
        raise HTTPException(400, "This project has no linked directory. Set one to enable Agents mode.")
    base = Path(directory)
    if not base.is_absolute():
        raise HTTPException(400, "Project directory must be an absolute path.")
    if not base.is_dir():
        raise HTTPException(400, f"Directory does not exist: {directory}")
    return base


def _load_dir(project_id: int, session: Session) -> Path:
    """404 if the project is unknown, 400 if its directory is unusable."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return _project_dir(project)


def _safe_path(base: Path, rel: str) -> Path:
    """Resolve `rel` against the project directory `base`, rejecting anything that
    escapes it. Symlinks inside the dir that point inside the dir are fine; a path
    whose parents resolve outside `base` (or that is absolute / uses `..`) is not."""
    rel = (rel or "").strip()
    if not rel or os.path.isabs(rel):
        raise HTTPException(400, "Path must be relative to the project directory")
    parts = PurePosixPath(rel).parts
    if not parts or ".." in parts:
        raise HTTPException(400, "Path must not escape the project directory")
    target = base.joinpath(*parts)
    base_real = os.path.realpath(base)
    parent_real = os.path.realpath(target.parent)
    if parent_real != base_real and not parent_real.startswith(base_real + os.sep):
        raise HTTPException(400, "Path must not escape the project directory")
    return target


def _classify(rel: str) -> tuple[str, str, str]:
    """Best-effort (kind, provider, name) for a relative path, mirroring the scan
    spec. Unknown locations fall back to a plain claude instructions file."""
    parts = PurePosixPath(rel).parts
    name = parts[-1] if parts else rel
    if rel == "CLAUDE.md":
        return "instructions", "claude", name
    if rel == "AGENTS.md":
        return "instructions", "codex", name
    if len(parts) >= 2 and parts[0] in (".claude", ".codex"):
        provider = "claude" if parts[0] == ".claude" else "codex"
        if parts[1] == "agents":
            return "agent", provider, name
        if parts[1] == "skills":
            # .<provider>/skills/<folder>/SKILL.md — the name is the folder
            return "skill", provider, parts[2] if len(parts) >= 3 else name
        if parts[1] == "prompts" and provider == "codex":
            return "skill", "codex", name
    return "instructions", "claude", name


def _symlink_info(base: Path, path: Path) -> tuple[bool, str | None]:
    """(is_symlink, target). The target is dir-relative when it resolves inside the
    project directory, otherwise the raw (possibly external) link target."""
    if not os.path.islink(path):
        return False, None
    base_real = os.path.realpath(base)
    resolved = os.path.realpath(path)
    if resolved == base_real or resolved.startswith(base_real + os.sep):
        return True, os.path.relpath(resolved, base_real).replace(os.sep, "/")
    return True, os.readlink(path)


def _agent_file(base: Path, path: Path) -> dict:
    """The AgentFile record for a file on disk (size/mtime follow symlinks)."""
    rel = path.relative_to(base).as_posix()
    kind, provider, name = _classify(rel)
    is_symlink, symlink_target = _symlink_info(base, path)
    st = path.stat()
    return {
        "path": rel,
        "name": name,
        "kind": kind,
        "provider": provider,
        "size": st.st_size,
        "modified_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
        "is_symlink": is_symlink,
        "symlink_target": symlink_target,
    }


def _read_text(path: Path) -> str:
    """The file's text, or a 400 if it is too large or not UTF-8 text."""
    if path.stat().st_size > MAX_BYTES:
        raise HTTPException(400, "File is too large to edit (over 1MB)")
    raw = path.read_bytes()
    if b"\x00" in raw:
        raise HTTPException(400, "File is not a text file")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File is not valid UTF-8 text")


def _scan(base: Path) -> list[dict]:
    """The known AI-config files under `base` (never a full recursive walk)."""
    candidates: list[Path] = [base / "CLAUDE.md", base / "AGENTS.md"]
    candidates += sorted((base / ".claude" / "agents").glob("*.md"))
    candidates += sorted((base / ".claude" / "skills").glob("*/SKILL.md"))
    candidates += sorted((base / ".codex" / "agents").glob("*.md"))
    candidates += sorted((base / ".codex" / "skills").glob("*/SKILL.md"))
    candidates += sorted((base / ".codex" / "prompts").glob("*.md"))

    files: list[dict] = []
    for path in candidates:
        if not path.is_file():  # follows symlinks; skips dirs and broken links
            continue
        try:
            files.append(_agent_file(base, path))
        except OSError:
            continue
    return files


# ---- endpoints ---------------------------------------------------------------


@router.get("")
def get_overview(project_id: int, session: Session = Depends(get_session)) -> dict:
    """Overview of the project's AI-config files. Unlike the other endpoints, an
    unset or missing directory is reported (`exists: false`) rather than a 400, so
    the UI can prompt the user to link one."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    directory = (project.directory or "").strip()
    base = Path(directory) if directory else None
    exists = bool(base and base.is_dir())
    if not exists:
        return {"directory": directory, "exists": False, "files": []}
    return {"directory": directory, "exists": True, "files": _scan(base)}


@router.get("/file")
def read_file(project_id: int, path: str, session: Session = Depends(get_session)) -> dict:
    base = _load_dir(project_id, session)
    target = _safe_path(base, path)
    if not target.is_file():
        raise HTTPException(404, "File not found")
    content = _read_text(target)
    is_symlink, symlink_target = _symlink_info(base, target)
    return {
        "path": target.relative_to(base).as_posix(),
        "content": content,
        "is_symlink": is_symlink,
        "symlink_target": symlink_target,
    }


@router.put("/file")
def write_file(project_id: int, body: AgentFileWriteIn, session: Session = Depends(get_session)) -> dict:
    """Write (creating parent dirs) a full-document file. Also used to create new
    files. Returns the resulting AgentFile info."""
    base = _load_dir(project_id, session)
    target = _safe_path(base, body.path)
    if target.is_dir() and not os.path.islink(target):
        raise HTTPException(400, "Path is a directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content, encoding="utf-8")
    return _agent_file(base, target)


@router.delete("/file")
def delete_file(project_id: int, path: str, session: Session = Depends(get_session)) -> dict:
    base = _load_dir(project_id, session)
    target = _safe_path(base, path)
    if not os.path.lexists(target):
        raise HTTPException(404, "File not found")
    if target.is_dir() and not os.path.islink(target):
        raise HTTPException(400, "Path is a directory")
    target.unlink()
    return {"ok": True}


@router.post("/symlink")
def create_symlink(project_id: int, body: SymlinkIn, session: Session = Depends(get_session)) -> dict:
    """Create a relative symlink at `link_path` pointing to `target_path` (both
    relative to the project directory). Replaces an existing file/symlink at
    `link_path` — this is the Claude<->Codex sync action. Target must exist."""
    base = _load_dir(project_id, session)
    link = _safe_path(base, body.link_path)
    target = _safe_path(base, body.target_path)
    if not os.path.lexists(target):
        raise HTTPException(400, "Symlink target does not exist")
    if link.is_dir() and not os.path.islink(link):
        raise HTTPException(400, "Link path is a directory")
    link.parent.mkdir(parents=True, exist_ok=True)
    rel_target = os.path.relpath(target, link.parent)
    if os.path.lexists(link):
        link.unlink()
    os.symlink(rel_target, link)
    return _agent_file(base, link)
