/**
 * Vercel Connect integration catalog (Stage 2).
 *
 * Source of truth: https://vercel.com/connect/browse — fetched live on
 * 2026-09-21. The list below mirrors the current catalog; when Vercel adds
 * connectors, add an entry here (and optionally a connect:* tool in the tool
 * registry) — no agent-runtime changes required.
 *
 * IMPORTANT: an entry in this catalog means the connector *exists in Vercel*,
 * NOT that Ostra is connected to it. Connection status is only ever `true`
 * after a live scoped-token probe succeeds (see ./status.ts).
 */

export type IntegrationAuthType = "oauth" | "mcp" | "api-key" | "managed";

export interface VercelConnectorCatalogEntry {
  id: string;
  name: string;
  description: string;
  authTypes: IntegrationAuthType[];
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  provider: "vercel-connect";
  /** Ostra tool id when one is registered (`connect:<id>`), else null. */
  toolId: string | null;
  /** Connector uid to use with @vercel/connect, when mapped. */
  connectorUid: string | null;
  category: string;
  description: string;
  capabilities: string[];
  /** Whether Ostra has deliberately enabled this integration in the registry. */
  enabledByDefault: boolean;
  tier: 1 | 2;
}

export type IntegrationConnectionState = "available" | "connected" | "enabled" | "authorized" | "unavailable";

export interface IntegrationStatus {
  id: string;
  provider: "vercel-connect";
  connected: boolean;
  enabled: boolean;
  capabilities: string[];
  /** Detailed state for UI rendering. */
  state: IntegrationConnectionState;
  /** Why the state is what it is — secret-free. */
  note: string;
}

/** Live Vercel Connect catalog (2026-09-21). */
export const VERCEL_CONNECT_CATALOG: VercelConnectorCatalogEntry[] = [
  { id: "github", name: "GitHub", description: "Access repositories, issues, and pull requests.", authTypes: ["managed"] },
  { id: "linear", name: "Linear", description: "Create and update issues in your workspace.", authTypes: ["managed"] },
  { id: "microsoft", name: "Microsoft", description: "Access Microsoft 365 data through Microsoft Graph.", authTypes: ["managed"] },
  { id: "microsoft-teams", name: "Microsoft Teams", description: "Send messages and alerts to your teams.", authTypes: ["managed"] },
  { id: "salesforce", name: "Salesforce", description: "Access leads, contacts, and CRM data.", authTypes: ["managed"] },
  { id: "slack", name: "Slack", description: "Send messages and alerts to your workspace.", authTypes: ["managed"] },
  { id: "snowflake", name: "Snowflake", description: "Query your data warehouse.", authTypes: ["managed"] },
  { id: "vercel", name: "Vercel", description: "Deploy agents and apps, manage projects, and more.", authTypes: ["oauth", "mcp", "api-key"] },
  { id: "adobe", name: "Adobe", description: "Create and edit designs with Adobe Express.", authTypes: ["mcp"] },
  { id: "agentmail", name: "AgentMail", description: "Email inboxes for AI agents", authTypes: ["mcp", "api-key"] },
  { id: "airtable", name: "Airtable", description: "Organize and automate data across bases, tables, and records.", authTypes: ["mcp"] },
  { id: "anthropic", name: "Anthropic", description: "Anthropic Claude models and the Messages API", authTypes: ["api-key"] },
  { id: "asana", name: "Asana", description: "Coordinate tasks, projects, and goals.", authTypes: ["mcp"] },
  { id: "attio", name: "Attio", description: "Work with CRM records and relationships.", authTypes: ["mcp"] },
  { id: "box", name: "Box", description: "Search, edit, and analyze Box content.", authTypes: ["mcp"] },
  { id: "clickup", name: "ClickUp", description: "ClickUp tasks, lists, and workspaces", authTypes: ["oauth", "api-key"] },
  { id: "cloudflare", name: "Cloudflare", description: "Build applications with compute, storage, and AI.", authTypes: ["mcp"] },
  { id: "coda", name: "Coda", description: "Create, search, and update docs and tables.", authTypes: ["mcp"] },
  { id: "cohere", name: "Cohere", description: "Cohere command, embed, and rerank models", authTypes: ["api-key"] },
  { id: "deepgram", name: "Deepgram", description: "Deepgram speech-to-text and audio intelligence", authTypes: ["api-key"] },
  { id: "deepseek", name: "DeepSeek", description: "DeepSeek chat and reasoning models", authTypes: ["api-key"] },
  { id: "dropbox", name: "Dropbox", description: "Dropbox files, folders, and sharing", authTypes: ["oauth"] },
  { id: "elevenlabs", name: "ElevenLabs", description: "ElevenLabs text-to-speech and voice cloning", authTypes: ["api-key"] },
  { id: "figma", name: "Figma", description: "Access design files and comments.", authTypes: ["oauth"] },
  { id: "firecrawl", name: "Firecrawl", description: "Firecrawl web scraping and crawling for LLMs", authTypes: ["api-key"] },
  { id: "gitlab", name: "GitLab", description: "GitLab projects, issues, and merge requests", authTypes: ["oauth", "api-key"] },
  { id: "google", name: "Google", description: "Google APIs — Gmail, Drive, Calendar, Sheets, YouTube, and more", authTypes: ["oauth"] },
  { id: "google-gemini", name: "Google Gemini", description: "Google Gemini models and generation API", authTypes: ["api-key"] },
  { id: "hugging-face", name: "Hugging Face", description: "Explore models, datasets, and Gradio apps.", authTypes: ["mcp"] },
  { id: "hubspot", name: "HubSpot", description: "HubSpot CRM contacts, companies, deals, and tickets", authTypes: ["oauth"] },
  { id: "intercom", name: "Intercom", description: "Intercom conversations, contacts, and articles", authTypes: ["oauth"] },
  { id: "jira", name: "Jira", description: "Manage issues and projects in your Jira sites.", authTypes: ["oauth", "mcp"] },
  { id: "kernel", name: "Kernel", description: "Run cloud browsers for AI agents.", authTypes: ["mcp", "api-key"] },
  { id: "linkedin", name: "LinkedIn", description: "LinkedIn profile data and content posting", authTypes: ["oauth"] },
  { id: "mailgun", name: "Mailgun", description: "Send and receive email with Mailgun", authTypes: ["api-key"] },
  { id: "make", name: "Make", description: "Run scenarios and manage automations.", authTypes: ["mcp"] },
  { id: "mem0", name: "Mem0", description: "Give AI agents persistent memory.", authTypes: ["mcp"] },
  { id: "monday.com", name: "monday.com", description: "monday.com boards, items, and workspaces", authTypes: ["oauth", "api-key"] },
  { id: "n8n", name: "n8n", description: "Build and run automated workflows.", authTypes: ["api-key"] },
  { id: "neon", name: "Neon", description: "Neon Postgres projects and branches", authTypes: ["api-key"] },
  { id: "notion", name: "Notion", description: "Read and write pages in your workspace.", authTypes: ["oauth", "mcp", "api-key"] },
  { id: "openai", name: "OpenAI", description: "OpenAI models, chat completions, and embeddings", authTypes: ["api-key"] },
  { id: "openrouter", name: "OpenRouter", description: "Route requests across models with OpenRouter", authTypes: ["api-key"] },
  { id: "paypal", name: "PayPal", description: "Manage payments, invoices, and subscriptions.", authTypes: ["mcp"] },
  { id: "perplexity", name: "Perplexity", description: "Perplexity Sonar search-grounded models", authTypes: ["api-key"] },
  { id: "postman", name: "Postman", description: "Give coding agents context about your APIs.", authTypes: ["mcp"] },
  { id: "railway", name: "Railway", description: "Railway projects, services, and deployments", authTypes: ["api-key"] },
  { id: "razorpay", name: "Razorpay", description: "Manage payments, settlements, and account data.", authTypes: ["mcp"] },
  { id: "readwise", name: "Readwise", description: "Search saved highlights and documents.", authTypes: ["mcp"] },
  { id: "reddit", name: "Reddit", description: "Reddit posts, comments, and subreddits", authTypes: ["oauth"] },
  { id: "render", name: "Render", description: "Render services, deploys, and environments", authTypes: ["api-key"] },
  { id: "replicate", name: "Replicate", description: "Run and manage models on Replicate", authTypes: ["api-key"] },
  { id: "resend", name: "Resend", description: "Send transactional emails from your apps.", authTypes: ["oauth", "mcp", "api-key"] },
  { id: "sendgrid", name: "SendGrid", description: "Send email with the SendGrid API", authTypes: ["api-key"] },
  { id: "sentry", name: "Sentry", description: "Investigate and debug application errors.", authTypes: ["mcp"] },
  { id: "shopify", name: "Shopify", description: "Access products, orders, and store data.", authTypes: ["oauth"] },
  { id: "stripe", name: "Stripe", description: "Manage payments and financial workflows.", authTypes: ["mcp"] },
  { id: "supabase", name: "Supabase", description: "Manage databases, authentication, and storage.", authTypes: ["mcp"] },
  { id: "telegram-bot", name: "Telegram Bot", description: "Send messages via the Telegram Bot API", authTypes: ["api-key"] },
  { id: "todoist", name: "Todoist", description: "Create, complete, and organize tasks.", authTypes: ["mcp"] },
  { id: "x", name: "X", description: "Read and create posts, manage DMs, and access user data.", authTypes: ["oauth"] },
  { id: "zapier", name: "Zapier", description: "Automate workflows across thousands of apps.", authTypes: ["mcp"] },
  { id: "zoom", name: "Zoom", description: "Zoom meetings, webinars, and recordings", authTypes: ["oauth"] },
];

const CATALOG_INDEX = new Map(VERCEL_CONNECT_CATALOG.map((c) => [c.id, c]));

/** Integrations Ostra registers, split into the task's priority tiers. */
const TIER_1_IDS = [
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
] as const;

const TIER_2_IDS = [
  "shopify",
  "stripe",
  "paypal",
  "razorpay",
  "linkedin",
  "x",
  "reddit",
  "figma",
  "sentry",
  "linear",
  "jira",
  "airtable",
  "n8n",
  "make",
  "replicate",
  "hugging-face",
  "elevenlabs",
  "deepgram",
  "kernel",
  "perplexity",
  "gitlab",
  "microsoft-teams",
  "resend",
  "sendgrid",
  "mailgun",
  "neon",
  "render",
  "railway",
  "openai",
  "anthropic",
  "google-gemini",
  "deepseek",
  "cohere",
  "postman",
  "dropbox",
  "box",
  "coda",
  "readwise",
  "hubspot",
  "salesforce",
  "attio",
  "intercom",
  "asana",
  "clickup",
  "monday.com",
  "todoist",
  "zoom",
] as const;

function capabilitiesFor(catalogEntry: VercelConnectorCatalogEntry): string[] {
  // Derived from the connector's official description, kept conservative:
  // read-ish introspection is safe to assume for catalogs; consequential
  // capabilities are only listed where the description states them.
  const description = catalogEntry.description.toLowerCase();
  const caps: string[] = [];
  if (description.includes("issue")) caps.push("issues");
  if (description.includes("pull request")) caps.push("pull_requests");
  if (description.includes("repositor")) caps.push("repositories");
  if (description.includes("message")) caps.push("messaging");
  if (description.includes("email") || description.includes("mail")) caps.push("email");
  if (description.includes("deploy")) caps.push("deployments");
  if (description.includes("payment") || description.includes("financial")) caps.push("payments");
  if (description.includes("database") || description.includes("data warehouse") || description.includes("postgres")) caps.push("database");
  if (description.includes("memory")) caps.push("memory");
  if (description.includes("search") || description.includes("web scraping") || description.includes("crawling")) caps.push("web_research");
  if (description.includes("pages")) caps.push("pages");
  if (description.includes("models") || description.includes("model")) caps.push("ai_models");
  if (description.includes("speech")) caps.push("speech");
  if (description.includes("browser")) caps.push("browser_automation");
  if (description.includes("crm") || description.includes("leads") || description.includes("contacts")) caps.push("crm");
  if (description.includes("tasks") || description.includes("task")) caps.push("task_management");
  if (description.includes("files") || description.includes("content")) caps.push("files");
  if (description.includes("workflows") || description.includes("automations") || description.includes("automate")) caps.push("automation");
  return caps.length > 0 ? caps : ["connector_actions"];
}

function buildIntegration(id: string, tier: 1 | 2): IntegrationDefinition | null {
  const entry = CATALOG_INDEX.get(id);
  if (!entry) return null; // Honest: skip anything not in the live catalog.
  return {
    id: entry.id,
    name: entry.name,
    provider: "vercel-connect",
    toolId: `connect:${entry.id}`,
    connectorUid: entry.id,
    category: entry.authTypes.includes("mcp") ? "mcp-connector" : entry.authTypes[0],
    description: entry.description,
    capabilities: capabilitiesFor(entry),
    enabledByDefault: tier === 1,
    tier,
  };
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  ...(TIER_1_IDS.map((id) => buildIntegration(id, 1)).filter((i): i is IntegrationDefinition => i !== null)),
  ...(TIER_2_IDS.map((id) => buildIntegration(id, 2)).filter((i): i is IntegrationDefinition => i !== null)),
];

/**
 * Requested capabilities that do NOT map to a standalone connector in the
 * live catalog today — recorded so the UI/report never implies they exist:
 * - Gmail, Google Drive, Google Sheets, YouTube: provided through the single
 *   "Google" connector (oauth), not separate connectors.
 * - "Zernio" and a standalone "Kernel"-style browser connector beyond
 *   Kernel itself: not listed in the catalog as of 2026-09-21.
 */
export const MISSING_FROM_CATALOG: string[] = [
  "gmail (via Google connector, not standalone)",
  "google-drive (via Google connector, not standalone)",
  "google-sheets (via Google connector, not standalone)",
  "youtube (via Google connector, not standalone)",
  "zernio (not in the current Vercel Connect catalog)",
];

export function getIntegration(id: string): IntegrationDefinition | null {
  return INTEGRATIONS.find((i) => i.id === id) ?? null;
}

export function listIntegrations(): IntegrationDefinition[] {
  return [...INTEGRATIONS];
}

export function isCatalogConnector(connectorUid: string): boolean {
  return CATALOG_INDEX.has(connectorUid);
}
