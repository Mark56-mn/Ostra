# Ostra Model Selection Architecture — Handoff

## What changed

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
- Silent mock fallback: with no selection the gateway refuses. The mock provider still exists and
  answers, but only through an explicit `provider: "mock"` selection.

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

`bun run test` → **228 passed, 0 failed** (46 suites).

Baseline before this task was **185 passed / 27 failed**: every failure was a stale test asserting
the removed env-driven behaviour (`AI_PROVIDER` resolving a provider, mock-mode health, an
`Invalid AI_PROVIDER` config error). Those tests were updated rather than deleted.

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

- `bun tsc -b --noEmit` — clean.
- `bun run lint` — clean.
- `bun run build` — succeeds (all routes build).
- `bun run test` — 228/228 pass.

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
