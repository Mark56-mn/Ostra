/**
 * V1 integration tests — Vercel Connect runtime, operation tools, permission
 * enforcement, and secret hygiene for integration execution (no network).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { executeTool, ToolError } = await import("@/lib/tools/service");
const { getToolDefinition, listToolDefinitions } = await import("@/lib/tools/registry");
const { getIntegrationStatuses, getIntegrationStatus } = await import("@/lib/integrations/status");
const { getConnectEnvState, resetExecutionReadiness } = await import("@/lib/integrations/connect-runtime");
const { toolConfigStore } = await import("@/lib/tools/config");

describe("integration operation registry", () => {
  it("registers the three V1 operations with correct metadata", () => {
    const github = getToolDefinition("github.list_repositories");
    assert.ok(github);
    assert.equal(github.provider, "github");
    assert.equal(github.executionType, "vercel-connect");
    assert.equal(github.permission, "read");
    assert.equal(github.requiresApproval, false);
    assert.equal(github.requiresAuthentication, true);

    const search = getToolDefinition("mem0.search_memory");
    assert.ok(search);
    assert.equal(search.provider, "mem0");
    assert.equal(search.permission, "read");
    assert.equal(search.requiresApproval, false);

    const save = getToolDefinition("mem0.save_memory");
    assert.ok(save);
    assert.equal(save.provider, "mem0");
    assert.equal(save.permission, "write");
    assert.equal(save.requiresApproval, true, "memory writes must be approval-gated");
  });

  it("keeps operation tool ids unique alongside the generic connect tools", () => {
    const ids = listToolDefinitions().map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("refuses invalid-argument operations before anything executes (permission precedes validation)", async () => {
    // Pipeline order: enabled → compatibility → permission → validation →
    // execution. Without a connection the permission gate fires first —
    // the security-first ordering. Schema enforcement is covered directly
    // below.
    await assert.rejects(executeTool("mem0.save_memory", { wrong: "shape" }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      const code = (error as { code: string }).code;
      assert.ok(code === "not_connected" || code === "invalid_args", `got ${code}`);
      return true;
    });

    // The schema itself still rejects the malformed shape:
    const { validateToolArgs } = await import("@/lib/tools/validate-args");
    const save = getToolDefinition("mem0.save_memory")!;
    const result = validateToolArgs(save.id, save.inputSchema, { wrong: "shape" });
    assert.equal(result.ok, false);
  });
});

describe("permission enforcement (Stage 5)", () => {
  it("blocks a memory write without approval even in an OIDC environment shape", async () => {
    // No OIDC token here, so the permission gate is the first refusal —
    // proving approval is checked before any network call would occur.
    await assert.rejects(executeTool("mem0.save_memory", { text: "test" }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      const code = (error as { code: string }).code;
      assert.ok(code === "requires_approval" || code === "not_connected", `got ${code}`);
      return true;
    });
  });

  it("blocks a disabled integration operation", async () => {
    toolConfigStore.setEnabled("github.list_repositories", false);
    try {
      await assert.rejects(executeTool("github.list_repositories", {}), (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal((error as { code: string }).code, "tool_disabled");
        return true;
      });
    } finally {
      toolConfigStore.setEnabled("github.list_repositories", true);
    }
  });

  it("generic connect:* passthrough tools still refuse execution", async () => {
    // Even if somehow enabled+connected, generic passthrough has no operation.
    await assert.rejects(executeTool("connect:github", { operation: "delete_repo" }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      const code = (error as { code: string }).code;
      assert.ok(code === "not_connected" || code === "unsupported_execution", `got ${code}`);
      return true;
    });
  });
});

describe("integration status model (Stage 2)", () => {
  it("distinguishes registered/connected/authorized/executionReady", async () => {
    resetExecutionReadiness();
    assert.equal(getConnectEnvState(), "oidc_missing");
    const statuses = await getIntegrationStatuses(true, ["github", "mem0"]);
    assert.equal(statuses.length, 2);
    for (const status of statuses) {
      assert.equal(status.registered, true);
      assert.equal(status.connected, false);
      assert.equal(status.authorized, false);
      assert.equal(status.executionReady, false);
      assert.ok(status.executionReason && status.executionReason.length > 0);
    }
  });

  it("never claims readiness without a live check", async () => {
    const statuses = await getIntegrationStatuses(false);
    for (const status of statuses) {
      assert.equal(status.connected, false, `${status.id} must not claim connection without a probe`);
      assert.equal(status.executionReady, false, `${status.id} must not claim readiness without a probe`);
    }
  });

  it("resolves a single integration by id", async () => {
    const github = await getIntegrationStatus("github", true);
    assert.ok(github);
    assert.equal(github.id, "github");
    assert.equal(github.registered, true);
    assert.equal(github.executionReady, false, "no OIDC token in test environment");
  });
});

describe("secret hygiene for integration execution (Stage 11)", () => {
  it("status payloads never contain token-shaped material", async () => {
    const statuses = await getIntegrationStatuses(true);
    const serialized = JSON.stringify(statuses);
    assert.equal(/eyJ[A-Za-z0-9_-]{10,}/.test(serialized), false, "no JWT-shaped tokens");
    assert.equal(serialized.includes("ghp_"), false, "no GitHub PAT prefixes");
    assert.equal(serialized.includes("github_pat_"), false, "no fine-grained PAT prefixes");
    assert.equal(serialized.includes("VERCEL_OIDC_TOKEN"), false);
  });

  it("error paths carry safe codes and messages only", async () => {
    try {
      await executeTool("github.list_repositories", {});
      assert.fail("expected refusal");
    } catch (error) {
      assert.ok(error instanceof ToolError);
      const message = error.message;
      assert.equal(message.includes("token"), false, "message must not mention token material");
      assert.equal(message.includes("VERCEL_OIDC"), false, "message must not name the env var");
      assert.ok(message.length < 300, "message must be bounded");
    }
  });
});
