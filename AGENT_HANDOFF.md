# Ostra Model Selection Architecture — Handoff

## Follow-up: UI honesty gaps (all five fixed)

A follow-up audit found five places where the interface claimed or implied something the server did
not actually do. All are fixed, with regression coverage in
`tests/providers/ui-honesty.test.ts` (14 new tests; suite is 242/242).

1. **The UI defaulted to OpenRouter.** `model-control-center.tsx` seeded its active provider from
   `providers[0]?.id`, and `openrouter` is first in `PROVIDERS` — so `/models` always opened on
   OpenRouter, making it look like a hidden default. The Control Center now starts on an explicit
   "No provider selected" state. Catalog order is unchanged (it is a registry) but nothing selects
   by position; a test asserts `/api/chat` never references `providers[0]`.
2. **The chat banner and persona understated the system.** The banner claimed "tools, persistent
   memory and scheduling are not wired up yet" while the sidebar said memory and GitHub were live,
   and `OSTRA_CAPABILITIES` listed "Tools & memory" as `planned`. Corrected in
   `chat-workspace.tsx` and `persona.ts`; the capabilities list now reflects the provider gateway,
   tool pipeline, memory and integrations as active, with only the scheduler planned.
3. **`keyPresent` was wrong.** `config-status.ts` derived it from the custom endpoint alone, so
   `/api/models` reported `keyPresent: false` even with `OPENROUTER_API_KEY` set, and the Control
   Center rendered "no provider keys" next to a selectable OpenRouter row. It is now
   "is any provider usable". Note the nuance: for `custom-http`, `keyPresent` means *endpoint
   configured*, so a keyless local endpoint legitimately counts as usable.
4. **The mock provider was unreachable, and the docs claimed otherwise.** `/api/chat` had a
   `provider === "mock"` branch that sat *after* validation — but `mock` is not in `PROVIDERS`, so
   `validateModelSelection` threw `unknown_provider` first. Had it been reachable it would have
   silently **dropped** the caller's selection rather than routing to it. The dead branch is removed;
   the mock is now documented as a gateway-internal adapter for tests/harnesses, not a selectable
   provider.
5. **Locked providers were still clickable.** `model-selector.tsx` set `aria-disabled` on keyless
   providers but left `onClick` live, so a user could select a model that then failed with
   `409 key_missing` on send. The buttons are now genuinely `disabled` with an explanatory title,
   and a stale stored preference pointing at a keyless provider is labelled "· no key" instead of
   looking valid.

## What changed (original task)

- **The environment no longer chooses a provider or model.** `AI_PROVIDER` and `AI_MODEL` are no
  longer read anywhere in the application. There is no global default provider, no global default
  model, and no fallback provider.
- **`src/lib/providers/config.ts` is now credentials/endpoints only.** It resolves the custom
  endpoint (`MODEL_API_URL` / `MODEL_API_KEY` / `MODEL_NAME`) and shared run parameters. The
  `mode` / `provider` / `configError` fields (which existed only for the env-driven path) are gone.
- **The gateway routes strictly on the caller's selection.** `callProvider()` requires
  `options.providerOverride`; with no selection it throws `model_not_selected` instead of falling
  back. The `custom-http` provider resolves its endpoint from `MODEL_API_URL` and no longer
  requires an API key (a local endpoint may be keyless).
- **`custom-http` is a first-class registered provider** (`src/lib/providers/registry.ts`), with
  `getProviderBaseUrl()` supplying its endpoint. It is explicitly selectable, validated by
  `isModelAllowed()` (safe model-id shape, endpoint must be configured), and rejected with
  `409 endpoint_missing` when `MODEL_API_URL` is absent.
- **`/api/chat` requires an explicit selection.** The effective model is the request's `model`
  field, else the workspace default; with neither it returns
  `409 model_not_selected` — "No AI model selected. Select a provider and model before starting a
  chat." `selectionSource` is now only `"request" | "workspace"`.
- **`/api/models`, `/api/models/select` and `/api/health` report honestly.** `active.provider` is
  `"none"`, `defaultSelection` is `null` when unset, health `mode` is `"unselected" | "ready"`, and
  `status` is `"unconfigured"` when no provider is usable. `configError` is gone (it only ever
  reported an invalid `AI_PROVIDER`).
- **UI truthfulness only** (no redesign): the status chip shows "No model selected" instead of
  "Mock mode", the empty state and Settings page no longer claim a mock/active provider, and the
  Model Control Center shows selectable providers instead of `active: provider / model`.
- `AI_BASE_URL` is no longer read (it could silently redirect any selected provider to another
  endpoint). `AI_API_KEY` is now used only by the `custom-http` provider.
- `tsconfig.json` excludes the untracked stale duplicate at `isolate/` (it was being typechecked
  and duplicated the project's source).

## Removed

- `AI_PROVIDER` / `AI_MODEL` env routing and its `configError` validation path.
- `AI_BASE_URL` as a global base-URL override.
- The legacy `MODEL_MODE=http` + `MODEL_API_URL` path *auto-winning* when nothing was selected —
  those variables are kept, but only as endpoint/credential configuration for `custom-http`.
- Silent mock fallback: with no selection the gateway refuses. The mock adapter still exists and
  answers, but only for a direct `callProvider()` caller (tests, local harnesses) — it is not a
  catalogued provider and is not selectable through the UI or `/api/chat`.

## Preserved

- Provider registry, provider catalog (`/models`, `/api/models`), model-selection UI, the gateway,
  the adapters (OpenAI-compatible + Gemini), `AgentRuntime`, custom HTTP support, the whole tool
  pipeline, memory recall, rate limiting, security validation, conversation storage, and all
  unrelated API routes.
- Credentials remain server-side and are reported as presence-only (`keyPresent`, `keyEnvVar`).
- No Kaggle/ngrok/Qwen/Mem0/integration code was touched.

## New request flow

```
Chat header model selector (localStorage)  ─┐
                                            ├─> POST /api/chat { model: { provider, model } }
Workspace default (/models "Use as default") ┘
        ↓ validate (catalog allowlist + key/endpoint present)
        ↓ 409 model_not_selected when neither exists
AgentRuntime.respond({ ..., providerOverride })
        ↓
Gateway callProvider → resolveOverrideProvider(id, model)
        ↓ adapter: OpenAI-compatible | Gemini
Selected provider endpoint (its own base URL; custom-http → MODEL_API_URL)
        ↓
{ message, provider, model, mode, requested, selectionSource, ... }
```

## Files changed

Source:
- `src/lib/providers/registry.ts` — added `custom-http`, `CUSTOM_HTTP_ID`, `getProviderBaseUrl()`.
- `src/lib/providers/config.ts` — credentials/endpoints only; added `isCustomEndpointConfigured()`,
  `isProviderKeyPresent()`, `getRunSettings()`.
- `src/lib/providers/config-status.ts` — `mode: unselected | ready`, per-provider
  `endpointConfigured`, no `configError`.
- `src/lib/providers/gateway.ts` — selection-only routing, `model_not_selected`, custom-http keyless.
- `src/lib/providers/catalog.ts` — `endpointConfigured`, custom-http model handling, safe model ids.
- `src/lib/providers/index.ts`, `src/lib/providers/types.ts` — exports/comments.
- `src/lib/model-selection/service.ts` — new `endpoint_missing` error code; custom-http path.
- `src/lib/model/config.ts` — doc comment: MODEL_* is no longer a routing authority.
- `src/lib/system/health.ts`, `src/lib/system/info.ts` — new payload shapes/types.
- `src/app/api/chat/route.ts` — explicit selection required; no legacy source.
- `src/app/api/models/route.ts`, `src/app/api/models/select/route.ts` — no env-driven active model.
- `src/app/settings/page.tsx` — no more "set AI_PROVIDER" instructions.
- `src/components/system-status.tsx`, `src/components/chat/empty-state.tsx`,
  `src/components/chat/model-selector.tsx`, `src/components/models/model-control-center.tsx` —
  honest status labels only.
- `tsconfig.json` — exclude `isolate`.

Tests:
- `tests/providers/explicit-selection.test.ts` (new — the 7 required behaviours).
- `tests/providers/routing.test.ts`, `tests/providers/gateway.test.ts`,
  `tests/providers/mock.test.ts`, `tests/api/routes.test.ts`, `tests/api/health.test.ts`,
  `tests/tools/gateway-tools.test.ts` — updated to the new architecture.
- `tests/verify-tool-loop.ts`, `tests/verify-v1-integrations.ts`, `tests/verify-web-fetch.ts` —
  standalone harnesses now pass an explicit `custom-http` selection.

Docs: `README.md`, `env.example`, this file.

## Tests

`bun run test` → **242 passed, 0 failed** (50 suites). Baseline before the original task was
**185 passed / 27 failed**; `tests/providers/ui-honesty.test.ts` adds the 14 follow-up tests.

The new `tests/providers/explicit-selection.test.ts` covers the required cases:
1. no global provider default (nothing called when no selection);
2. no global model default (`AI_PROVIDER`/`AI_MODEL` ignored even when set);
3. the explicit selection reaches the gateway (right host, model and key);
4. provider switching takes effect on the next request, incl. through `/api/chat`;
5. custom HTTP reaches the OpenAI-compatible adapter (endpoint from `MODEL_API_URL`, no hard-coded
   URL, no live endpoint needed — fetch is stubbed);
6. a missing selection returns a clear, secret-free error;
7. the provider/model catalog still lists providers, models and key presence.

## Build/typecheck/lint

- `bun run typecheck` — clean.
- `bun run lint` — clean.
- `bun run build` — succeeds (all routes build).
- `bun run test` — 242/242 pass (50 suites).

## Remaining limitations

- The workspace default lives in an in-memory store (`model-selection/store.ts`): it survives
  revalidation but not a cold start. Unchanged by this task; the store shape is still the
  persistence seam.
- `custom-http` cannot pre-list its models. The catalog offers `MODEL_NAME` when set, and any
  well-formed model id is accepted as an explicit selection for that endpoint.
- `/api/health` reports configuration readiness, not which model answered a given request — that
  proof is in the `/api/chat` response (`provider`, `model`, `requested`, `selectionSource`).
- `docs/OSTRA_IMPLEMENTATION_TASK.md` still describes the old `AI_PROVIDER`/`AI_MODEL` design. It
  is a historical task report and was deliberately left unedited.
- An untracked `isolate/` copy of an older snapshot of the repo still exists on disk. It is now
  excluded from `tsc`; delete it if it is not needed.

## Next recommended task

Make the workspace default durable (persist `model-selection/store.ts` in the server-side storage
already used for conversations), so an explicit selection survives restarts and cold starts
without reintroducing any environment-driven default.
