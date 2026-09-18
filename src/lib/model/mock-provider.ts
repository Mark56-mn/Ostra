/**
 * Simulated Ostra — the development fallback used when MODEL_MODE=mock.
 *
 * It exists so the whole product (UI, API route, runtime, conversation store)
 * can be built and tested before the experimental model endpoint is online.
 * It never pretends to be a real model: replies state plainly that they are
 * simulated.
 */
import { isAbortError, truncate } from "@/lib/utils";
import type { GenerateOptions, GenerateResult, ModelMessage, ModelProvider } from "./types";

const MOCK_MODEL_ID = "ostra-mock-1";
const BASE_LATENCY_MS = 380;

interface MockIntent {
  id: string;
  match: RegExp;
  reply: string;
}

const MOCK_NOTICE =
  "— Simulated reply from Ostra's built-in mock provider (MODEL_MODE=mock). No model endpoint is linked yet.";

const INTENTS: MockIntent[] = [
  {
    id: "greeting",
    match: /^\s*(?:(?:hi|hey|hello|yo|hiya|good (?:morning|afternoon|evening))(?![a-z])(?:\s+ostra)?|ostra)[\s!.?,]*$/i,
    reply:
      "Hello. I'm Ostra — the communication layer of an agent system that is still being assembled.\n\nRight now I can hold a conversation and I can be swapped onto almost any model endpoint, but I can't act on the world yet. No tools, no long-term memory, no scheduler. You're looking at the first working prototype.",
  },
  {
    id: "identity",
    match: /(who are you|what are you|your name|introduce yourself|about you)/i,
    reply:
      "I'm Ostra.\n\nThe long-term design is one model as the brain, an agent runtime around it, tools it can call, persistent memory and a scheduler that lets it work while nobody is watching. Today only the first two pieces exist: a model adapter and a thin runtime that turns a conversation into a model call.\n\nEverything else on the roadmap is unbuilt, and I'd rather tell you that than imply otherwise.",
  },
  {
    id: "capabilities",
    match: /(what can you do|capabilit|abilities|features|help me|what do you do)/i,
    reply:
      "Wired up in this build:\n• A dark control-center web interface for talking to me\n• POST /api/chat, which routes your message through the agent runtime\n• A pluggable model adapter (mock now, HTTP endpoint next)\n• Conversations stored locally in this browser\n\nNot wired up yet: tools, persistent memory, scheduled or background tasks, browser automation, GitHub/YouTube/social integrations and any form of income automation. Those arrive in later phases — the code is shaped so they slot in rather than replace things.",
  },
  {
    id: "memory",
    match: /(remember|memory|forget|recall|context of our)/i,
    reply:
      "I don't have persistent memory yet.\n\nEach request I receive carries only the recent turns of this conversation, and I store nothing on the server. Your conversations live in this browser's local storage, so they survive a reload but they don't follow you to another device.\n\nPersistent memory is a planned layer: a store the runtime reads before a model call and writes after it. When it lands, it will plug into the same runtime rather than replace the chat.",
  },
  {
    id: "autonomy",
    match: /(autonomous|autonomy|agent|act on|tool|browser|schedul|cron|background|queue|worker)/i,
    reply:
      "I'm not autonomous in this build, and I won't claim to be.\n\nThe intended architecture is: model as brain, agent runtime as the decision layer, tools as actions, memory as knowledge, and a scheduler for unattended work. Version 0 implements the interface to the brain only — no task queue, no tool calls, no background loop, no human-approval flow.\n\nThat ordering is intentional: it's much harder to make an agent trustworthy than to make it talk.",
  },
  {
    id: "status",
    match: /(status|system|are you (online|alive|awake|working)|health|ping|diagnostics?)/i,
    reply:
      "System status: online.\n\n• Web layer: serving this page\n• API: POST /api/chat responding via the agent runtime\n• Model link: mock provider (no external endpoint configured)\n• Memory: none\n• Scheduler: none\n\nCheck /api/health for the machine-readable version of that.",
  },
  {
    id: "thanks",
    match: /(thanks|thank you|nice|good job|great)\b/i,
    reply: "Noted. When the real model link is up, this is where the useful answers start.",
  },
  {
    id: "swap-model",
    match: /(kaggle|endpoint|model_api|provider|vercel|deploy|swap|openai)/i,
    reply:
      "Swapping the model is an environment change, not a code change.\n\nSet MODEL_MODE=http and MODEL_API_URL to any endpoint that accepts a POST with the conversation messages, plus MODEL_API_KEY if it needs auth. The provider parses OpenAI-style replies and plain JSON/text replies, so a Kaggle notebook published behind ngrok, a small FastAPI server on a VPS, or an OpenAI-compatible API all work. Nothing about the interface in front of you has to change.",
  },
];

function pickIntent(message: string): MockIntent | null {
  for (const intent of INTENTS) {
    if (intent.match.test(message)) return intent;
  }
  return null;
}

function lastUserMessage(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.role === "user") return message.content;
  }
  return "";
}

function buildReply(messages: ModelMessage[]): string {
  const userMessage = lastUserMessage(messages).trim();
  const intent = userMessage ? pickIntent(userMessage) : null;
  if (intent) return intent.reply;

  const echo = truncate(userMessage, 140);
  return [
    echo ? `You said: "${echo}".` : "I received an empty message.",
    "I can't reason about that yet — this reply comes from the built-in mock provider, which only pattern-matches a few intents until the model endpoint is connected.",
    "To make me think for real, point MODEL_API_URL at the model server and set MODEL_MODE=http.",
  ].join("\n\n");
}

export class MockModelProvider implements ModelProvider {
  readonly id = "mock";
  readonly model = MOCK_MODEL_ID;

  async generate(messages: ModelMessage[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const startedAt = Date.now();
    const content = `${buildReply(messages)}\n\n${MOCK_NOTICE}`;

    await delay(BASE_LATENCY_MS + Math.min(600, content.length), options.signal);

    return {
      content,
      provider: this.id,
      model: this.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

export { isAbortError };
