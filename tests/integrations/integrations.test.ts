/**
 * Integration catalog + status tests (Stage 2).
 *
 * Covers: catalog built only from the current Vercel Connect catalog,
 * tier-1 enablement, honest connection semantics (never connected without a
 * successful probe), and unavailable states.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const catalog = await import("@/lib/integrations/catalog");
const status = await import("@/lib/integrations/status");

describe("integration catalog", () => {
  it("includes every tier-1 integration from the task", () => {
    const ids = catalog.INTEGRATIONS.filter((i) => i.tier === 1).map((i) => i.id);
    for (const expected of ["github", "vercel", "supabase", "mem0", "firecrawl", "agentmail", "google", "cloudflare", "notion", "slack", "telegram-bot", "zapier"]) {
      assert.ok(ids.includes(expected), `${expected} should be tier 1`);
    }
  });

  it("includes tier-2 integrations", () => {
    const ids = catalog.INTEGRATIONS.filter((i) => i.tier === 2).map((i) => i.id);
    for (const expected of ["shopify", "stripe", "paypal", "linkedin", "x", "reddit", "figma", "sentry", "linear", "jira", "airtable", "n8n", "make", "replicate", "hugging-face", "elevenlabs", "deepgram", "kernel"]) {
      assert.ok(ids.includes(expected), `${expected} should be registered (tier 2)`);
    }
  });

  it("only registers integrations that exist in the live Vercel catalog", () => {
    for (const integration of catalog.INTEGRATIONS) {
      assert.ok(
        catalog.VERCEL_CONNECT_CATALOG.some((c) => c.id === integration.id),
        `${integration.id} is not in the fetched catalog`,
      );
    }
  });

  it("never uses the requested-but-absent connectors", () => {
    const ids = catalog.INTEGRATIONS.map((i) => i.id);
    // These are provided via the single Google connector, not standalone:
    assert.equal(ids.includes("gmail"), false);
    assert.equal(ids.includes("youtube"), false);
    // Zernio is not in the current catalog:
    assert.equal(ids.includes("zernio"), false);
  });

  it("marks tier 1 as enabled by default, tier 2 not", () => {
    for (const integration of catalog.INTEGRATIONS) {
      if (integration.tier === 1) assert.equal(integration.enabledByDefault, true, integration.id);
      else assert.equal(integration.enabledByDefault, false, integration.id);
    }
  });
});

describe("integration status honesty", () => {
  it("reports available (never connected) without a live probe", async () => {
    const statuses = await status.getIntegrationStatuses(false);
    assert.equal(statuses.length, catalog.INTEGRATIONS.length);
    for (const s of statuses) {
      assert.equal(s.connected, false, `${s.id} must not claim connection without a probe`);
      assert.match(s.note, /Vercel dashboard|OIDC|connector/i);
    }
  });

  it("keeps probe-less state at available/enabled for mapped connectors", async () => {
    const github = await status.getIntegrationStatus("github", false);
    assert.ok(github);
    assert.ok(["available", "enabled"].includes(github.state));
  });

  it("reports unverifiable (not connected) when no OIDC environment exists", async () => {
    // This test environment has no VERCEL_OIDC_TOKEN, so probes must not
    // claim success — they must report unverifiable/false honestly.
    const statuses = await status.getIntegrationStatuses(true);
    for (const s of statuses) {
      assert.equal(s.connected, false, `${s.id} must not claim a live connection outside Vercel`);
    }
  });

  it("returns null for unknown integrations", async () => {
    const missing = await status.getIntegrationStatus("definitely-not-real");
    assert.equal(missing, null);
  });
});
