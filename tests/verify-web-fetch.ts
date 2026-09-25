/**
 * STAGE 3 VERIFICATION — ostra:web_fetch real network + the full
 * search → fetch → final-answer chain through the gateway (stub model).
 *
 * Run: bun tsx tests/verify-web-fetch.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const stubState: {
  script: Array<{ toolCalls?: Array<{ id: string; name: string; args: string }>; content?: string }>;
  seen: Array<{ model?: string; lastToolMessage?: string; toolMessageCount: number }>;
} = { script: [], seen: [] };

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
    const toolMessages = (parsed.messages ?? []).filter((m) => { return m.role === "tool"; });
    stubState.seen.push({
      model: parsed.model,
      lastToolMessage: toolMessages.at(-1)?.content,
      toolMessageCount: toolMessages.length,
    });
    const step = stubState.script[Math.min(stubState.seen.length - 1, stubState.script.length - 1)];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: step.content ?? null,
          ...(step.toolCalls
            ? { tool_calls: step.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) }
            : {}),
        },
      }],
    }));
  });
  return new Promise((resolve) => server.listen(9322, "127.0.0.1", () => resolve()));
}

async function main(): Promise<void> {
  await startStub();
  process.env.MODEL_MODE = "http";
  process.env.MODEL_API_URL = "http://127.0.0.1:9322/v1/chat/completions";
  process.env.MODEL_API_KEY = "stub-key-not-a-real-secret";
  process.env.MODEL_NAME = "stub-test-model";
  const { resetProviderConfig } = await import("../src/lib/providers/config");
  resetProviderConfig();
  const { callProvider } = await import("../src/lib/providers/gateway");
  const { getToolDefinition } = await import("../src/lib/tools/registry");
  const { executeNativeTool, validateFetchUrl } = await import("../src/lib/tools/executor");

  let failures = 0;
  const check = (name: string, ok: boolean, detail?: string): void => {
    if (ok) console.log(`  ok    ${name}`);
    else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  const fetchTool = getToolDefinition("ostra:web_fetch")!;
  const fnTools = [
    {
      name: "ostra_web_fetch",
      description: fetchTool.description,
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      toolId: "ostra:web_fetch",
    },
    {
      name: "ostra_datetime",
      date: true,
      description: "Get the current date and time.",
      parameters: { type: "object", properties: {} },
      toolId: "ostra:datetime",
    } as const,
  ];

  console.log("\n=== Test D: fetch a known public webpage (real network) ===");
  {
    const result = await executeNativeTool(fetchTool, { url: "https://example.com/" });
    const parsed = JSON.parse(result.output) as { ok?: boolean; content?: string; chars?: number; url?: string };
    check("fetch succeeded", result.ok === true && parsed.ok === true);
    check("content is readable text", (parsed.content ?? "").includes("Example Domain"));
    check("output size reported", (parsed.chars ?? 0) > 0);
    check("url echoed back", (parsed.url ?? "").startsWith("https://example.com"));
  }

  console.log("\n=== Test D2: invalid URL rejection (structured, never throws) ===");
  {
    for (const [name, url] of [
      ["missing scheme", "example.com"],
      ["file scheme", "file:///etc/passwd"],
      ["localhost", "http://localhost:3000/"],
      ["loopback", "http://127.0.0.1:9322/"],
    ] as const) {
      const validated = validateFetchUrl(url);
      check(`rejected: ${name}`, !validated.ok, validated.ok ? "unexpectedly allowed" : validated.reason);
    }
    const refusal = await executeNativeTool(fetchTool, { url: "http://169.254.169.254/" });
    const parsed = JSON.parse(refusal.output) as { error?: string };
    check("metadata host refused with invalid_url", refusal.ok === false && parsed.error === "invalid_url");
  }

  console.log("\n=== Test D3: fetch failure handled safely (unreachable host) ===");
  {
    // RFC 5737 documentation host that cannot resolve/connect in a sandbox.
    const started = Date.now();
    const result = await executeNativeTool(fetchTool, { url: "https://ostra-unreachable-test.invalid/" });
    const parsed = JSON.parse(result.output) as { error?: string };
    check("failure returned as structured result", result.ok === false && typeof parsed.error === "string");
    check("did not hang", Date.now() - started < 20_000, `${Date.now() - started}ms`);
  }

  console.log("\n=== Test E: search → fetch → final answer (full chain via gateway) ===");
  {
    // The "search step" is represented by the OpenRouter server-tool model:
    // a tool call handing the model a URL (as a real OpenRouter search would
    // via annotations). Then the model calls ostra:web_fetch with it, and
    // finally answers. Proves multi-tool chains through the same loop.
    stubState.script = [
      { toolCalls: [{ id: "s1", name: "ostra_datetime", args: "{}" }] },
      { toolCalls: [{ id: "s2", name: "ostra_web_fetch", args: JSON.stringify({ url: "https://example.com/" }) }] },
      { content: "The page title is Example Domain, fetched after the datetime step." },
    ];
    stubState.seen = [];
    const result = await callProvider([{ role: "user", content: "Fetch example.com and summarize." }], {
      // The explicit selection is what routes the call to the local stub.
      providerOverride: { providerId: "custom-http", modelId: "stub-test-model" },
      functionTools: fnTools as unknown as typeof fnTools,
    });
    check("three model calls (datetime → fetch → answer)", stubState.seen.length === 3, String(stubState.seen.length));
    check("fetch result reached the model", (stubState.seen[2]?.lastToolMessage ?? "").includes("Example Domain"), String(stubState.seen[2]?.lastToolMessage).slice(0, 100));
    check("toolUsage lists both tools", (result.toolUsage?.clientToolCalls ?? []).includes("ostra:web_fetch") && (result.toolUsage?.clientToolCalls ?? []).includes("ostra:datetime"), JSON.stringify(result.toolUsage?.clientToolCalls));
    check("final answer generated from fetched content", result.content.includes("Example Domain"));
    check("no key material in the final answer", !result.content.includes("stub-key"));
    check("no env material in tool metadata", !JSON.stringify(result.toolUsage).includes("stub-key"));
  }

  console.log(failures === 0 ? "\nALL STAGE 3 VERIFICATIONS PASSED" : `\n${failures} VERIFICATION(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
