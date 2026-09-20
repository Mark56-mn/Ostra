/**
 * Health endpoint security + truthfulness tests.
 *
 * /api/health is publicly reachable: it must never leak API keys, and it
 * must never claim a provider is live merely because a name is configured.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setEnv } from "../helpers/env.ts";

describe("health payload security", async () => {
  const { buildHealthPayload } = await import("@/lib/system/health");
  const { resetProviderConfig } = await import("@/lib/providers/config");

  function healthWithEnv(patch: Record<string, string | undefined>) {
    setEnv(patch);
    resetProviderConfig();
    return buildHealthPayload(new Date("2026-01-01T00:00:00Z"));
  }

  it("never includes any key value in the payload", () => {
    const payload = healthWithEnv({
      AI_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-super-secret-value-123",
    });
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("sk-or-super-secret-value-123"), false);
    assert.equal(serialized.includes("secret-value"), false);
    // Presence flag is fine:
    assert.equal(payload.keyPresent, true);
    assert.equal(payload.status, "ok");
  });

  it("serializes with no secret-bearing field names at all", () => {
    const payload = healthWithEnv({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-secret",
      MISTRAL_API_KEY: "mistral-secret",
    });
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("AIza-secret"), false);
    assert.equal(serialized.includes("mistral-secret"), false);

    // No property may be named like a credential carrier. (Values such as
    // keyEnvVar="GEMINI_API_KEY" are fine — they are variable names, not keys.)
    const forbidden = new Set(["apikey", "api_key", "authorization", "bearer", "secret", "token"]);
    const keys: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key.toLowerCase());
          collect(inner);
        }
      }
    };
    collect(payload);
    for (const key of keys) {
      assert.equal(forbidden.has(key), false, `forbidden field name in health payload: ${key}`);
    }
  });

  it("reports degraded — not ok — when the provider key is missing", () => {
    const payload = healthWithEnv({ AI_PROVIDER: "nvidia" });
    assert.equal(payload.mode, "provider");
    assert.equal(payload.keyPresent, false);
    assert.equal(payload.status, "degraded");
    assert.equal(payload.endpointConfigured, false);
  });

  it("reports error state for an invalid provider with the reason", () => {
    const payload = healthWithEnv({ AI_PROVIDER: "does-not-exist" });
    assert.equal(payload.status, "error");
    assert.match(payload.configError ?? "", /Invalid AI_PROVIDER/);
  });

  it("lists per-provider key presence without values", () => {
    const payload = healthWithEnv({
      AI_PROVIDER: "groq",
      GROQ_API_KEY: "gsk-secret",
      GEMINI_API_KEY: "also-secret",
    });
    const groq = payload.providers.find((p) => p.id === "groq");
    const gemini = payload.providers.find((p) => p.id === "gemini");
    const openrouter = payload.providers.find((p) => p.id === "openrouter");
    assert.equal(groq?.keyPresent, true);
    assert.equal(groq?.active, true);
    assert.equal(gemini?.keyPresent, true);
    assert.equal(gemini?.active, false);
    assert.equal(openrouter?.keyPresent, false);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("gsk-secret"), false);
    assert.equal(serialized.includes("also-secret"), false);
  });

  it("exposes only documented public fields", () => {
    const payload = healthWithEnv({});
    const allowed = new Set([
      "status",
      "system",
      "version",
      "mode",
      "provider",
      "model",
      "endpointConfigured",
      "keyPresent",
      "adapter",
      "configError",
      "run",
      "providers",
      "timestamp",
    ]);
    for (const key of Object.keys(payload)) {
      assert.ok(allowed.has(key), `unexpected health field: ${key}`);
    }
    assert.equal(payload.system, "ostra");
  });
});
