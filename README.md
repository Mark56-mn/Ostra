# Ostra — v0.2

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

**v0.2 implements the model link, a multi-provider gateway, and a thin runtime.** No tools, no
persistent memory, no scheduler, no background execution, no authentication, no database. The UI
says so out loud rather than implying capabilities that do not exist.

Live request path:

```
User → Ostra Web UI → POST /api/chat → Agent Runtime → Provider Gateway → Selected Provider → Model endpoint
                                                                          ↓
User ← Ostra Web UI ← JSON response (message, conversationId) ←─────────┘
```

---

## Quick start

```bash
bun install
bun run dev          # http://localhost:3000
```

No configuration is required. With an empty environment Ostra runs in **mock mode**: replies come
from a built-in simulated provider so the whole product can be developed and tested before any
real model endpoint exists.

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # eslint
bun run build        # production build
```

## Provider gateway

Ostra v0.2 routes model calls through a **provider gateway** — a single entry point that resolves
the active provider from environment variables and picks the correct adapter.

```
Browser → POST /api/chat → Agent Runtime → Provider Gateway → Provider Adapter → Provider API
```

### Supported providers

| Provider | API Format | Free Tier | Key Env Var | Notes |
| --- | --- | --- | --- | --- |
| **OpenRouter** | OpenAI-compatible | `:free` model suffix (rate-limited) | `OPENROUTER_API_KEY` | Free models available, availability may change |
| **Groq** | OpenAI-compatible | Rate-limited free (~30 RPM) | `GROQ_API_KEY` | No credit card required, limits may change |
| **Mistral** | OpenAI-compatible | Free tier currently documented | `MISTRAL_API_KEY` | Smaller models, check docs.mistral.ai |
| **NVIDIA NIM** | OpenAI-compatible | Rate-limited free access | `NVIDIA_API_KEY` | 80+ models, limits may change |
| **Google Gemini** | Gemini-native | Free tier currently documented | `GEMINI_API_KEY` | Generous limits, see ai.google.dev |
| **Custom** | OpenAI-compatible | — | `AI_API_KEY` | Any OpenAI-compatible endpoint |
| **Mock** | Built-in | Always free | none | Simulated replies for development |

> Free tiers and model availability change. Verify current status at each provider's documentation.

> Free tiers and model availability change. Do not present any provider as permanently free.
> Verify current status at each provider's documentation before depending on a free tier.

### Switching providers

Switching providers is an **environment variable change**, not a code change:

```bash
# Example: use Groq (fast, generous free tier)
AI_PROVIDER=groq
GROQ_API_KEY=your-groq-key

# Example: use OpenRouter (largest free model catalog)
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-openrouter-key

# Example: use Gemini
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
```

The gateway automatically:
- Selects the correct adapter (OpenAI-compatible or Gemini-native)
- Appends `/chat/completions` to the base URL
- Adds provider-specific headers (e.g. OpenRouter's `HTTP-Referer`)
- Handles timeout, abort signals, and error classification
- Falls back to mock mode when no provider is configured

### Default models

Each provider has a sensible default model. Override with `AI_MODEL`:

| Provider | Default Model |
| --- | --- |
| OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` |
| Groq | `llama-3.3-70b-versatile` |
| Mistral | `ministral-3-8b` |
| NVIDIA | `nvidia/llama-3.1-nemotron-70b-instruct` |
| Gemini | `gemini-2.5-flash` |

### Legacy compatibility

The v0.1 `MODEL_MODE` / `MODEL_API_URL` variables still work:

```bash
MODEL_MODE=http
MODEL_API_URL=https://your-endpoint/v1/chat/completions
MODEL_API_KEY=your-key
```

This is treated as a "custom" OpenAI-compatible provider. The new `AI_PROVIDER` system takes
priority when both are set.

## Environment variables

Copy `env.example` to `.env.local` and set the keys you need:

```bash
cp env.example .env.local
```

### Provider routing

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | no | Active provider: `openrouter`, `groq`, `mistral`, `nvidia`, `gemini`, `custom`, `mock` |
| `AI_MODEL` | no | Model ID override (each provider has a default) |
| `AI_API_KEY` | no | Generic key override (provider-specific keys take priority) |
| `AI_BASE_URL` | no | Base URL override (each provider has a default) |

### Provider API keys (only the active provider needs one)

| Variable | Provider |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter |
| `NVIDIA_API_KEY` | NVIDIA NIM |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral |

### Legacy model variables (still supported)

| Variable | Purpose |
| --- | --- |
| `MODEL_MODE` | `mock` or `http` (auto-selects if unset) |
| `MODEL_API_URL` | Full URL of a custom model endpoint |
| `MODEL_API_KEY` | Bearer token for custom endpoint |
| `MODEL_NAME` | Model identifier (default `ostra-experimental`) |

### Application parameters

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_TIMEOUT_MS` | `60000` | Per-call timeout |
| `MODEL_MAX_TOKENS` | `1024` | Max tokens in response |
| `MODEL_TEMPERATURE` | `0.7` | Sampling temperature |
| `OSTRA_MAX_MESSAGE_LENGTH` | `8000` | Max accepted user message |
| `OSTRA_RATE_LIMIT_MAX` | `30` | Per-IP chat rate limit |
| `OSTRA_RATE_LIMIT_WINDOW` | `60` | Rate limit window (seconds) |

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
  "model": "llama-3.1-8b-instant",
  "provider": "groq",
  "mode": "live",
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
  "mode": "live",
  "provider": "groq",
  "model": "llama-3.1-8b-instant",
  "endpointConfigured": true,
  "apiFormat": "openai-compatible",
  "timestamp": "2026-09-20T12:00:00.000Z"
}
```

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
    ├── providers/               # provider gateway, registry, config, adapters
    ├── model/                   # types, config, mock + http providers, registry
    ├── agent/                   # persona + runtime (context hook points)
    ├── api/                     # validation, rate limiting, safe errors
    ├── conversations/           # types, browser repository, external store
    └── chat/controller.ts       # client-side request lifecycle
```

### Where future layers plug in

- **Another provider** — add a `ProviderDefinition` to `lib/providers/registry.ts` and implement
  the adapter if it's not OpenAI-compatible. Nothing else changes. `AI_PROVIDER` selects it.
- **Persistent memory** — `AgentRuntime` accepts `contextProviders`: async functions that return
  extra messages (recalled memories, tool results) placed before the conversation history.
- **Database (Postgres/Supabase)** — `ConversationRepository` (`lib/conversations/types.ts`) is the
  storage seam; swap the browser implementation for a server-backed one.
- **Tools / task queue / scheduler** — `AgentRuntime.respond()` is framework-free and holds no
  request objects, so a queue worker or cron entrypoint can call the same runtime.
- **Telegram / mobile clients** — they consume `POST /api/chat`, which already returns a stable
  JSON contract.

## Conversations

v0.2 stores conversations in the browser (`localStorage`, key `ostra.conversations.v1`): id, title,
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
   - Start with `AI_PROVIDER=mock` (or leave unset) to confirm the deployment works.
   - Then set `AI_PROVIDER=groq` and `GROQ_API_KEY=your-key` for a live provider.
3. Deploy, then check `https://<your-app>/api/health` — it should report `status: "ok"`.
4. Switch providers by changing `AI_PROVIDER` and the corresponding key. No code changes needed.

See `DEPLOY.md` for a detailed deployment walkthrough.

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
