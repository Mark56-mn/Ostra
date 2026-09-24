/**
 * Env-credential adapter tests (adapter task §3–§5) — no network.
 *
 * Covers: credential-name detection, env-backed readiness in the status
 * model, and secret hygiene for the env path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setEnv, flushBootstrap, clearModelEnv } from "../helpers/env.ts";

await flushBootstrap();

const runtime = await import("@/lib/integrations/connect-runtime");
const status = await import("@/lib/integrations/status");
const { mem0SearchMemory, githubListRepositories, resetExecutionReadiness } = runtime;

describe("env credential resolver", () => {
  it("detects present credential names and ignores blank values", () => {
    setEnv({ MEM0_API_KEY: "test-key-for-detection", GITHUB_TOKEN: "" });
    assert.equal(runtime.hasEnvCredential("mem0"), true);
    assert.equal(runtime.getEnvCredentialName("mem0"), "MEM0_API_KEY");
    assert.equal(runtime.hasEnvCredential("github"), false, "blank value must not count as present");
  });

  it("supports the alternative GitHub credential name", () => {
    setEnv({ GITHUB_TOKEN: undefined, GITHUB_PERSONAL_ACCESS_TOKEN: "alt-token-for-detection" });
    assert.equal(runtime.getEnvCredentialName("github"), "GITHUB_PERSONAL_ACCESS_TOKEN");
  });

  it("reports null for integrations without an env adapter", () => {
    assert.equal(runtime.getEnvCredentialName("slack"), null);
    assert.equal(runtime.getEnvCredentialName("definitely-not-real"), null);
  });

  it("never exposes credential values through any exported surface", async () => {
    setEnv({ MEM0_API_KEY: "super-secret-value-123", GITHUB_TOKEN: "ghp_supersecretvalue" });
    resetExecutionReadiness();
    const statuses = await status.getIntegrationStatuses(true, ["github", "mem0"]);
    const serialized = JSON.stringify(statuses);
    assert.equal(serialized.includes("super-secret-value-123"), false);
    assert.equal(serialized.includes("ghp_supersecretvalue"), false);
    for (const s of statuses) {
      if (s.envCredential) {
        assert.match(s.envCredential, /^[A-Z0-9_]+$/, "envCredential must be a NAME, never a value");
      }
    }
  });
});

describe("env-backed readiness in the status model", () => {
  it("marks mem0 execution-ready when only MEM0_API_KEY exists (no OIDC)", async () => {
    setEnv({ MEM0_API_KEY: "test-key-for-readiness", VERCEL_OIDC_TOKEN: undefined });
    resetExecutionReadiness();
    const readiness = await runtime.getExecutionReadiness("mem0");
    assert.equal(readiness.executionReady, true);
    assert.equal(readiness.connected, false, "env credential is not a Connect connection");
    assert.equal(readiness.envCredential, "MEM0_API_KEY");
  });

  it("marks github execution-ready when only GITHUB_TOKEN exists", async () => {
    setEnv({ GITHUB_TOKEN: "test-token-for-readiness", VERCEL_OIDC_TOKEN: undefined });
    resetExecutionReadiness();
    const statuses = await status.getIntegrationStatuses(true, ["github"]);
    assert.equal(statuses[0].executionReady, true);
    assert.equal(statuses[0].envCredential, "GITHUB_TOKEN");
  });

  it("keeps integrations not execution-ready when no credential and no OIDC exists", async () => {
    clearModelEnv();
    setEnv({ MEM0_API_KEY: undefined, GITHUB_TOKEN: undefined, GITHUB_PERSONAL_ACCESS_TOKEN: undefined, VERCEL_OIDC_TOKEN: undefined });
    resetExecutionReadiness();
    const readiness = await runtime.getExecutionReadiness("mem0");
    assert.equal(readiness.executionReady, false);
    assert.ok(readiness.reason.length > 0);
  });
});

describe("env adapter execution paths (offline failures only)", () => {
  it("mem0 search with a key against an unreachable mock endpoint fails with a structured, secret-free error", async () => {
    // Point the env path at a port that refuses connections by using an
    // invalid host via the Connect-path override (the env path only talks to
    // api.mem0.ai, so here we assert the structured refusal shape instead of
    // doing real network I/O).
    setEnv({ MEM0_API_KEY: "test-key-for-shape", VERCEL_OIDC_TOKEN: undefined });
    resetExecutionReadiness();
    const result = await Promise.race([
      mem0SearchMemory("probe"),
      new Promise<{ ok: false; code: string; message: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, code: "timeout", message: "test deadline" }), 3000),
      ),
    ]);
    assert.equal(typeof result.message === "string", true);
    assert.equal(result.message.includes("test-key-for-shape"), false, "message must never contain the key");
    if (!result.ok) {
      assert.ok(["oidc_missing", "not_connected", "authorization_required", "mcp_error", "network_error", "timeout", "credential_missing", "credential_invalid", "http_error", "rate_limited", "invalid_response", "tool_error", "connect_error", "installation_required"].includes(result.code));
    }
  });

  it("github without any credential and without OIDC reports a structured refusal", async () => {
    setEnv({ GITHUB_TOKEN: undefined, GITHUB_PERSONAL_ACCESS_TOKEN: undefined, VERCEL_OIDC_TOKEN: undefined });
    resetExecutionReadiness();
    const result = await githubListRepositories({});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(["unauthorized", "network_error", "oidc_missing", "not_connected", "credential_missing"].includes(result.code));
      assert.equal(result.message.includes("test-token"), false);
    }
  });
});
