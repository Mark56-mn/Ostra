# Ostra — Tool & Integration Runtime Adapter Task

## Purpose

Build a reliable, provider-independent runtime tool system for Ostra.

The current Ostra website already:
- runs in production on Vercel;
- can communicate with AI models;
- has a model/control-center UI;
- has an existing tool registry;
- has an existing Vercel Connect (VC) adapter/registry.

The existing Vercel Connect code must remain in the repository, but it is **dormant for this task**. Do not delete it, replace it, or spend the task trying to repair it.

The new system will use **server-side environment variables already available to the Vercel deployment** as the credential source for external integrations.

The goal is to make Ostra capable of calling real external tools through a generic adapter/executor architecture.

---

# 1. Critical model-selection requirement

## REMOVE THE HARD-CODED MODEL DEFAULT

Do NOT depend on:

```env
AI_PROVIDER=...
AI_MODEL=...
```

as the source of the selected provider/model.

The user intentionally removed those variables because they forced Ostra to behave as though OpenRouter/Nemotron was the default.

Do not reintroduce that behavior.

### Required behavior

The user selects:

```
Provider → Model
```

from Ostra's existing model-control UI/runtime state.

That selection must be carried into the chat request and used for that request.

Examples:

```
OpenRouter → selected OpenRouter model
NVIDIA → selected NVIDIA model
Gemini → selected Gemini model
Mistral → selected Mistral model
Groq → selected Groq model
```

Do not automatically choose OpenRouter.

Do not automatically choose Nemotron.

Do not silently fall back to a mock model when no provider/model is selected.

If no valid model has been selected, return a clear server/client state such as:

```
No AI model selected. Choose a provider and model first.
```

The existing mock provider may remain in the codebase for development/testing if needed, but it must not silently become the production fallback.

---

# 2. Keep the old Vercel Connect code

There is already a Vercel Connect adapter/registry in Ostra.

LEAVE IT ALONE.

Do not:
- delete it;
- rewrite it;
- remove its registry entries;
- spend time debugging Vercel Connect;
- make the new architecture depend on it;
- make Vercel Connect the runtime executor.

The existing VC code is dormant compatibility/future infrastructure.

The new ENV-based adapter system must operate independently.

---

# 3. New architecture

Build the following layers:

```
AI MODEL
   ↓
Ostra Tool Registry
   ↓
Tool Executor
   ↓
Integration Adapter
   ↓
Environment Credential Resolver
   ↓
External Service API
   ↓
Normalized Tool Result
   ↓
AI MODEL
```

The AI model must NEVER receive raw environment-variable values.

For example, the model may receive:

```
firecrawl.search(query)
github.list_repositories()
memory.search(query)
```

It must NEVER receive:

```
FIRECRAWL_API_KEY=...
GITHUB_TOKEN=...
MEM0_API_KEY=...
```

---

# 4. Environment credentials

Treat Vercel environment variables as **server-side credentials only**.

The system must:

1. Discover/recognize available environment-variable NAMES without exposing their VALUES.
2. Map known integrations to their required environment variables.
3. Resolve credentials only inside server-side adapters.
4. Never send credentials to the browser.
5. Never put credentials in model prompts.
6. Never put credentials in tool arguments.
7. Never log credential values.
8. Never display credential values in the Control Center.
9. Never expose secret values through /api/* responses.
10. Never prefix private credentials with NEXT_PUBLIC_.

If an environment variable is absent, mark that integration as unavailable rather than crashing the whole application.

---

# 5. Integration Adapter contract

Create a generic adapter interface.

The exact TypeScript names are up to the implementation, but the architecture should provide an equivalent contract to:

```ts
interface IntegrationAdapter {
  id: string;
  name: string;

  getStatus(): Promise<IntegrationStatus>;

  getTools(): ToolDefinition[];

  execute(
    toolName: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult>;
}
```

Each adapter should know:

- integration ID;
- human-readable name;
- required ENV credential names;
- available operations/tools;
- input schemas;
- authentication method;
- API endpoint(s);
- safe output normalization;
- error handling;
- permission requirements.

The adapter owns authentication.

The model does not.

---

# 6. Tool registry

Use the existing Ostra tool registry where possible.

Do not create a second competing tool system.

Extend the current registry so tools can identify their source:

```
native
provider
integration
```

Examples:

```
native.datetime

provider.openrouter.web_search

integration.firecrawl.search
integration.github.list_repositories
integration.mem0.search
```

Every tool should have:

- unique ID;
- name;
- description;
- JSON input schema;
- output/return description;
- source type;
- integration ID when applicable;
- permission level;
- enabled/disabled state;
- model/tool compatibility information;
- whether user confirmation is required.

---

# 7. Tool executor

Create or extend a single central Tool Executor.

Conceptually:

```
executeTool(toolId, arguments, executionContext)
```

It must:

1. Validate the tool ID.
2. Validate arguments against the tool schema.
3. Find the registered tool.
4. Find its adapter if it is an integration tool.
5. Check permissions.
6. Check whether the required credential ENV exists.
7. Execute the adapter.
8. Normalize the response.
9. Return a structured result to the model.
10. Never leak secrets.

A tool failure must become a structured tool error.

Do not turn a failed tool call into a fake successful result.

---

# 8. Model → tool → result → model loop

The selected AI provider/model must be able to participate in the existing tool-call continuation loop.

Required flow:

```
User message
   ↓
Selected provider/model
   ↓
Model requests tool
   ↓
Ostra validates tool call
   ↓
Tool Executor
   ↓
Integration Adapter
   ↓
External API
   ↓
Tool result
   ↓
Selected model receives result
   ↓
Model continues
   ↓
Final response
```

Do not assume that a tool being registered means it works.

A tool is only considered **runtime-ready** after a real end-to-end execution test succeeds.

---

# 9. Dynamic tool availability

Do NOT send every tool to every model on every request.

Build the architecture so Ostra can determine:

- connected/credential available;
- adapter implemented;
- tool registered;
- tool enabled;
- provider/model supports tool calling;
- permission allows execution;
- tool is runtime-tested.

Use a status model similar to:

```
NOT_CONFIGURED
CREDENTIAL_MISSING
ADAPTER_MISSING
REGISTERED
READY
ERROR
DISABLED
```

A useful Control Center status should distinguish:

```
Connected
vs
Implemented
vs
Executable
vs
Tested
```

Do not claim a tool is working merely because an ENV exists.

---

# 10. Integration inventory

Inspect the current production/code configuration and identify environment-variable-backed integrations that are actually present.

Do not invent integrations.

Do not print secret values.

Build a safe inventory based only on variable names and existing configuration.

Known/expected services from the current Ostra setup may include, where the corresponding credentials are actually present:

- Firecrawl
- Browserbase
- Kernel
- GitHub
- Mem0
- Pinecone
- AgentMail
- Shopify
- Inngest
- QStash/Upstash
- Supabase
- MongoDB
- PostgreSQL
- MotherDuck
- Rollbar
- Auth0
- model providers such as OpenRouter, NVIDIA, Gemini, Mistral, and Groq

This list is not permission to assume every service is configured.

Verify each one.

---

# 11. Adapter implementation strategy

Do NOT attempt to implement 20+ integrations blindly in one pass.

Use a fail-forward sequence.

### Phase A — Core framework

Complete first:

1. Model selection without hard-coded provider/model.
2. Environment credential resolver.
3. Integration adapter interface.
4. Tool executor.
5. Registry integration.
6. Runtime status model.
7. Secure diagnostics.
8. Unit tests.

Once Phase A passes, move immediately to Phase B.

### Phase B — First real integration

Implement ONE simple, high-value integration.

Preferred first candidates:

1. Firecrawl
2. GitHub
3. Mem0

Choose the first candidate for which the actual server-side credential and API requirements can be verified from the repository/environment.

Do not spend the entire task fighting one service.

If the first integration is blocked by:
- missing credentials;
- incompatible SDK;
- undocumented/unsupported API;
- authentication failure that cannot be fixed safely;
- provider restrictions;

record the blocker and move to the next candidate.

### Phase C — Additional integrations

After the first adapter proves the architecture, continue through other configured integrations one at a time.

For each integration:

```
ENV detected?
↓
Adapter created?
↓
Tool registered?
↓
Authentication works?
↓
Real API call works?
↓
Result reaches model?
↓
Model continues?
↓
Mark READY
```

If one fails, record the reason and move on.

---

# 12. IMPORTANT: fail-forward rule

The agent MUST NOT get trapped on one integration.

Use this rule:

> Spend a reasonable bounded attempt on the current task. If the blocker is external, credential-related, provider-specific, or requires unavailable information, document it and continue to the next independent task.

Do NOT repeatedly retry the same failing request.

Do NOT rewrite the entire architecture because one integration fails.

Do NOT keep changing working code to force one provider to work.

Do NOT spend the entire execution budget on one API.

Every failed item must produce:

```
Integration:
Status:
Attempted:
Failure:
Likely cause:
What was changed:
What was NOT changed:
Next integration:
```

---

# 13. First real tool: web capability

The first practical goal is to make Ostra capable of performing a real web-search task.

Prefer a real connected web/search integration such as Firecrawl if its credential is available and its API can be safely called.

Do NOT create fake search results.

Do NOT claim browsing capability merely because a button says "Web Search."

Test the complete loop:

User:

```
Search the web for the latest major AI developments and summarize them with sources.
```

Expected:

```
Selected model
  ↓
tool call
  ↓
web/search adapter
  ↓
real external service
  ↓
results
  ↓
model
  ↓
final answer
```

If Firecrawl cannot be made operational within the bounded attempt, move to the next suitable available integration/tool and continue the framework validation.

---

# 14. Model/provider independence

The tool architecture must NOT permanently depend on OpenRouter.

The same Ostra tool system should eventually work with:

- OpenRouter
- NVIDIA
- Gemini
- Mistral
- Groq
- future providers

Provider adapters and integration adapters must remain separate.

For example:

```
OpenRouterAdapter
NvidiaAdapter
GeminiAdapter
MistralAdapter
GroqAdapter
```

are responsible for models.

While:

```
FirecrawlAdapter
GitHubAdapter
Mem0Adapter
```

are responsible for external tools.

Never combine the two abstractions.

---

# 15. Security requirements

Absolutely forbidden:

- exposing ENV values to the client;
- returning ENV values from an API route;
- logging API keys;
- logging authorization headers;
- putting credentials in model prompts;
- putting credentials in tool arguments;
- storing secrets in localStorage;
- creating NEXT_PUBLIC versions of private credentials;
- committing secrets to Git;
- creating a generic arbitrary-URL tool that can use every secret;
- allowing a model to request an arbitrary ENV variable by name;
- allowing a model to execute arbitrary HTTP requests with arbitrary credentials.

The model must only access explicitly registered tools.

---

# 16. Permissions

Preserve the existing Ostra permission architecture.

At minimum distinguish:

```
READ
WRITE
EXECUTE
EXTERNAL_ACTION
FINANCIAL
DESTRUCTIVE
```

For the first implementation, prefer READ-only tools.

Do NOT automatically enable:

- payments;
- financial actions;
- deleting data;
- sending external messages;
- publishing social posts;
- store purchases;
- destructive GitHub operations.

Those can be implemented later with explicit confirmation/permission policies.

---

# 16A. The existing Ostra UI must become truthful and functional

The current website contains pages/sections such as:

- Tools
- Memory
- Settings
- Model/Control Center
- other capability/configuration pages

Some currently display placeholder states such as **"Coming Soon"** even though the underlying integration/runtime work is now being implemented.

Do NOT leave the UI claiming that implemented capabilities are unavailable.

## Required UI behavior

After this task:

1. The **Tools** area must show the tools that Ostra actually has registered and their real runtime status.
2. The **Memory** area must no longer be a fake/placeholder "Coming Soon" experience if Mem0 is successfully configured and implemented.
3. The **Settings** area must expose the real model/provider and integration configuration state that the runtime actually uses.
4. The UI must distinguish:
   - configured;
   - connected/credential detected;
   - adapter implemented;
   - executable;
   - tested/ready;
   - unavailable/error.
5. Never show a tool as available merely because an ENV variable exists.
6. Never show "Coming Soon" for a capability that has actually been implemented and tested.
7. If a capability is not yet implemented, show an honest status such as:
   - Not implemented
   - Credential missing
   - Unavailable
   - Error
   rather than pretending it works.
8. Do not create fake memory entries, fake tool execution, or fake integration status just to make the UI look complete.

## Mem0 is a required target

Mem0 is one of the connected integrations and is specifically intended to become Ostra's persistent memory capability.

If the Mem0 credential is available:

- implement the Mem0 adapter;
- register its real memory tools;
- expose them to compatible models;
- allow the model to save/search/retrieve memory through the tool executor;
- update the Memory page to reflect the actual state;
- prove at least one real memory write and one real memory retrieval if the service/API permits it.

Example intended capability:

```
User:
"Remember that my AI project is called Ostra."

Model:
→ memory.save

Mem0:
→ stores memory

Later:

User:
"What is my AI project called?"

Model:
→ memory.search

Mem0:
→ returns relevant memory

Model:
→ answers "Ostra"
```

Do not hard-code "Ostra" as a fake memory result.

If Mem0 is blocked, follow the fail-forward rule: document the exact blocker and move to the next independent integration. Do not spend the entire execution budget repeatedly trying to fix Mem0.

## AI access to Ostra's own capability pages

The runtime capability registry and the UI/control state must stay synchronized.

The AI/runtime must be able to obtain the same **safe, non-secret capability metadata** that the Settings/Tools/Memory pages display.

For example:

```
Tools:
  Firecrawl Search — READY
  GitHub Read — READY
  Mem0 Search — READY

Memory:
  Mem0 — READY

Settings:
  Selected provider — user selected
  Selected model — user selected
```

Do not expose secrets through this metadata.

The goal is that Ostra does not have one reality in the UI and a different reality in the server runtime.

## AI should be able to inspect Ostra capability state

Where the existing architecture has server-side routes/services for capability metadata, make that metadata available to the runtime/tool layer so the AI can determine what Ostra currently has access to.

The AI must be able to reason from safe metadata such as:

- which tools are enabled;
- which integrations are ready;
- which memory system is active;
- which provider/model is currently selected;
- which capabilities are unavailable.

This does NOT mean giving the AI control of the Settings UI or allowing it to change configuration automatically.

Do not expose secret values.

## Important distinction

"AI can see a capability" and "AI can execute a capability" are different.

A capability is only executable when:

```
registered
+
credential available
+
adapter implemented
+
permission allowed
+
provider/model compatible
+
real execution verified
```

Only then mark it READY.

---


# 17. Do not redesign the website

Do NOT spend this task on:

- visual redesign;
- new landing pages;
- animations;
- branding;
- unrelated UI changes;
- Telegram;
- VPS;
- autonomous long-running workers;
- queues;
- cron;
- background agents;
- full memory architecture;
- social media automation;
- ecommerce automation.

The goal is the runtime model/tool/integration foundation.

Small Control Center status updates are allowed only when required to accurately reflect the new runtime state.

---

# 18. Preserve working functionality

Before changing anything:

- inspect the current provider gateway;
- inspect /api/chat;
- inspect model registry;
- inspect tool registry;
- inspect existing tool-call continuation;
- inspect permissions;
- inspect existing Vercel Connect code;
- inspect current tests.

Do not replace working systems unnecessarily.

Prefer minimal, incremental changes.

---

# 19. Testing requirements

Add automated tests for:

### Model selection

- user-selected provider is honored;
- user-selected model is honored;
- no hard-coded provider is selected;
- no hard-coded model is selected;
- missing selection returns a clear error;
- mock mode is not silently used in production.

### Credential resolver

- detects configured ENV names;
- handles missing credentials;
- never returns credential values to client code;
- never serializes secrets;
- never logs secrets.

### Tool registry

- tool registration;
- schema validation;
- permission validation;
- source/integration mapping;
- unavailable integration handling.

### Tool executor

- successful execution;
- invalid tool;
- invalid arguments;
- missing credential;
- adapter failure;
- timeout;
- structured error;
- successful model continuation.

### Real integration

At least one real integration must be tested end-to-end if credentials are available.

---

# 20. Production verification

After implementation:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Fix failures that are caused by this task.

Then deploy to Vercel.

Verify production behavior.

Do not report success based only on local mocks.

---

# 21. Production acceptance tests

The implementation is considered successful only if these are demonstrably true:

## Test A — model selection

User can select a provider/model without environment-variable defaults.

Changing the selected model changes the model used by chat.

## Test B — no forced default

Removing `AI_PROVIDER` and `AI_MODEL` does NOT force OpenRouter/Nemotron.

The application must not silently choose Nemotron.

## Test C — real tool

At least one environment-backed integration performs a real external operation.

## Test D — model continuation

The tool result returns to the selected model and the model produces a final answer.

## Test E — security

No credential value appears in:

- browser response;
- browser source;
- logs;
- model messages;
- tool arguments;
- Git commits.

## Test F — failure isolation

If Integration A fails, Integration B can still be tested.

The agent must not abandon the entire task because one integration fails.

---

# 22. Required final report

When finished, report:

### Model system
- how provider/model selection now works;
- confirmation that `AI_PROVIDER` and `AI_MODEL` are no longer required as production defaults;
- confirmation that no model is silently selected.

### Integration system
- adapter architecture;
- credential resolver;
- tool executor;
- tool registry integration;
- permission behavior.

### Integration results

For every attempted integration:

```
Integration | ENV detected | Adapter | Authentication | Real call | Model continuation | Status
```

Never include credential values.

### Failures

For every blocked integration:

- exact blocker;
- whether it was skipped;
- next task attempted.

### Engineering
- files changed;
- tests added;
- test results;
- build result;
- deployment result;
- commit SHA.

### Final runtime proof

Show one complete successful execution path:

```
USER REQUEST
→ SELECTED PROVIDER
→ SELECTED MODEL
→ TOOL CALL
→ ADAPTER
→ ENV CREDENTIAL
→ EXTERNAL API
→ TOOL RESULT
→ MODEL CONTINUATION
→ FINAL ANSWER
```

Do not claim an integration is working unless this path was actually demonstrated.

---

# FINAL OPERATING RULE

**Work sequentially, but fail forward.**

Do one task.

Verify it.

If it works, move to the next task.

If it is blocked, document the blocker and move to the next independent task.

Do not run around endlessly fixing one item.

Do not redesign working architecture.

Do not touch the dormant Vercel Connect adapter.

Do not reintroduce hard-coded provider/model defaults.

Do not expose secrets.

The objective is a working, provider-independent Ostra runtime where the user chooses the AI model and Ostra can securely invoke real environment-backed tools through adapters.
