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

No configuration is required to boot, but **Ostra has no default provider and no default model**.
Set the API key of any provider you want to use, then select that provider and model in the chat
header (or set a workspace default in `/models`). A chat sent with no selected provider/model is
refused with `409 model_not_selected` — Ostra never silently picks one for you.

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

| Provider | API Format | Free Tier (verified 2026-09-20) | Key Env Var | Notes |
| --- | --- | --- | --- | --- |
| **OpenRouter** | OpenAI-compatible | Models with a `:free` suffix currently serve at $0 (rate-limited) | `OPENROUTER_API_KEY` | Free list changes frequently — check openrouter.ai before depending on it |
| **Groq** | OpenAI-compatible | **Paid** — no free tier currently documented | `GROQ_API_KEY` | Llama models are Enterprise-only; developer plan is usage-based |
| **Mistral** | OpenAI-compatible | **Paid** — no free API tier currently documented | `MISTRAL_API_KEY` | Paid plans include monthly API credits; the free consumer plan does not cover the API |
| **NVIDIA NIM** | OpenAI-compatible | Free trial credits currently documented | `NVIDIA_API_KEY` | Credit availability and limits may change |
| **Google Gemini** | Gemini-native | Free usage tier currently documented (rate-limited) | `GEMINI_API_KEY` | Limits vary per model and tier — see ai.google.dev |
| **Custom HTTP** | OpenAI-compatible | — | `MODEL_API_KEY` (optional) | Any OpenAI-compatible endpoint (Kaggle tunnel, VPS, llama.cpp, …) via `MODEL_API_URL` |
| **Mock** | Built-in | Always free | none | Simulated replies — only when explicitly selected |

> Free tiers and model availability change. Verify current status at each provider's documentation.

> Free tiers and model availability change. Do not present any provider as permanently free.
> Verify current status at each provider's documentation before depending on a free tier.

### Selecting a provider

Switching providers is a **selection in the UI**, not a code or environment change. The selected
provider and model are the only routing authority:

```
Chat header model selector  →  POST /api/chat { model: { provider, model } }
                           →  /api/models/select "Use as default" (workspace default)
                           →  /api/chat → AgentRuntime → Gateway → selected provider adapter
```

The environment supplies **credentials and endpoints** only. Configure the key of every provider
you want selectable:

```bash
# OpenRouter (models with a :free suffix currently serve at $0)
OPENROUTER_API_KEY=your-openrouter-key

# NVIDIA NIM
NVIDIA_API_KEY=your-nvidia-key

# Gemini (free usage tier currently documented)
GEMINI_API_KEY=your-gemini-key

# Groq (paid — no free tier currently documented)
GROQ_API_KEY=your-groq-key
```

Providers without a key appear in the catalog but are locked, and selecting one returns
`409 key_missing`. The gateway automatically:
- Selects the correct adapter (OpenAI-compatible or Gemini-native)
- Appends `/chat/completions` to the base URL
- Adds provider-specific headers (e.g. OpenRouter's `HTTP-Referer`)
- Handles timeout, abort signals, and error classification

### No global default provider or model

`AI_PROVIDER` and `AI_MODEL` are **no longer read anywhere in the application**. Ostra has no
global default model, and there is no hidden OpenRouter/Qwen/NVIDIA fallback:

- Every chat turn runs on the model the user selected (per request) or the **deliberate workspace
  default** set in `/models` ("Use as default").
- If neither exists, `/api/chat` returns `409 model_not_selected`:
  *"No AI model selected. Select a provider and model before starting a chat."*
- The mock provider answers only when it is **explicitly** selected — never as a fallback.

### Custom HTTP endpoint

The custom OpenAI-compatible endpoint is a first-class, explicitly selectable provider
(`custom-http`), not an env-driven default:

```bash
MODEL_API_URL=https://your-endpoint/v1     # endpoint configuration
MODEL_API_KEY=your-key                     # only if the endpoint requires auth
MODEL_NAME=Qwen/Qwen3-1.7B                 # the model id that endpoint serves
```

Then select `custom-http` + that model in the UI. The endpoint is never hard-coded in the
repository, and a custom selection with no `MODEL_API_URL` is rejected (`409 endpoint_missing`)
rather than rerouted to another provider.

## Environment variables

Copy `env.example` to `.env.local` and set the keys you need:

```bash
cp env.example .env.local
```

### Provider credentials and endpoints

> **Provider and model are selected explicitly by the user/application selection layer.**
> Environment variables provide credentials and endpoint configuration where required — never the
> user's hidden model choice. `AI_PROVIDER` and `AI_MODEL` are no longer read.

| Variable | Required | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | **removed** | No longer read; there is no global default provider |
| `AI_MODEL` | **removed** | No longer read; there is no global default model |
| `AI_API_KEY` | no | Generic key, used only by the `custom-http` provider |
| `AI_BASE_URL` | **removed** | No longer read; each provider uses its own documented base URL |

### Provider API keys (only the active provider needs one)

| Variable | Provider |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter |
| `NVIDIA_API_KEY` | NVIDIA NIM |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral |
| `MODEL_API_KEY` | Custom HTTP endpoint (optional — only if it requires auth) |

### Custom HTTP variables

| Variable | Purpose |
| --- | --- |
| `MODEL_API_URL` | Base URL of the OpenAI-compatible endpoint selected as `custom-http` |
| `MODEL_API_KEY` | Bearer token for that endpoint (optional) |
| `MODEL_NAME` | Model id that endpoint serves |
| `MODEL_MODE` | Legacy `lib/model` helper only — it cannot route a chat request |

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
  "model": "nvidia/nemotron-3.5-lightning:free",
  "provider": "openrouter",
  "mode": "live",
  "latencyMs": 412
}
```

An optional `history` array (`[{ "role": "user" | "assistant", "content": "…" }]`) may be sent so the
model sees recent turns. It is **untrusted input**: the server re-types it, caps it at 24 turns and
`OSTRA_MAX_MESSAGE_LENGTH` per entry, drops unknown roles, and never uses it for anything
privileged.

An optional `model` field — `{ "provider": "openrouter", "model": "…" }` — selects an allowlisted
provider/model for this turn (Stage 2). The server validates it against its catalog and rejects
non-allowlisted models (`400 model_not_allowed`) and providers without a configured key
(`409 key_missing`).

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
  "version": "0.2.0",
  "mode": "provider",
  "provider": "openrouter",
  "model": "nvidia/nemotron-3.5-lightning:free",
  "endpointConfigured": true,
  "keyPresent": true,
  "adapter": "openai-compatible",
  "providers": [
    { "id": "openrouter", "active": true, "keyPresent": true, "keyEnvVar": "OPENROUTER_API_KEY", "freeTier": true }
  ],
  "timestamp": "2026-09-20T12:00:00.000Z"
}
```

`mode` is `mock` in development (no provider configured) or `provider` when a provider is active.
Status is `ok` (working), `degraded` (provider set but key missing) or `error` (invalid config).
Only key **presence** is reported — never key values.

### `GET /api/models`

The server-controlled model catalog for the Model Control Center (`/models`):

```json
{
  "providers": [
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "keyEnvVar": "OPENROUTER_API_KEY",
      "keyPresent": true,
      "freeTier": true,
      "models": [
        { "id": "nvidia/nemotron-3.5-lightning:free", "name": "Nemotron 3.5 Lightning (Free)", "free": true }
      ]
    }
  ],
  "active": { "mode": "provider", "provider": "openrouter", "model": "nvidia/nemotron-3.5-lightning:free" },
  "defaultSelection": { "provider": "openrouter", "model": "nvidia/nemotron-3.5-lightning:free" }
}
```

### `POST /api/models/select`

Deliberate model selection (Stage 2). Two shapes:

```json
{ "provider": "openrouter", "model": "qwen/qwen3.8-27b:free", "role": "general" }
```

```json
{
  "name": "Build feature X",
  "models": [
    { "provider": "openrouter", "model": "nvidia/nemotron-3.5-lightning:free", "role": "planner" },
    { "provider": "gemini", "model": "gemini-2.5-flash", "role": "coder" }
  ]
}
```

Roles: `planner`, `coder`, `reviewer`, `executor`, `general`. Selections are validated against the
server catalog; unknown providers, non-allowlisted models, duplicate roles and providers without a
configured key are rejected. Nothing is executed by saving a configuration — Stage 2 only
*configures* which models a future task would use.

## Architecture

```
src/
├── app/
│   ├── api/chat/route.ts        # POST /api/chat — the only browser↔model door
│   ├── api/health/route.ts      # GET  /api/health
│   ├── api/models/route.ts      # GET  /api/models — server-controlled catalog
│   ├── api/models/select/       # POST /api/models/select — validated selection
│   ├── models/page.tsx          # Model Control Center (Stage 2 UI)
│   ├── page.tsx                 # control center (conversation surface)
│   ├── tasks/ memory/ settings/ # navigation sections, honest placeholders
│   └── layout.tsx, globals.css  # shell, fonts, dark theme tokens
├── components/
│   ├── app-shell.tsx sidebar.tsx system-status.tsx
│   ├── chat/                    # workspace, message list, composer, empty state
│   └── models/                  # Model Control Center client component
├── hooks/use-chat.ts            # React binding for the store
└── lib/
    ├── providers/               # gateway, registry, catalog, config, adapters
    ├── model/                   # types, config, mock + http providers
    ├── model-selection/         # Stage 2: allowlist validation + selection store
    ├── agent/                   # persona + runtime (context hook points)
    ├── api/                     # validation, rate limiting, safe errors
    ├── conversations/           # types, browser repository, external store
    ├── tasks/types.ts           # typed task configuration schema
    └── chat/controller.ts       # client-side request lifecycle
tests/                           # 85 tests: routing, gateway, security, selection
```

## Model & Tool Control Center (Stage 2)

The `/models` page is the control layer for models, tools and integrations. Its rules:

- The catalog is **server-controlled and allowlisted** — the UI can only offer what
  `src/lib/providers/catalog.ts` lists, and every selection is re-validated server-side.
- API keys never reach the browser. The catalog reports only whether a key is *present*.
- Providers without a configured key are locked; selecting one returns `409 key_missing`.
- A **default model** is one deliberate selection; a **task configuration** assigns up to 5 models
  with roles (`planner`, `coder`, `reviewer`, `executor`, `general`). Duplicate models/roles are
  rejected.
- Saving a task configuration executes nothing. There is no queue and no autonomy loop yet —
  those are Stages 3–4 and are not faked.

### Where future layers plug in

### Tools (Stage 2)

The tool registry (`src/lib/tools/`) is provider-independent and server-controlled:

- **Tool registry** — every tool is an allowlisted `ToolDefinition` (id, category, JSON-Schema
  input, execution type `openrouter | vercel-connect | native | external`, permission level
  `read → write → execute → external_action → financial → destructive`, risk level, approval flag).
- **OpenRouter server tools** — `openrouter:web_search`, `web_fetch`, `datetime`, `shell`,
  `image_generation` are attached to model requests and executed by OpenRouter server-side
  (`max_tool_calls` caps the agent loop at ≤30). The model decides when to call them; Ostra only
  declares them and enforces compatibility.
- **Model ↔ tool compatibility** — a tool is only attachable when the model's *verified*
  capability registry entry supports it. Unverified capability → refusal with a structured error,
  never a guess.
- **Permissions & approval** — `financial`/`destructive` tools always require explicit
  confirmation and can never be configured to skip it. `external_action` tools are
  approval-gated by default. Enable/disable happens through `POST /api/tools/configure`.
- **Native execution** — `POST /api/tools/execute` runs the full pipeline (registry → config →
  compatibility → permission → schema validation → adapter). Vercel Connect execution returns
  `501` until Stage 3 wires per-connector operations.

### Integrations (Vercel Connect + env-backed adapters)

`src/lib/integrations/` mirrors the **current** Vercel Connect catalog (vercel.com/connect/browse,
fetched 2026-09-21): 12 tier-1 integrations (GitHub, Vercel, Supabase, Mem0, Firecrawl, AgentMail,
Google, Cloudflare, Notion, Slack, Telegram Bot, Zapier) enabled in the registry by default, plus
~45 tier-2 connectors registered but disabled. The API distinguishes honestly between
available / connected / enabled / authorized / unavailable — a connector existing in Vercel is
never reported as connected. Connection verification uses `@vercel/connect` scoped runtime
credentials (deployment OIDC → short-lived provider token, never persisted, never returned).

**Env-backed adapters:** the concrete integration operations
(`github.list_repositories`, `mem0.search_memory`, `mem0.save_memory`) also execute through plain
server-side credentials — `GITHUB_TOKEN` (or `GITHUB_PERSONAL_ACCESS_TOKEN`) and `MEM0_API_KEY` —
which is how Vercel Marketplace integration keys reach the runtime. A live Connect grant takes
priority when both exist. Credential **presence** is reported via `envCredential` (the variable
name only) on `/api/integrations` and `/api/tools`; values never appear in any API response, log,
or model context. When Mem0 is execution-ready, memory-dependent messages automatically trigger
server-side memory recall, and the chat response reports `memoryRecalled: true`.

Endpoints: `GET /api/tools`, `/api/tools/[id]`, `/api/integrations`, `/api/integrations/[id]`
(`?probe=1` performs a live connection probe), `POST /api/tools/validate`, `/api/tools/execute`,
`/api/tools/configure`.

### Where future layers plug in

- **Another provider** — add a `ProviderDefinition` to `lib/providers/registry.ts`, list its models
  in `lib/providers/catalog.ts`, and implement the adapter only if it is not OpenAI-compatible.
  Nothing else changes; the user selects it in the UI like any other provider.
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
   - Start with no configuration to confirm the deployment boots (chat is refused with
     `409 model_not_selected` until a provider and model are selected).
   - Then set `OPENROUTER_API_KEY=your-key` for a live provider
     (models with a `:free` suffix currently serve at $0), or `NVIDIA_API_KEY` +
     `NVIDIA_API_KEY=your-key` for Nemotron 3.5 Lightning 30B A3B.
3. Deploy, then check `https://<your-app>/api/health` — it should report `status: "ok"`.
4. Switch providers in the UI (chat header selector or `/models`). No code changes needed.

See `DEPLOY.md` for a detailed deployment walkthrough.

## Future infrastructure

Ostra is designed so the execution backend can change without rewriting the agent architecture.

**Current direction:** Cloudflare (Workers, D1, Queues, Workflows, Durable Objects) is the planned
infrastructure for the persistent task queue, autonomy runtime, and long-running background work
once those stages are built. Cloudflare is **not** a permanent lock-in — when a VPS becomes
available, Ostra can run lightweight workloads on Cloudflare and heavy/long-running workloads on a
VPS worker simultaneously.

```
Vercel (website)
  |
  v
Cloudflare control plane (planned)
  +--> D1 / state
  +--> Queues
  +--> Workflows
  +--> Durable Objects
  |
  v
Ostra Agent Runtime
  |
  v
Model Gateway (OpenRouter / Groq / Gemini / NVIDIA / Mistral)
```

The VPS path remains architecturally possible at every stage:

```
Vercel (website)
  |
  v
API / Control Plane
  |
  v
Persistent DB / Queue
  |
  v
Ostra Worker (VPS)
  +--> Model Gateway
  +--> Tools
  +--> Memory
```

Infrastructure-specific code is isolated behind interfaces/adapters so workloads can move between
Cloudflare and VPS without rewriting the agent runtime, task system, or model gateway.

**Stage 1 (current):** provider gateway + web communication only. No Cloudflare or VPS backend
infrastructure is implemented yet.

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
