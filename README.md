# CheveluAI

![CheveluAI](github_cover.png)

A self-hosted, Codex-style AI workspace. Chat with your own model, organize work
into **Projects** (each with its own pre-prompt), and manage **MCP** servers that
you can attach to projects to give the model tools.

CheveluAI ships **not connected to any model**. You point it at *your own*
OpenAI-compatible endpoint — typically an external [LiteLLM](https://docs.litellm.ai/)
gateway — from **Settings**. Nothing about the model is hardcoded.

## Features

- **Chat** — streaming conversations, agentic tool-calling, conversation history.
- **Projects** — group conversations, give each a custom system pre-prompt, and
  attach one or more MCPs.
- **MCP management (CRUD)** — create MCPs three ways and attach them to any
  number of projects:
  1. **Remote** — connect to an existing MCP server over streamable HTTP (JSON-RPC).
  2. **Code** — paste your own Python that defines tools.
  3. **OpenAPI** — drop in an `openapi.json` (e.g. from a FastAPI app) or its URL
     and an MCP tool set is **generated on the fly** from the spec.
- **Settings** — fully configurable LLM connection (base URL, API key, model),
  with live model discovery from the gateway's `/v1/models`, plus appearance.

## Architecture

```
frontend/   React + Vite + TypeScript + Tailwind v4 (Mona Sans, custom palette)
            TanStack Router (URL routing) + TanStack Query (server state)
            shadcn/ui primitives, incl. the AI components (Message, Bubble,
            Marker, Attachment) for the chat surface
backend/    FastAPI + SQLModel (SQLite) — LLM proxy, MCP runtime, OpenAPI→tools
```

## Running locally

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api to :8000)
```

Then open the app, go to **Settings**, enter your LiteLLM base URL + API key,
pick a model, and start chatting.

## Design

See [`DESIGN.md`](./DESIGN.md). CheveluAI adapts that system with its own palette:
primary `#00ED64`, background `#FFFFEB`, secondary `#001E2B`, and the open-source
variable **Mona Sans** typeface (ExtraBold for display, Medium for body).
