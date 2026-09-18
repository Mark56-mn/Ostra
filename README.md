# Ostra — v0

**Ostra** is an experimental autonomous agent system. This repository is its first working
prototype: the **communication layer**, a polished web application for talking to the Ostra model.

Long-term architecture:

```
Model      = brain
Agent      = runtime / decision + execution layer
Tools      = actions
Memory     = persistent knowledge
Scheduler  = autonomy
Website    = communication + control interface
```

**v0 implements only the model link and a thin runtime.** No tools, no persistent memory, no
scheduler, no background execution, no authentication, no database. The UI says so out loud rather
than implying capabilities that do not exist.

Live request path:

```
User → Ostra Web UI → POST /api/chat → Agent Runtime → ModelProvider → Model endpoint
                                                              ↓
User ← Ostra Web UI ← JSON response (message, conversationId) ←──┘
```

---

## Quick start

```bash
bun install
bun run dev          # http://localhost:3000
```

No configuration is required. With an empty environment Ostra runs in **mock mode**: replies come
from a built-in simulated provider so the whole product can be developed and tested before the
model endpoint exists.

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # eslint
bun run build        # production build
```

## Model modes

| `MODEL_MODE` | Behaviour |
| --- | --- |
| `mock` | Built-in simulated Ostra replies. No network, no keys. |
| `http` | Every turn is forwarded to `MODEL_API_URL` over HTTP (server-side only). |
| *(unset)* | Auto-selects: `http` when `MODEL_API_URL` is set, otherwise `mock`. |

The model is expected to live **outside** the web app. Vercel is the application layer; Kaggle (or a
VPS, a local server, or any inference provider) is the model-compute layer:

```
Vercel  →  MODEL_API_URL  →  Kaggle model
```

Changing the model is an environment change, never a code change.

## Environment variables

The template lives in **`env.example`** at the repository root (this workspace's tooling refuses to
write dot-prefixed env paths, so the file is not named `.env.example`; it is byte-for-byte the same
template). Copy it to `.env.local` and set the same keys in hosting:

```bash
cp env.example .env.local
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `MODEL_MODE` | no | `mock` or `http`. Unset = auto. |
| `MODEL_API_URL` | for `http` | Full URL of the model endpoint. |
| `MODEL_API_KEY` | no | Bearer token for that endpoint. **Server-side only.** |
| `MODEL_NAME` | no | Model identifier sent to the endpoint (default `ostra-experimental`). |
| `MODEL_API_FORMAT` | no | `openai` (default) or `simple` request body. |
| `MODEL_TIMEOUT_MS` | no | Per-call timeout, default `45000`. |
| `OSTRA_MAX_MESSAGE_LENGTH` | no | Max accepted user message, default `8000`. |
| `OSTRA_RATE_LIMIT_MAX` / `OSTRA_RATE_LIMIT_WINDOW` | no | Per-IP chat limit, default `30` / `60` s. |

Never commit real secrets. Nothing in this list is exposed to the browser: the client talks only to
Ostra's own `/api/*` routes.

## API

### `POST /api/chat`

```json
{ "message": "Hello Ostra", "conversationId": "optional-id" }
```

```json
{
  "message": "Hello. I'm Ostra.",
  "conversationId": "3f1c…",
  "model": "ostra-experimental",
  "provider": "http",
  "mode": "http",
  "latencyMs": 412
}
```

An optional `history` array (`[{ "role": "user" | "assistant", "content": "…" }]`) may be sent so the
model sees recent turns. It is **untrusted input**: the server re-types it, caps it at 24 turns and
`OSTRA_MAX_MESSAGE_LENGTH` per entry, drops unknown roles, and never uses it for anything
privileged.

Errors are always safe and shaped like this — no stack traces, no upstream URLs, no env values:

```json
{ "error": { "code": "message_too_long", "message": "`message` must be 8000 characters or fewer." }, "requestId": "6d89dc17" }
```

Status codes: `400` invalid input · `413` body too large · `415` wrong content type ·
`429` rate limited · `499` client cancelled · `502` model endpoint failed ·
`503` model not configured · `504` model timeout · `500` internal.

### `GET /api/health`

```json
{
  "status": "ok",
  "system": "ostra",
  "version": "0.1.0",
  "mode": "mock",
  "provider": "mock",
  "model": "ostra-experimental",
  "endpointConfigured": false,
  "apiFormat": "openai",
  "timestamp": "2026-09-18T06:17:00.634Z"
}
```

## Connecting the experimental model (Kaggle)

Ostra posts JSON to `MODEL_API_URL` **from the server**, so the endpoint needs no CORS headers, and
`MODEL_API_KEY` stays hidden. Any endpoint that accepts a POST and returns JSON or plain text works.

Default request body (`MODEL_API_FORMAT=openai`):

```json
{
  "model": "ostra-experimental",
  "messages": [
    { "role": "system", "content": "You are Ostra, …" },
    { "role": "user", "content": "Hello" }
  ],
  "temperature": 0.7,
  "max_tokens": 768,
  "stream": false
}
```

`MODEL_API_FORMAT=simple` adds a `prompt` field with the latest user message, for notebooks that
expect a single string.

The response parser accepts OpenAI-style replies plus the flat shapes small self-hosted servers tend
to return: `choices[0].message.content`, `choices[0].text`, `message`, `response`, `output`,
`content`, `text`, `generated_text`, `completion`, `result`, or a plain-text body. `usage` tokens are
picked up when present.

A minimal Kaggle-side endpoint (FastAPI + ngrok, inside the notebook):

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Turn(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[Turn] = []

@app.post("/generate")
def generate(body: ChatRequest):
    reply = run_your_model(body.messages)          # your inference call
    return {"choices": [{"message": {"role": "assistant", "content": reply}}]}
```

Then in the hosting environment:

```
MODEL_MODE=http
MODEL_API_URL=https://<your-tunnel>.ngrok-free.app/generate
MODEL_API_KEY=<token your endpoint expects, if any>
MODEL_NAME=ostra-experimental
```

A Kaggle notebook is an experimental host, not a production one — when the model graduates, the same
endpoint contract works on a VPS, a local vLLM/llama.cpp server, or any OpenAI-compatible API.

## Architecture

```
src/
├── app/
│   ├── api/chat/route.ts        # POST /api/chat — the only browser↔model door
│   ├── api/health/route.ts      # GET  /api/health
│   ├── page.tsx                 # control center (conversation surface)
│   ├── tasks/ memory/ settings/ # navigation sections, honest placeholders
│   └── layout.tsx, globals.css  # shell, fonts, dark theme tokens
├── components/
│   ├── app-shell.tsx sidebar.tsx system-status.tsx
│   └── chat/                    # workspace, message list, composer, empty state
├── hooks/use-chat.ts            # React binding for the store
└── lib/
    ├── model/                   # types, config, mock + http providers, registry
    ├── agent/                   # persona + runtime (context hook points)
    ├── api/                     # validation, rate limiting, safe errors
    ├── conversations/           # types, browser repository, external store
    └── chat/controller.ts       # client-side request lifecycle
```

### Where future layers plug in

- **Another model backend** — implement `ModelProvider` (`lib/model/types.ts`) and call
  `registerModelProvider("local", factory)`. Nothing else changes. `MODEL_MODE` selects it.
- **Persistent memory** — `AgentRuntime` accepts `contextProviders`: async functions that return
  extra messages (recalled memories, tool results) placed before the conversation history.
- **Database (Postgres/Supabase)** — `ConversationRepository` (`lib/conversations/types.ts`) is the
  storage seam; swap the browser implementation for a server-backed one. The store already awaits
  repositories, so an async implementation drops in.
- **Tools / task queue / scheduler** — `AgentRuntime.respond()` is framework-free and holds no
  request objects, so a queue worker or cron entrypoint can call the same runtime.
- **Telegram / mobile clients** — they consume `POST /api/chat`, which already returns a stable
  JSON contract.

## Conversations

v0 stores conversations in the browser (`localStorage`, key `ostra.conversations.v1`): id, title,
messages, `createdAt`, `updatedAt`. Stored data is re-validated on load. API keys are never written
to client storage — there are none on the client at all.

## Security posture

- Model credentials exist only in server environment variables, read inside route handlers and the
  runtime. The browser never learns the model URL.
- Every request is validated (`lib/api/validation.ts`): typed body, trimmed message, length cap,
  `conversationId` pattern check, sanitised history.
- Per-IP rate limiting on `/api/chat` (`lib/api/rate-limit.ts`; in-memory per instance — the seam a
  Redis implementation slots into).
- Errors are mapped to codes and safe sentences. Stack traces and provider payloads stay in server
  logs under `[ostra:…]` prefixes.
- Client-provided conversation state is never trusted for anything but text.

Known v0 limitations, stated honestly: there is **no authentication** (anyone with the URL can chat),
no durable server-side storage, and rate limiting is per server instance.

## Deployment

**Vercel**

1. Push this repository to GitHub and import it in Vercel. The framework is detected as Next.js; the
   build command is `next build` and the output is served automatically — no configuration file
   needed.
2. Add environment variables in *Project → Settings → Environment Variables*:
   `MODEL_MODE`, `MODEL_API_URL`, `MODEL_API_KEY`, `MODEL_NAME` (start with `MODEL_MODE=mock` to
   confirm the deployment before linking the model).
3. Deploy, then check `https://<your-app>/api/health` — it should report `status: "ok"`.
4. Switch `MODEL_MODE` to `http`, point `MODEL_API_URL` at the model endpoint, and redeploy. Set the
   same variables for Preview and Production if you want both to work.

**Any Node host** — `bun install && bun run build && bun run start` behind a reverse proxy. API routes
use the Node.js runtime; serverless functions should allow at least 60 s for a chat turn
(`maxDuration` is already exported by the chat route).

## Design notes

Dark control-center interface rather than a generic chat clone: a fixed sidebar with the section
structure already in place (Conversations active, Tasks/Memory/Settings marked "soon"), a persistent
system-status chip that reflects what `/api/health` actually reports, an explicit prototype banner,
per-message timestamps and copy actions, suggested prompts, and honest placeholder pages for the
unbuilt modules.

Mobile is the primary target: 100dvh layout with no horizontal overflow, a slide-over sidebar with a
backdrop and Escape handling, ≥44 px touch targets, an auto-growing input pinned above the safe-area
inset, Enter to send / Shift+Enter for a new line, and a composer that grows to ~8 lines before
scrolling internally.
