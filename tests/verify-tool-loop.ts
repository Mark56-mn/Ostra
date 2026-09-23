/**
 * STAGE 1 VERIFICATION — the real tool loop against a local stub "model".
 *
 * Proves end-to-end (no real credentials needed, no faked results):
 *   A. normal chat works
 *   B. model selection is honored (exact model in the upstream request)
 *   C. the model's tool call → Ostra executes the REAL datetime tool →
 *      tool result → model receives it → final answer
 *   D. multiple tool iterations are allowed
 *   E. unknown tool / malformed arguments are handled safely
 *   F. the iteration limit stops the loop with a controlled, honest fallback
 *
 * Run: bun tsx tests/verify-tool-loop.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = 9321;

// ---------------------------------------------------------------------------
// Stub "model server" — speaks OpenAI chat-completions and drives the loop.
// ---------------------------------------------------------------------------

interface StubState {
  /** Scripted responses, one per /chat/completions call. */
  script: Array<{ toolCalls?: Array<{ id: string; name: string; args: string }>; content?: string }>;
  seen: Array<{ model?: string; lastToolMessage?: string; toolMessageCount: number }>;
}

const stubState: StubState = { script: [], seen: [] };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function startStub(): Promise<void> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    const parsed = JSON.parse(body) as {
      model?: string;
      messages?: Array<{ role: string; content?: string }>;
    };
    const toolMessages = (parsed.messages ?? []).filter((m) => m.role === "tool");
    stubState.seen.push({
      model: parsed.model,
      lastToolMessage: toolMessages.at(-1)?.content,
      toolMessageCount: toolMessages.length,
    });

    const step = stubState.script[Math.min(stubState.seen.length - 1, stubState.script.length - 1)];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: step.content ?? null,
              ...(step.toolCalls
                ? {
                    tool_calls: step.toolCalls.map((c) => ({
                      id: c.id,
                      type: "function",
                      function: { name: c.name, arguments: c.args },
                    })),
                  }
                : {}),
            },
          },
        ],
      }),
    );
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve()));
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await startStub();

  // Legacy custom-provider path: MODEL_MODE=http + MODEL_API_URL is the
  // documented v0.1 mechanism for pointing Ostra at any OpenAI-compatible
  // endpoint — here, the local stub.
  process.env.MODEL_MODE = "http";
  process.env.MODEL_API_URL = "http://127.0.0.1:9321/v1/chat/completions";
  process.env.MODEL_API_KEY = "stub-key-not-a-real-secret";
  process.env.MODEL_NAME = "stub-test-model";

  const { resetProviderConfig } = await import("../src/lib/providers/config");
  resetProviderConfig();
  const { callProvider } = await import("../src/lib/providers/gateway");
  const { getToolDefinition } = await import("../src/lib/tools/registry");

  let failures = 0;
  function check(name: string, condition: boolean, detail?: string): void {
    if (condition) {
      console.log(`  ok    ${name}`);
    } else {
      failures++;
      console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  const datetimeTool = getToolDefinition("ostra:datetime")!;
  const fnTools = [
    {
      name: "ostra_datetime",
      description: datetimeTool.description,
      parameters: { type: "object", properties: {} },
      toolId: "ostra:datetime",
    },
  ];

  console.log("\n=== Test A: normal chat works (no tools) ===");
  resetProviderConfig();
  {
    stubState.script = [{ content: "Plain answer without tools." }];
    stubState.seen = [];
    const result = await callProvider([{ role: "user", content: "Hi" }]);
    check("final content returned", result.content === "Plain answer without tools.");
    check("no toolUsage on plain chat", result.toolUsage === undefined);
    check("no secrets in content", !result.content.includes("stub-key"));
  }

  console.log("\n=== Test B: model selection → exact model reaches the provider ===");
  {
    stubState.script = [{ content: "Selected." }];
    stubState.seen = [];
    // A per-request override wins over the env default: point the override at
    // the stub provider id by temporarily registering the stub as OpenRouter
    // is not possible — instead verify the override path via AI_BASE_URL.
    const previous = { ...process.env } as Record<string, string | undefined>;
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "stub-override-key";
    process.env.AI_BASE_URL = "http://127.0.0.1:9321/v1";
    resetProviderConfig();
    try {
      const result = await callProvider([{ role: "user", content: "Hi" }], {
        providerOverride: { providerId: "openrouter", modelId: "test/exact-model" },
      });
      check("upstream request carried the selected model", stubState.seen[0]?.model === "test/exact-model", JSON.stringify(stubState.seen[0]?.model));
      check("result reports the selected model", result.model === "test/exact-model");
    } catch (error) {
      check("override request succeeded", false, error instanceof Error ? error.message : String(error));
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key];
      }
      Object.assign(process.env, previous);
      resetProviderConfig();
      // Restore the legacy custom provider for the remaining tests.
      process.env.MODEL_MODE = "http";
      process.env.MODEL_API_URL = "http://127.0.0.1:9321/v1/chat/completions";
      process.env.MODEL_API_KEY = "stub-key-not-a-real-secret";
      process.env.MODEL_NAME = "stub-test-model";
    }
  }

  console.log("\n=== Test C: datetime tool loop (call → execute → result → answer) ===");
  {
    stubState.script = [
      { toolCalls: [{ id: "call_dt", name: "ostra_datetime", args: "{}" }] },
      { content: "The current time is in the tool result." },
    ];
    stubState.seen = [];
    const result = await callProvider([{ role: "user", content: "What time is it?" }], {
      functionTools: fnTools,
    });
    check("loop made 2 model calls", stubState.seen.length === 2, String(stubState.seen.length));
    check("tool result reached the model", (stubState.seen[1]?.lastToolMessage ?? "").includes("iso_utc"), String(stubState.seen[1]?.lastToolMessage).slice(0, 80));
    check("tool result is REAL datetime JSON (epoch + weekday)", (stubState.seen[1]?.lastToolMessage ?? "").includes("epoch_ms") && (stubState.seen[1]?.lastToolMessage ?? "").includes("weekday_utc"));
    check("final answer returned", result.content.includes("current time"));
    check("toolUsage records the executed tool", result.toolUsage?.clientToolCalls.includes("ostra:datetime") === true, JSON.stringify(result.toolUsage));
    check("no secrets in tool metadata", !JSON.stringify(result.toolUsage).includes("stub-key"));
  }

  console.log("\n=== Test D: multiple tool iterations ===");
  {
    stubState.script = [
      { toolCalls: [{ id: "c1", name: "ostra_datetime", args: "{}" }] },
      { toolCalls: [{ id: "c2", name: "ostra_datetime", args: "{}" }] },
      { content: "Done after two tool rounds." },
    ];
    stubState.seen = [];
    const result = await callProvider([{ role: "user", content: "time twice" }], {
      functionTools: fnTools,
    });
    check("3 model calls for 2 tool hops", stubState.seen.length === 3, String(stubState.seen.length));
    check("both results delivered", stubState.seen[2]?.toolMessageCount === 2, String(stubState.seen[2]?.toolMessageCount));
    check("final answer after iterations", result.content.includes("Done after two"));
  }

  console.log("\n=== Test E: unknown tool + malformed arguments are safe ===");
  {
    stubState.script = [
      {
        toolCalls: [
          { id: "c_u", name: "not_a_real_tool", args: "{}" },
          { id: "c_m", name: "ostra_datetime", args: "{bad json" },
        ],
      },
      { content: "I handled the failures gracefully." },
    ];
    stubState.seen = [];
    const result = await callProvider([{ role: "user", content: "weird tools" }], {
      functionTools: fnTools,
    });
    check("request did not crash", result.content.includes("gracefully"));
    check("loop continued after malformed calls", stubState.seen.length === 2, String(stubState.seen.length));
  }

  console.log("\n=== Test F: iteration limit stops the loop honestly ===");
  {
    // Scripted to always demand tools; the loop must stop at its hop budget.
    stubState.script = Array.from({ length: 12 }, (_, i) => ({
      toolCalls: [{ id: `c${i}`, name: "ostra_datetime", args: "{}" }],
    }));
    stubState.seen = [];
    const started = Date.now();
    const result = await callProvider([{ role: "user", content: "loop forever" }], {
      functionTools: fnTools,
      maxToolCalls: 2,
    });
    const elapsed = Date.now() - started;
    check("loop terminated (bounded calls)", stubState.seen.length <= 4, String(stubState.seen.length));
    check("returned an honest budget note", result.content.includes("tool-call budget"), result.content.slice(0, 80));
    check("no fabricated final answer", !result.content.includes("All done"));
    check("terminated quickly (no hang)", elapsed < 10_000, `${elapsed}ms`);
    check("no secrets in the budget note", !result.content.includes("stub-key"));
  }

  console.log(failures === 0 ? "\nALL STAGE 1 VERIFICATIONS PASSED" : `\n${failures} VERIFICATION(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
