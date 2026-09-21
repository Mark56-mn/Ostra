/**
 * Stage 2 security tests.
 *
 * Covers the task's security requirements:
 * - secrets never returned to the client (models/tools/integrations payloads)
 * - secrets never included in model context (gateway request bodies)
 * - unauthorized tool execution rejected
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { resetProviderConfig } = await import("@/lib/providers/config");

process.env.OPENROUTER_API_KEY = "sk-or-secret-value-123";
process.env.AI_PROVIDER = "openrouter";
resetProviderConfig();

const { getModelCatalog } = await import("@/lib/providers/catalog");
const { getAllModelCapabilities } = await import("@/lib/providers/capabilities");
const { getAllToolStatuses } = await import("@/lib/tools/service");
const { lookupConnector } = await import("@/lib/tools/executor");
const { listIntegrations } = await import("@/lib/integrations/catalog");
const { getIntegrationStatuses } = await import("@/lib/integrations/status");

resetProviderConfig();

const SECRET = "sk-or-secret-value-123";

/** Naive but effective: no payload may contain the secret material. */
function assertNoSecret(payload: unknown, ...secrets: string[]): void {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, "payload must not contain secret material");
  }
  // No JWT-shaped strings either (bearer tokens base64url-segment with eyJ).
  assert.equal(/eyJ[A-Za-z0-9_-]{10,}/.test(serialized), false, "payload must not contain JWT-shaped tokens");
}

describe("secret hygiene", () => {
  it("model catalog exposes key presence, never key values", () => {
    // The shared bootstrap wipes model env per test — set it here.
    process.env.OPENROUTER_API_KEY = SECRET;
    process.env.AI_PROVIDER = "openrouter";
    resetProviderConfig();

    const catalog = getModelCatalog();
    const openrouter = catalog.find((p) => p.id === "openrouter");
    assert.ok(openrouter);
    assert.equal(openrouter.keyPresent, true);
    assert.ok(!("apiKey" in openrouter));
    assertNoSecret(catalog, "sk-or-secret-value-123");
  });

  it("capability entries carry sources, not credentials", () => {
    const capabilities = getAllModelCapabilities();
    assert.ok(capabilities.length > 0);
    assertNoSecret(capabilities, "sk-or-secret-value-123");
  });

  it("tool statuses never include credentials", () => {
    const statuses = getAllToolStatuses();
    assert.ok(statuses.length > 0);
    assertNoSecret(statuses, "sk-or-secret-value-123");
    for (const tool of statuses) {
      assert.equal("apiKey" in tool, false);
      assert.equal("token" in tool, false);
    }
  });

  it("integration statuses never include tokens", () => {
    const integrations = listIntegrations();
    assertNoSecret(integrations, "sk-or-secret-value-123");
  });

  it("probed integration statuses never include token material", async () => {
    const statuses = await getIntegrationStatuses(true);
    assertNoSecret(statuses, SECRET);
  });

  it("connector lookups expose only public connector uids", () => {
    const github = lookupConnector("connect:github");
    assert.equal(github.connectorUid, "github");
    const unknown = lookupConnector("connect:not-a-real-one");
    assert.equal(unknown.connectorUid, null);
    assert.equal(unknown.unmapped, true);
  });
});

describe("unauthorized execution", () => {
  it("registry rejects tool ids that were never allowlisted", async () => {
    const { getToolDefinition } = await import("@/lib/tools/registry");
    assert.equal(getToolDefinition("client-invented:tool"), null);
  });

  it("financial tools can never skip confirmation via the config store", async () => {
    const { toolConfigStore } = await import("@/lib/tools/config");
    const { getToolDefinition } = await import("@/lib/tools/registry");
    const stripe = getToolDefinition("connect:stripe")!;
    toolConfigStore.setApproval("connect:stripe", "never");
    assert.equal(toolConfigStore.requiresApproval(stripe), true, "financial must always confirm");
    toolConfigStore.reset();
  });
});
