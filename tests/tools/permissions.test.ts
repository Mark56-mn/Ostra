/**
 * Tool permission-engine tests (Stage 2).
 *
 * Covers the task's examples: read allowed, external_action requires
 * approval, financial/destructive always require explicit confirmation,
 * disabled tools denied, unconnected tools denied, incompatible denied.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flushBootstrap } from "../helpers/env.ts";

await flushBootstrap();

const { evaluateToolPermission, exceedsPermissionCeiling } = await import("@/lib/tools/permissions");
const { getToolDefinition } = await import("@/lib/tools/registry");

describe("tool permissions", () => {
  it("allows READ tools automatically when enabled and compatible", () => {
    const search = getToolDefinition("openrouter:web_search")!;
    const decision = evaluateToolPermission(search, { connected: true, compatible: true });
    assert.equal(decision.allowed, true);
    assert.equal(decision.approvalRequired, false);
  });

  it("allows WRITE tools automatically when enabled (registry default)", () => {
    const supabase = getToolDefinition("connect:supabase")!;
    const decision = evaluateToolPermission(supabase, { connected: true, compatible: true });
    assert.equal(decision.allowed, true);
  });

  it("requires approval for EXTERNAL_ACTION tools", () => {
    const slack = getToolDefinition("connect:slack")!;
    const withoutApproval = evaluateToolPermission(slack, { connected: true, compatible: true });
    assert.equal(withoutApproval.approvalRequired, true);
    assert.equal(withoutApproval.allowed, false);

    const withApproval = evaluateToolPermission(slack, { connected: true, compatible: true, userApproved: true });
    assert.equal(withApproval.allowed, true);
  });

  it("requires approval for FINANCIAL tools even when enabled", () => {
    const stripe = getToolDefinition("connect:stripe")!;
    // Tier-2 tools start disabled; the permission ladder is what matters here.
    const enabledStripe = { ...stripe, enabled: true };
    const decision = evaluateToolPermission(enabledStripe, { connected: true, compatible: true, userApproved: false });
    assert.equal(decision.approvalRequired, true);
    const approved = evaluateToolPermission(enabledStripe, { connected: true, compatible: true, userApproved: true });
    assert.equal(approved.allowed, true);
  });

  it("denies disabled tools outright", () => {
    const shell = getToolDefinition("openrouter:shell")!; // disabled in registry
    const decision = evaluateToolPermission(shell, { connected: true, compatible: true, userApproved: true });
    assert.equal(decision.code, "denied_disabled");
  });

  it("denies unconnected tools that require authentication", () => {
    const github = getToolDefinition("connect:github")!;
    const decision = evaluateToolPermission(github, { connected: false, compatible: true });
    assert.equal(decision.code, "denied_not_connected");
  });

  it("denies incompatible model/tool pairs", () => {
    const search = getToolDefinition("openrouter:web_search")!;
    const decision = evaluateToolPermission(search, { connected: true, compatible: false });
    assert.equal(decision.code, "denied_incompatible");
  });

  it("ranks the permission ladder correctly", () => {
    assert.ok(exceedsPermissionCeiling({ permission: "destructive" } as never, "read"));
    assert.ok(!exceedsPermissionCeiling({ permission: "read" } as never, "destructive"));
  });
});
