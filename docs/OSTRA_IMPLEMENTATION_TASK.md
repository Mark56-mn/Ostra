# Ostra Implementation Task — Multi-Provider Free AI Gateway + Vercel-Ready v0.2

## Objective
Restructure and finish Ostra for immediate Vercel deployment and real-world testing from a phone.
Ostra must NOT be tied to OpenAI. Provider/model switching must be a configuration change, not a code rewrite.

## Current repository
- Next.js 15 + React 19 + TypeScript + Tailwind CSS.
- Existing chat UI, /api/chat, /api/health, model abstraction, mock mode, HTTP provider, validation, rate limiting, local conversation storage and Vercel-oriented deployment docs.
- Preserve useful working architecture. Do not rewrite unnecessarily.
- Mobile/Android browser use is first-class.
- Do not add a database, authentication, billing system or unnecessary infrastructure in this task.

## 1. Provider gateway
Create a clean provider registry/gateway:
Browser -> Ostra /api/chat -> Agent Runtime -> Model Gateway -> Selected Provider -> Selected Model

Support verified free-tier providers where practical:
- OpenRouter
- NVIDIA NIM / NVIDIA API
- Google Gemini API
- Groq
- Mistral
- Additional currently documented free inference providers may be added if they have a genuine usable free tier.

Do not claim any provider is permanently free. Free tiers and model availability change.
Do not hard-code a giant stale model list. Keep provider/model configuration centralized and environment-configurable.

## 2. Provider documentation to verify during implementation
- OpenRouter: https://openrouter.ai/collections/free-models
- OpenRouter pricing: https://openrouter.ai/pricing
- NVIDIA NIM: https://build.nvidia.com/models
- Gemini API: https://ai.google.dev/gemini-api/docs
- Groq: https://console.groq.com/docs
- Mistral: https://docs.mistral.ai/

Verify current official documentation before finalizing provider integration.

## 3. Initial model
Use environment configuration for the initial experimental model.
Initial candidate: NVIDIA Nemotron 3.5 Lightning 30B A3B, using the exact current model identifier confirmed from NVIDIA documentation.
Also make it easy to switch to a current free OpenRouter model without code changes.
Do not present any model as permanently or universally superior.

## 4. Environment configuration
Create/update the environment template with a clear model-routing section, including:
AI_PROVIDER=openrouter
AI_MODEL=<selected-model-id>
AI_API_KEY=
AI_BASE_URL=
OPENROUTER_API_KEY=
NVIDIA_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
MISTRAL_API_KEY=
MODEL_TIMEOUT_MS=60000
MODEL_MAX_TOKENS=1024
MODEL_TEMPERATURE=0.7

Only the selected provider key should be required. Never expose keys through NEXT_PUBLIC_* variables.
Keep backward compatibility with existing MODEL_MODE / MODEL_API_URL variables where practical, or migrate them cleanly and document the change.

## 5. OpenAI-compatible adapter
Several providers expose OpenAI-compatible APIs. Build one reusable adapter supporting:
- base URL
- API key
- model ID
- messages
- temperature
- max tokens
- timeout
- non-streaming response parsing
Use provider-specific adapters only when APIs materially differ.

## 6. Provider switching and fallback
Changing Vercel environment variables and redeploying must be sufficient to switch providers/models.
Optional fallback configuration may include AI_FALLBACK_PROVIDER and AI_FALLBACK_MODEL, but fallback must be disabled unless explicitly configured.
Never silently consume another provider's paid quota.
Never expose provider secrets, upstream authorization headers, stack traces or sensitive upstream payloads.

## 7. Modern Ostra interface
Polish the existing interface into a lightweight modern AI control center.
Required:
- excellent mobile layout
- responsive desktop layout
- Ostra branding
- modern dark interface
- active provider/model indicator
- connection status
- conversation area
- timestamps
- copy response
- retry response
- loading state
- useful empty-state prompts
- accessible 44px-class touch targets
- keyboard support
- phone safe-area support
- no horizontal overflow
Do not add decorative complexity that slows the app.

## 8. Settings
Settings should show the active provider, model, connection status and safe runtime information.
Never show API keys.
Provider/model selection can initially remain server-configured; do not create a client-side API-key form.

## 9. Routes and URLs
Ensure these work:
- / — Ostra chat/control center
- /tasks — future task system placeholder
- /memory — future persistent memory placeholder
- /settings — provider/model/runtime settings
- /api/chat — chat endpoint
- /api/health — health endpoint

Health should safely report application status, provider, model, configuration status, version and timestamp. Never return secrets.

## 10. Vercel readiness
Prepare for direct Vercel deployment.
Verify install, typecheck, lint and production build.
API routes must use a Vercel-compatible runtime.
No filesystem persistence, long-running process or local model process may be required by the Vercel app.
Model inference stays outside Vercel.

Architecture:
Vercel Ostra -> provider API
or later:
Vercel Ostra -> Kaggle/VPS/local inference endpoint

## 11. README
Update README with:
1. What Ostra is.
2. Current capabilities.
3. Architecture.
4. Supported providers.
5. How to obtain provider keys.
6. Current free options and limitations.
7. Provider switching instructions.
8. Vercel deployment instructions.
9. /api/health test.
10. Security notes.
11. How to add a provider.
Do not claim free tiers are permanent.

## 12. Testing
Verify at minimum:
- mock mode works without keys
- OpenAI-compatible request construction
- response parsing
- invalid provider handling
- missing-key handling
- health does not leak secrets
- chat input validation
- provider timeout handling
- provider HTTP error handling
- configuration-based provider switching

## 13. Security
Preserve/improve server-side secrets, input validation, message limits, rate limiting, timeouts, safe errors and no secret logging.
Do not allow arbitrary user-supplied URLs to be fetched.
Do not allow arbitrary provider selection unless it is allowlisted and safe.
Do not make browser-side provider API calls.

## 14. Preserve future Ostra architecture
Keep these seams:
Model = brain
Agent = decision/execution runtime
Tools = actions
Memory = persistent knowledge
Scheduler = autonomy
Website = communication/control

Future tools may include web search, browser automation, GitHub, code execution, files, YouTube, social media, business/store operations and Telegram.
Do not implement all future tools now.

## Definition of done
- Ostra builds successfully.
- Mock mode works.
- At least one verified free provider works.
- A second configured provider can be selected without application-code changes.
- Keys remain server-side.
- /api/health works.
- UI is polished and mobile-friendly.
- Vercel deployment is ready and documented.
- README and environment template are updated.
- No paid service is required for the first real test.

## Manual actions for the human owner
The coding agent must list these clearly at the end:
1. Create API keys/accounts for selected free providers.
2. Add secrets to Vercel Environment Variables.
3. Import/deploy the repository in Vercel.
4. Test /api/health.
5. Send a real chat message.
6. Select a currently available free OpenRouter model if using OpenRouter.
7. Create/use the NVIDIA API key and select a current free endpoint if using NVIDIA.
8. Add Gemini/Groq/Mistral keys and model IDs if those providers are enabled.
9. Later, provide a Kaggle/VPS endpoint URL and optional auth secret if self-hosting a model.

## Important implementation rule
Do not stop at an architectural proposal. Inspect the existing code, preserve working pieces, implement the changes, run available checks, fix build/type/lint errors and leave the repository deployable.
Avoid unnecessary dependencies and giant provider files.
When a provider changes its free tier, Ostra should require configuration/model changes wherever possible, not a rewrite.
    
## 15. Stage 1 implementation status and exact remaining work

The repository has already completed the **v0 foundation** and **Vercel deployment preparation**.

### Already implemented — do not rebuild

The coding agent must preserve these working pieces unless a concrete bug requires a change:

- Next.js 15 + React 19 + TypeScript + Tailwind application.
- Mobile-first Ostra chat/control-center UI.
- `POST /api/chat`.
- `GET /api/health`.
- `AgentRuntime`.
- `ModelProvider` abstraction and provider registry.
- Built-in mock provider.
- Generic HTTP model provider with:
  - OpenAI-compatible request format
  - simple request format
  - bearer authentication
  - timeout/cancellation
  - HTTP error classification
  - tolerant response parsing
  - usage extraction
- Server-side model configuration.
- Browser-local conversation repository and sanitization.
- Input validation, message limits, in-memory rate limiting and safe API errors.
- Settings, Tasks and Memory pages.
- Existing Vercel deployment configuration and deployment documentation.

Do **not** replace the existing model abstraction with a completely different architecture.

### Current implementation reality

The existing provider registry currently contains only:

- `mock`
- `http`

The generic HTTP provider is **not** the same thing as having OpenRouter, NVIDIA, Gemini, Groq and Mistral integrations. Those integrations are still required.

The existing Settings page is read-only. It reports server configuration but does not provide model selection.

Tasks and Memory are placeholders. There is currently no persistent queue, worker, scheduler, persistent memory database or autonomous execution loop.

### Exact Stage 1 job now

Build on the existing code and complete **only the missing Stage 1 model/communication work**:

1. Create a clean provider gateway around the existing `ModelProvider` contract.
2. Add verified integrations for:
   - OpenRouter
   - NVIDIA NIM/API
   - Google Gemini API
   - Groq
   - Mistral
3. Reuse the existing generic OpenAI-compatible HTTP adapter wherever the provider supports it.
4. Add provider-specific adapters only where the API materially differs.
5. Centralize provider/model configuration.
6. Support configuration-based switching without application-code changes.
7. Keep provider/model IDs environment-configurable and current.
8. Add safe provider/model status to Settings and Health.
9. Preserve backward compatibility with `MODEL_MODE`, `MODEL_API_URL`, `MODEL_API_KEY`, `MODEL_NAME` where practical.
10. Add tests for provider routing, request construction, response parsing, missing keys, invalid providers, timeout/error handling and switching.
11. Verify the Vercel production build, typecheck and lint.
12. Update README and environment documentation with the actual implemented providers and current free-tier limitations.

### Important provider rule

Before implementing or finalizing each provider, verify its **current official API documentation and current model/free-tier availability**.

Do not invent model IDs.

Do not assume a model or free tier is permanent.

If a provider cannot be safely integrated because its current API/free access is unavailable, document that fact and keep the gateway extensible rather than adding fake support.

### Initial model

Use the current NVIDIA Nemotron 3.5 Lightning 30B A3B model only if the exact current identifier and usable API access are verified during implementation.

Also configure at least one currently usable free OpenRouter model when available.

Do not hard-code either provider as permanently free.

### Definition of done for the current agent task

The task is complete only when:

- Existing Ostra v0 functionality still works.
- Mock mode still works without external keys.
- At least one real provider is successfully integrated and testable.
- A second provider can be selected through configuration without changing application code.
- Provider credentials remain server-side.
- `/api/health` reports safe provider/model/configuration status.
- Settings reports the active provider/model safely.
- Provider switching is documented.
- Tests/checks pass or any unavoidable environment limitation is explicitly documented.
- Vercel deployment remains compatible.
- No fake autonomy, fake queue, fake memory or fake tool execution is added.

### Required final report from the coding agent

At the end of the implementation, report:

1. Files changed.
2. Providers actually implemented.
3. Exact model IDs used/tested.
4. Which providers were verified against current official documentation.
5. Which provider keys are required.
6. Tests/checks run and their results.
7. Any provider/API/free-tier limitations discovered.
8. Exact manual Vercel environment variables the human owner must add.
9. A short list of what remains for Stage 2.

## 16. Stage 2 — model selection and task routing

After Stage 1 works, build a real **Model Control Center** in the Ostra website.

The user should be able to see an allowlisted catalog of configured providers and models, for example:

Provider
  -> NVIDIA
     -> Model A
     -> Model B

Provider
  -> OpenRouter
     -> Model A
     -> Model B

Provider
  -> Gemini
     -> Model A

The catalog must be server-controlled/allowlisted and must never expose API keys.

The user should be able to select:
- one model for a task
- multiple models for a task
- a default model
- optionally a model role such as planner, coder, reviewer or executor

Multiple models must be treated as a deliberate task configuration, not as automatic uncontrolled parallel spending.

A future task could therefore contain:

{
  "task": "Build the Ostra settings page",
  "models": [
    { "provider": "openrouter", "model": "..." },
    { "provider": "nvidia", "model": "..." }
  ]
}

The exact task schema should be designed during Stage 2.

## 17. Stage 3 — persistent task queue

Ostra needs a real task queue rather than a chatbot that only responds to one request at a time.

Future architecture:

User
  -> Task
  -> Persistent Task Queue
  -> Agent Worker
  -> Model Gateway
  -> Tools
  -> Result
  -> Next Task

Requirements:
- tasks survive page refreshes and browser disconnects
- tasks have states such as queued, running, waiting, completed, failed and cancelled
- tasks can be retried safely
- task results and logs are persisted
- the worker can process tasks sequentially
- one task can create the next task
- failures do not destroy the queue
- long-running work must not depend on a browser tab remaining open

This will require persistent backend infrastructure. Vercel alone should not be treated as the long-running worker.

## 18. Stage 4 — autonomy loop

After the persistent queue works, add the actual autonomous runtime.

Conceptually:

Goal
  -> Plan
  -> Select model(s)
  -> Execute step
  -> Observe result
  -> Update task state/memory
  -> Decide next step
  -> Continue until completed, blocked or human approval is required

The agent must be able to continue from one task to the next without the user manually prompting every step.

Autonomy must include explicit limits:
- maximum steps/iterations
- timeout
- budget/rate limits
- tool allowlist
- approval gates for risky actions
- cancellation
- recovery after errors
- audit logs

The autonomy system must not imply that the AI can take arbitrary irreversible actions without controls.

## 19. Stage 5 — tools and real-world execution

Only after the queue and autonomy runtime are reliable should we add tools such as:
- web search
- browser automation
- GitHub
- code execution
- files
- YouTube/video workflows
- social media
- store/business operations
- email
- Telegram

Each tool should have:
- a typed interface
- permissions
- validation
- timeout
- safe error handling
- audit logging
- approval requirements where appropriate

## 20. Stage 6 — persistent memory

Add durable memory after the task/runtime foundation is stable.

Memory should be separated into:
- conversation context
- task state
- user preferences/instructions
- durable knowledge
- tool results
- agent-generated notes

Memory must have clear boundaries so model context does not become an uncontrolled dump of old conversations.

## 21. Stage 7 — long-running infrastructure

For true autonomy, move the worker/runtime off the Vercel request lifecycle.

Target architecture:

Ostra Website (Vercel)
        |
        v
API / Control Plane
        |
        v
Persistent DB / Queue
        |
        v
Ostra Worker
        |
        +--> Model Gateway
        |
        +--> Tools
        |
        +--> Memory

The worker can initially run on a low-cost VPS or another suitable always-on compute service.

Kaggle should remain an experimentation environment, not the permanent autonomous worker.

## 22. What "Ostra should not shut down" means

The website can be closed without stopping queued work.

A browser tab closing must NOT terminate a task.

The long-running worker should:
- poll/consume queued work
- checkpoint task progress
- continue after transient provider failures
- resume recoverable tasks after worker restarts
- record state persistently

This is a future backend/worker requirement, not a Stage 1 requirement.

## 23. Final roadmap

Stage 1 — **Now**
- Complete the existing v0 foundation rather than rebuilding it
- Multi-provider gateway
- Verified free-provider integrations
- Configuration-based model switching
- Safe provider/model status
- Modern website polish where needed
- Vercel deployment
- Tests and documentation

Stage 2 — **After Stage 1**
- Website model catalog
- Select one or multiple models per task
- Task configuration
- Model roles

Stage 3
- Persistent task queue
- Sequential task execution
- Task states/results/logs
- Worker process

Stage 4
- Autonomous planning/execution loop
- Continue task -> task automatically
- Recovery, limits and approval gates

Stage 5
- Real tools and external actions

Stage 6
- Persistent structured memory

Stage 7
- Always-on VPS/worker infrastructure
- Production hardening
- Provider failover and scaling

Do not skip directly to Stage 4 before Stage 1-3 are reliable.

## 24. Immediate verification/fix pass — REQUIRED BEFORE STAGE 2

The previous coding agent implemented the multi-provider gateway, but the implementation must now be treated as Stage 1 integration pending verification, not automatically complete.

Do not rebuild the provider architecture. Inspect the current implementation and fix only concrete issues.

### A. Verify every provider against current official documentation

For each enabled provider — OpenRouter, Groq, Mistral, NVIDIA NIM/API, and Google Gemini — verify the actual API base URL, authentication method, request format, response format, current model identifier, current free-tier/credits availability, and current rate limits where documented.

Use the provider's official documentation only for these verification decisions.

The repository must not contain stale, retired, or invented default model IDs. If a configured default model is no longer available, replace it with a currently documented model or require AI_MODEL instead of guessing.

Do not describe a provider as free without qualification. Record whether access is genuinely free-tier, free credits/trial, paid after credits, or unavailable for the intended use.

### B. Test real provider calls

At minimum, successfully test: (1) one OpenAI-compatible provider; (2) one different provider/adapter, preferably Gemini; and (3) mock mode without any provider key.

If real API keys are unavailable to the coding agent, do not fake a successful test. Run all possible static/unit/build checks and clearly report the missing manual test.

### C. Fix invalid-provider behavior

An invalid value such as AI_PROVIDER=does-not-exist must not silently become mock mode.

It should produce a clear configuration error in a safe form and make /api/health report the configuration problem without exposing secrets.

Mock mode should happen only when AI_PROVIDER=mock, or when no provider is configured at all.

### D. Verify provider configuration caching

The configuration resolver memoizes environment-derived configuration. Ensure this does not create confusing behavior during tests or long-lived runtimes. Production may cache immutable environment configuration, but test helpers must be able to reset it. Do not introduce browser-side configuration state.

### E. Verify health and Settings truthfulness

Health/Settings must report the actual active provider/model and whether the required key is present.

They must never claim a provider is live merely because a provider name is configured.

Distinguish safely between mock/unconfigured, configured but key missing, configured with key present, provider request verified successfully, and provider request failed.

Do not expose API keys, authorization headers, upstream response secrets or stack traces.

### F. Provider/model configuration rules

Keep AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_BASE_URL, provider-specific key variables, MODEL_TIMEOUT_MS, MODEL_MAX_TOKENS, and MODEL_TEMPERATURE.

Provider/model switching must remain possible through configuration without application-code changes.

Do not add a giant hard-coded model catalogue.

Use sensible provider defaults only when their current identifiers have been verified. Otherwise require AI_MODEL.

### G. Tests/checks required before declaring Stage 1 complete

Run and report: typecheck; lint; production build; provider routing tests; OpenAI-compatible request construction tests; Gemini/native adapter tests; response parsing tests; missing-key tests; invalid-provider tests; timeout/error handling tests; health secret-leak checks; mock-mode test; and at least two real provider tests when credentials are genuinely available.

Fix failures rather than merely documenting them when the failure is caused by the implementation.

### H. Free-provider claims

The README, Settings and deployment documentation must not make unsupported claims such as free forever, generous free tier without current evidence, fastest, largest free catalog, or recommended based only on old assumptions.

Use factual wording such as free tier currently documented or free credits/trial currently documented, with availability and limits may change.

### I. Stage 1 completion gate

Do NOT move to Stage 2 until the verification/fix pass above is complete.

The final report must explicitly say what was verified; what was changed; which exact model IDs were tested; which tests passed; which real provider calls succeeded; which manual credentials/tests remain; and whether Stage 1 is actually complete.

If any item cannot be completed, leave Stage 1 marked incomplete rather than claiming success.

## 25. After verification — Stage 2 handoff

Only after the Stage 1 completion gate passes, begin Stage 2: Model Control Center.

Stage 2 requirements: server-controlled allowlisted provider/model catalog; active/default model; deliberate selection of one model for a task; deliberate selection of multiple models for a task; optional planner/coder/reviewer/executor roles; no API keys in the browser; no uncontrolled automatic parallel model spending; and task model selections persisted as part of future task configuration.

Do not implement the persistent queue or autonomous execution loop during the Stage 1 verification pass.