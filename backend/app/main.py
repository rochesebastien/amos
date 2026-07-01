from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from sqlmodel import Session

from .db import engine, init_db
from .routers import chat, conversations, mcps, projects, settings, storage
from .services import config as cfg


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Load the configured outbound proxy into the shared httpx client factory.
    with Session(engine) as session:
        cfg.refresh_proxy(session)
    yield


app = FastAPI(title="CheveluAI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(settings.router)
app.include_router(projects.router)
app.include_router(mcps.router)
app.include_router(conversations.router)
app.include_router(chat.router)
app.include_router(storage.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "app": "CheveluAI"}


# Optionally serve the built frontend (frontend/dist) when present.
# The path can be overridden with CHEVELUAI_STATIC (used by the Docker image).
_dist = os.environ.get(
    "CHEVELUAI_STATIC",
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"),
)
if os.path.isdir(_dist):
    _assets = os.path.join(_dist, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    _index = os.path.join(_dist, "index.html")

    # Serve root-level files (favicon, etc.) and fall back to index.html so the
    # client-side router (TanStack Router) can handle deep links and refreshes.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = os.path.join(_dist, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(_index)
