/**
 * Tool registry (Stage 2) — the server-controlled allowlist of tools Ostra
 * can offer. Provider-independent: definitions never contain provider logic,
 * only metadata + a pointer to the execution type that the matching adapter
 * handles.
 *
 * OpenRouter server tools: openrouter.ai/docs/guides/features/server-tools
 * (verified 2026-09-21). Vercel Connect tools: vercel.com/connect/browse
 * (live catalog fetched 2026-09-21).
 */
import type { ToolDefinition } from "./types";

/** OpenRouter server tools — executed by OpenRouter inside the model request. */
const OPENROUTER_TOOLS: ToolDefinition[] = [
  {
    id: "openrouter:web_search",
    name: "Web Search",
    provider: "openrouter",
    category: "research",
    description: "Search the web for current information. Executed server-side by OpenRouter during the request.",
    inputSchema: { type: "object", properties: { max_results: { type: "number" } } },
    enabled: true,
    requiresAuthentication: false,
    executionType: "openrouter",
    requiredCapability: "toolCalling",
    riskLevel: "low",
    permission: "read",
    requiresApproval: false,
  },
  {
    id: "openrouter:web_fetch",
    name: "Web Fetch",
    provider: "openrouter",
    category: "research",
    description: "Fetch and extract content from URLs. Executed server-side by OpenRouter during the request.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    enabled: true,
    requiresAuthentication: false,
    executionType: "openrouter",
    requiredCapability: "toolCalling",
    riskLevel: "low",
    permission: "read",
    requiresApproval: false,
  },
  {
    id: "openrouter:datetime",
    name: "Datetime",
    provider: "openrouter",
    category: "utility",
    description: "Get the current date and time. Executed server-side by OpenRouter.",
    inputSchema: { type: "object", properties: {} },
    enabled: true,
    requiresAuthentication: false,
    executionType: "openrouter",
    requiredCapability: "toolCalling",
    riskLevel: "low",
    permission: "read",
    requiresApproval: false,
  },
  {
    id: "openrouter:shell",
    name: "Shell (sandboxed)",
    provider: "openrouter",
    category: "code",
    description: "Run commands in a hosted, sandboxed shell. Executed server-side by OpenRouter.",
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    enabled: false,
    requiresAuthentication: false,
    executionType: "openrouter",
    requiredCapability: "toolCalling",
    riskLevel: "high",
    permission: "execute",
    requiresApproval: true,
  },
  {
    id: "openrouter:image_generation",
    name: "Image Generation",
    provider: "openrouter",
    category: "media",
    description: "Generate images from text prompts. Executed server-side by OpenRouter.",
    inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    enabled: false,
    requiresAuthentication: false,
    executionType: "openrouter",
    requiredCapability: "toolCalling",
    riskLevel: "medium",
    permission: "read",
    requiresApproval: false,
  },
];

const NATIVE_TOOLS: ToolDefinition[] = [
  {
    id: "ostra:datetime",
    name: "Datetime",
    provider: "ostra",
    category: "utility",
    description:
      "Get Ostra's current date and time (UTC and server-local, ISO 8601, epoch, weekday). Use whenever the user asks about the current time or date.",
    inputSchema: { type: "object", properties: {} },
    enabled: true,
    requiresAuthentication: false,
    executionType: "native",
    requiredCapability: "toolCalling",
    riskLevel: "low",
    permission: "read",
    requiresApproval: false,
  },
  {
    id: "ostra:web_fetch",
    name: "Web Fetch",
    provider: "ostra",
    category: "research",
    description:
      "Fetch a public web page by URL and return its readable text. Use for a specific URL the user provides or that a previous step produced. HTTP/HTTPS only.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL of the page to fetch." } },
      required: ["url"],
    },
    enabled: true,
    requiresAuthentication: false,
    executionType: "native",
    requiredCapability: "toolCalling",
    riskLevel: "low",
    permission: "read",
    requiresApproval: false,
  },
  {
    id: "ostra:noop",
    name: "Ostra Noop",
    provider: "ostra",
    category: "utility",
    description:
      "Internal health-check tool: echoes a string back. Proves the permission/compatibility pipeline end-to-end without touching any external service.",
    inputSchema: { type: "object", properties: { echo: { type: "string" } }, required: ["echo"] },
    enabled: true,
    requiresAuthentication: false,
    executionType: "native",
    requiredCapability: undefined,
    riskLevel: "low",
    permission: "read",
    requiresApproval: false,
  },
];

/** Tier-1 integrations, enabled in the registry by default (still gated on connection). */
const TIER_1 = new Set([
  "github",
  "vercel",
  "supabase",
  "mem0",
  "firecrawl",
  "agentmail",
  "google",
  "cloudflare",
  "notion",
  "slack",
  "telegram-bot",
  "zapier",
]);

/**
 * Vercel Connect-backed tools. Registration only — each requires a real
 * connection established in the Vercel dashboard before `available` flips.
 * Connection status is resolved at request time through the Connect adapter.
 */
const VERCEL_CONNECT_TOOLS: ToolDefinition[] = [
  connectTool("github", "GitHub", "developer", "Read repositories, issues, and pull requests.", "read", true),
  connectTool("vercel", "Vercel", "infrastructure", "Deploy agents and apps, manage projects, and more.", "read"),
  connectTool("supabase", "Supabase", "data", "Manage databases, authentication, and storage.", "write"),
  connectTool("cloudflare", "Cloudflare", "infrastructure", "Build applications with compute, storage, and AI.", "read"),
  connectTool("google", "Google", "productivity", "Gmail, Drive, Calendar, Sheets, YouTube, and more via one OAuth connector.", "read"),
  connectTool("notion", "Notion", "knowledge", "Read and write pages in your workspace.", "write"),
  connectTool("slack", "Slack", "communication", "Send messages and alerts to your workspace.", "external_action"),
  connectTool("agentmail", "AgentMail", "communication", "Email inboxes for AI agents.", "external_action"),
  connectTool("mem0", "Mem0", "memory", "Give AI agents persistent memory.", "write"),
  connectTool("firecrawl", "Firecrawl", "research", "Firecrawl web scraping and crawling for LLMs.", "read"),
  connectTool("telegram-bot", "Telegram Bot", "communication", "Send messages via the Telegram Bot API.", "external_action"),
  connectTool("zapier", "Zapier", "automation", "Automate workflows across thousands of apps.", "external_action"),
  // Tier 2 — registered, disabled by default
  connectTool("stripe", "Stripe", "commerce", "Manage payments and financial workflows.", "financial", false, "high"),
  connectTool("paypal", "PayPal", "commerce", "Manage payments, invoices, and subscriptions.", "financial", false, "high"),
  connectTool("shopify", "Shopify", "commerce", "Access products, orders, and store data.", "write", false),
  connectTool("linkedin", "LinkedIn", "social", "LinkedIn profile data and content posting.", "external_action", false),
  connectTool("x", "X", "social", "Read and create posts, manage DMs, and access user data.", "external_action", false),
  connectTool("reddit", "Reddit", "social", "Reddit posts, comments, and subreddits.", "write", false),
  connectTool("figma", "Figma", "developer", "Access design files and comments.", "read", false),
  connectTool("sentry", "Sentry", "developer", "Investigate and debug application errors.", "read", false),
  connectTool("linear", "Linear", "developer", "Create and update issues in your workspace.", "write", false),
  connectTool("jira", "Jira", "developer", "Manage issues and projects in your Jira sites.", "write", false),
  connectTool("airtable", "Airtable", "data", "Organize and automate data across bases, tables, and records.", "write", false),
  connectTool("n8n", "n8n", "automation", "Build and run automated workflows.", "external_action", false),
  connectTool("make", "Make", "automation", "Run scenarios and manage automations.", "external_action", false),
  connectTool("replicate", "Replicate", "ai", "Run and manage models on Replicate.", "write", false),
  connectTool("hugging-face", "Hugging Face", "ai", "Explore models, datasets, and Gradio apps.", "read", false),
  connectTool("elevenlabs", "ElevenLabs", "ai", "ElevenLabs text-to-speech and voice cloning.", "external_action", false),
  connectTool("deepgram", "Deepgram", "ai", "Deepgram speech-to-text and audio intelligence.", "read", false),
  connectTool("kernel", "Kernel", "browser", "Run cloud browsers for AI agents.", "execute", false, "high"),
  connectTool("perplexity", "Perplexity", "research", "Perplexity Sonar search-grounded models.", "read", false),
  connectTool("gitlab", "GitLab", "developer", "GitLab projects, issues, and merge requests.", "write", false),
  connectTool("microsoft-teams", "Microsoft Teams", "communication", "Send messages and alerts to your teams.", "external_action", false),
  connectTool("resend", "Resend", "communication", "Send transactional emails from your apps.", "external_action", false),
  connectTool("sendgrid", "SendGrid", "communication", "Send email with the SendGrid API.", "external_action", false),
  connectTool("mailgun", "Mailgun", "communication", "Send and receive email with Mailgun.", "external_action", false),
  connectTool("neon", "Neon", "data", "Neon Postgres projects and branches.", "write", false),
  connectTool("render", "Render", "infrastructure", "Render services, deploys, and environments.", "execute", false),
  connectTool("railway", "Railway", "infrastructure", "Railway projects, services, and deployments.", "execute", false),
  connectTool("openai", "OpenAI", "ai", "OpenAI models, chat completions, and embeddings.", "read", false),
  connectTool("anthropic", "Anthropic", "ai", "Anthropic Claude models and the Messages API.", "read", false),
  connectTool("google-gemini", "Google Gemini", "ai", "Google Gemini models and generation API.", "read", false),
  connectTool("deepseek", "DeepSeek", "ai", "DeepSeek chat and reasoning models.", "read", false),
  connectTool("cohere", "Cohere", "ai", "Cohere command, embed, and rerank models.", "read", false),
  connectTool("postman", "Postman", "developer", "Give coding agents context about your APIs.", "read", false),
  connectTool("dropbox", "Dropbox", "knowledge", "Dropbox files, folders, and sharing.", "write", false),
  connectTool("box", "Box", "knowledge", "Search, edit, and analyze Box content.", "write", false),
  connectTool("coda", "Coda", "knowledge", "Create, search, and update docs and tables.", "write", false),
  connectTool("readwise", "Readwise", "knowledge", "Search saved highlights and documents.", "read", false),
  connectTool("hubspot", "HubSpot", "business", "HubSpot CRM contacts, companies, deals, and tickets.", "write", false),
  connectTool("salesforce", "Salesforce", "business", "Access leads, contacts, and CRM data.", "write", false),
  connectTool("attio", "Attio", "business", "Work with CRM records and relationships.", "write", false),
  connectTool("intercom", "Intercom", "business", "Intercom conversations, contacts, and articles.", "write", false),
  connectTool("asana", "Asana", "productivity", "Coordinate tasks, projects, and goals.", "write", false),
  connectTool("clickup", "ClickUp", "productivity", "ClickUp tasks, lists, and workspaces.", "write", false),
  connectTool("monday.com", "monday.com", "productivity", "monday.com boards, items, and workspaces.", "write", false),
  connectTool("todoist", "Todoist", "productivity", "Create, complete, and organize tasks.", "write", false),
  connectTool("zoom", "Zoom", "communication", "Zoom meetings, webinars, and recordings.", "write", false),
];

function connectTool(
  id: string,
  name: string,
  category: string,
  description: string,
  permission: ToolDefinition["permission"],
  enabled = TIER_1.has(id),
  riskLevel: ToolDefinition["riskLevel"] = permission === "financial" || permission === "destructive" ? "high" : "medium",
): ToolDefinition {
  const externalAction = permission === "external_action" || permission === "financial" || permission === "destructive";
  return {
    id: `connect:${id}`,
    name,
    provider: "vercel-connect",
    category,
    description,
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", description: `Connector operation for ${name}` },
        params: { type: "object", description: "Operation arguments" },
      },
      required: ["operation"],
    },
    enabled,
    requiresAuthentication: true,
    executionType: "vercel-connect",
    riskLevel,
    permission,
    requiresApproval: externalAction,
  };
}

export const TOOL_REGISTRY: readonly ToolDefinition[] = [...OPENROUTER_TOOLS, ...NATIVE_TOOLS, ...VERCEL_CONNECT_TOOLS];

export function getToolDefinition(toolId: string): ToolDefinition | null {
  return TOOL_REGISTRY.find((t) => t.id === toolId) ?? null;
}

export function listToolDefinitions(): ToolDefinition[] {
  return [...TOOL_REGISTRY];
}

export function isToolAllowed(toolId: string): boolean {
  return TOOL_REGISTRY.some((t) => t.id === toolId);
}

export function getToolsByCategory(): Record<string, ToolDefinition[]> {
  const byCategory: Record<string, ToolDefinition[]> = {};
  for (const tool of TOOL_REGISTRY) {
    (byCategory[tool.category] ??= []).push(tool);
  }
  return byCategory;
}
