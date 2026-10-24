import { ApiRequestError } from "@/lib/api";

export type MutationRecoveryResult<T> =
  | { status: "confirmed-error"; error: Error }
  | { status: "applied"; value: T }
  | { status: "retry"; value: T }
  | { status: "unresolved"; error: Error };

function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

function createMutationKey(): string {
  if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return `cmd-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function getMutationKey(scope: string): string {
  const storageKey = `credit-command:${scope}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const key = createMutationKey();
  window.sessionStorage.setItem(storageKey, key);
  return key;
}

export function clearMutationKey(scope: string): void {
  window.sessionStorage.removeItem(`credit-command:${scope}`);
}

export async function recoverMutationOutcome<T>(
  reason: unknown,
  loadCurrentState: () => Promise<T>,
  isApplied: (state: T) => boolean,
): Promise<MutationRecoveryResult<T>> {
  if (!(reason instanceof ApiRequestError) || reason.kind !== "unknown") {
    return { status: "confirmed-error", error: toError(reason, "Команда отклонена сервером") };
  }

  try {
    const value = await loadCurrentState();
    return isApplied(value) ? { status: "applied", value } : { status: "retry", value };
  } catch (error) {
    return { status: "unresolved", error: toError(error, "Не удалось проверить результат команды") };
  }
}
