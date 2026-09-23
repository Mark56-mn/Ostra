/**
 * Client-side model preference.
 *
 * Remembers which provider/model the user picked in the chat header and hands
 * it to the chat controller so every /api/chat request carries the selection.
 * The server remains the authority: it re-validates the selection against its
 * allowlist on every request and never trusts this value beyond its shape.
 *
 * Storage mirrors the conversation repository: browser-local, no secrets
 * (provider/model IDs only), defensive parse on load.
 */
import { useSyncExternalStore } from "react";

export interface ModelPreference {
  provider: string;
  model: string;
}

const STORAGE_KEY = "ostra.model-preference.v1";

let state: ModelPreference | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function sanitize(value: unknown): ModelPreference | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const provider = typeof record.provider === "string" ? record.provider.trim().slice(0, 50) : "";
  const model = typeof record.model === "string" ? record.model.trim().slice(0, 200) : "";
  if (!provider || !model) return null;
  return { provider, model };
}

function readStored(): ModelPreference | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Loads the persisted preference once. Safe to call repeatedly. */
export function hydrateModelPreference(): void {
  if (hydrated) return;
  hydrated = true;
  state = readStored();
  emit();
}

export function getModelPreference(): ModelPreference | null {
  if (!hydrated) {
    hydrated = true;
    state = readStored();
  }
  return state;
}

export function setModelPreference(preference: ModelPreference | null): void {
  state = preference;
  hydrated = true;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (preference) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch {
    // Storage unavailable (private mode / quota) — keep the in-memory value.
  }
  emit();
}

export function subscribeModelPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server snapshot must be a stable reference across renders. */
const SERVER_SNAPSHOT: ModelPreference | null = null;

/** React binding: the currently selected model (null = server default). */
export function useModelPreference(): {
  preference: ModelPreference | null;
  setPreference: (preference: ModelPreference | null) => void;
} {
  const preference = useSyncExternalStore(subscribeModelPreference, getModelPreference, () => SERVER_SNAPSHOT);
  return { preference, setPreference: setModelPreference };
}

// ---------------------------------------------------------------------------
// Memory-write approval (V1)
// ---------------------------------------------------------------------------

/**
 * Explicit user consent for approval-gated memory writes (mem0.save_memory).
 * Off by default: when off, the model's request to save a memory is refused
 * by the server's permission engine. When on, each /api/chat request carries
 * the confirmation signal — which the server validates against its registry
 * and the permission engine still enforces per tool.
 */
const APPROVAL_KEY = "ostra.approve-memory-writes.v1";

let approvalState = false;
let approvalHydrated = false;
const approvalListeners = new Set<() => void>();

function emitApproval(): void {
  for (const listener of approvalListeners) listener();
}

function readApprovalStored(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(APPROVAL_KEY) === "true";
  } catch {
    return false;
  }
}

export function getMemoryWriteApproval(): boolean {
  if (!approvalHydrated) {
    approvalHydrated = true;
    approvalState = readApprovalStored();
  }
  return approvalState;
}

export function setMemoryWriteApproval(approved: boolean): void {
  approvalState = approved;
  approvalHydrated = true;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (approved) window.localStorage.setItem(APPROVAL_KEY, "true");
      else window.localStorage.removeItem(APPROVAL_KEY);
    }
  } catch {
    // Storage unavailable — keep the in-memory value.
  }
  emitApproval();
}

function subscribeApproval(listener: () => void): () => void {
  approvalListeners.add(listener);
  return () => {
    approvalListeners.delete(listener);
  };
}

/** React binding: whether the user has approved memory writes. */
export function useMemoryWriteApproval(): { approved: boolean; setApproved: (approved: boolean) => void } {
  const approved = useSyncExternalStore(subscribeApproval, getMemoryWriteApproval, () => false);
  return { approved, setApproved: setMemoryWriteApproval };
}
