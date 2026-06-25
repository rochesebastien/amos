from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import Project, ProjectMCPLink
from ..schemas import ProjectIn, ProjectOut

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _mcp_ids(session: Session, project_id: int) -> list[int]:
    rows = session.exec(select(ProjectMCPLink).where(ProjectMCPLink.project_id == project_id)).all()
    return [r.mcp_id for r in rows]


def _set_links(session: Session, project_id: int, mcp_ids: list[int]) -> None:
    existing = session.exec(select(ProjectMCPLink).where(ProjectMCPLink.project_id == project_id)).all()
    for row in existing:
        session.delete(row)
    for mid in dict.fromkeys(mcp_ids):
        session.add(ProjectMCPLink(project_id=project_id, mcp_id=mid))


def _to_out(session: Session, p: Project) -> ProjectOut:
    return ProjectOut(
        id=p.id,
        name=p.name,
        description=p.description,
        system_prompt=p.system_prompt,
        model=p.model,
        mcp_ids=_mcp_ids(session, p.id),
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(session: Session = Depends(get_session)) -> list[ProjectOut]:
    projects = session.exec(select(Project).order_by(Project.updated_at.desc())).all()
    return [_to_out(session, p) for p in projects]


@router.post("", response_model=ProjectOut)
def create_project(body: ProjectIn, session: Session = Depends(get_session)) -> ProjectOut:
    p = Project(
        name=body.name.strip() or "Untitled project",
        description=body.description,
        system_prompt=body.system_prompt,
        model=body.model,
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    _set_links(session, p.id, body.mcp_ids)
    session.commit()
    return _to_out(session, p)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, session: Session = Depends(get_session)) -> ProjectOut:
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return _to_out(session, p)


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectIn, session: Session = Depends(get_session)) -> ProjectOut:
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    p.name = body.name.strip() or p.name
    p.description = body.description
    p.system_prompt = body.system_prompt
    p.model = body.model
    p.updated_at = datetime.now(timezone.utc)
    session.add(p)
    _set_links(session, p.id, body.mcp_ids)
    session.commit()
    session.refresh(p)
    return _to_out(session, p)


@router.delete("/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session)) -> dict:
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    for row in session.exec(select(ProjectMCPLink).where(ProjectMCPLink.project_id == project_id)).all():
        session.delete(row)
    session.delete(p)
    session.commit()
    return {"ok": True}
