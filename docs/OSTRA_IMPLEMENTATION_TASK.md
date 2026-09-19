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