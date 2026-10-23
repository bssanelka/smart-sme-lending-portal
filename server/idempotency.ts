import crypto from "node:crypto";
import type Database from "better-sqlite3";

export class IdempotencyConflictError extends Error {
  constructor(message = "Idempotency-Key уже использован для другой команды") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

interface IdempotentCommand<T> {
  userId: number;
  key: string;
  operation: string;
  request: unknown;
  execute: () => T;
}

export interface IdempotentCommandResult<T> {
  value: T;
  replayed: boolean;
}

function requestHash(operation: string, request: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify({ operation, request })).digest("hex");
}

export function runIdempotentCommand<T>(
  database: Database.Database,
  command: IdempotentCommand<T>,
): IdempotentCommandResult<T> {
  const hash = requestHash(command.operation, command.request);
  const transaction = database.transaction(() => {
    const existing = database.prepare(`
      SELECT operation, request_hash, response_json
      FROM idempotency_records
      WHERE user_id = ? AND idempotency_key = ?
    `).get(command.userId, command.key) as { operation: string; request_hash: string; response_json: string } | undefined;

    if (existing) {
      if (existing.operation !== command.operation || existing.request_hash !== hash) {
        throw new IdempotencyConflictError();
      }
      return { value: JSON.parse(existing.response_json) as T, replayed: true };
    }

    const value = command.execute();
    database.prepare(`
      INSERT INTO idempotency_records (user_id, idempotency_key, operation, request_hash, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(command.userId, command.key, command.operation, hash, JSON.stringify(value), new Date().toISOString());
    return { value, replayed: false };
  });
  return transaction.immediate();
}
