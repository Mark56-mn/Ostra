import type { ModelConfig, ModelProviderFactory, ModelProvider } from "./types";

export class ModelProviderError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly retryable: boolean;
  readonly status?: number;
  /** Server-side diagnostic detail. Never sent to the browser as-is. */
  readonly detail?: string;

  constructor(
    message: string,
    options: {
      code: string;
      provider: string;
      retryable?: boolean;
      status?: number;
      detail?: string;
    },
  ) {
    super(message);
    this.name = "ModelProviderError";
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.detail = options.detail;
  }
}

/** Thrown when the provider is misconfigured (missing URL, bad format, ...). */
export class ModelConfigError extends ModelProviderError {
  constructor(message: string, options: { provider: string; detail?: string }) {
    super(message, { code: "model_misconfigured", provider: options.provider, retryable: false, detail: options.detail });
    this.name = "ModelConfigError";
  }
}

export type { ModelConfig, ModelProviderFactory, ModelProvider };
