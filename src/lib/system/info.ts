/**
 * Shape of the Ostra web/API surface that the browser is allowed to see.
 * Deliberately contains no URLs, keys or other secrets.
 */
export interface SystemInfo {
  status: "ok";
  system: "ostra";
  version: string;
  /** Which provider the server-side agent runtime is currently using. */
  mode: "mock" | "http";
  provider: string;
  model: string;
  /** True when MODEL_API_URL is configured (never reveals the URL itself). */
  endpointConfigured: boolean;
  apiFormat: string;
  timestamp: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
  requestId?: string;
}

export interface ChatApiSuccess {
  message: string;
  conversationId: string;
  model: string;
  provider: string;
  mode: "mock" | "http";
  latencyMs: number;
}
