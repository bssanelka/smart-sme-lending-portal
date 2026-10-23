import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { IdempotencyConflictError, runIdempotentCommand } from "../server/idempotency";
import { runMigrations } from "../server/migrations";

function testDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  runMigrations(database);
  database.exec("CREATE TABLE command_effects (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)");
  const firstUserId = Number(database.prepare("INSERT INTO users (login, password, name, role) VALUES ('first', 'test', 'First', 'CLIENT')").run().lastInsertRowid);
  const secondUserId = Number(database.prepare("INSERT INTO users (login, password, name, role) VALUES ('second', 'test', 'Second', 'CLIENT')").run().lastInsertRowid);
  return { database, firstUserId, secondUserId };
}

describe("idempotent commands", () => {
  it("executes once, stores the response and replays it", () => {
    const { database, firstUserId } = testDatabase();
    try {
      let executions = 0;
      const command = {
        userId: firstUserId,
        key: "command-key-0001",
        operation: "application:accept",
        request: { applicationId: 10 },
        execute: () => {
          executions += 1;
          database.prepare("INSERT INTO command_effects (value) VALUES (?)").run("accepted");
          return { status: "SIGNING", sequence: executions };
        },
      };

      expect(runIdempotentCommand(database, command)).toEqual({
        value: { status: "SIGNING", sequence: 1 },
        replayed: false,
      });
      expect(runIdempotentCommand(database, command)).toEqual({
        value: { status: "SIGNING", sequence: 1 },
        replayed: true,
      });
      expect(executions).toBe(1);
      expect(database.prepare("SELECT COUNT(*) AS count FROM command_effects").get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("rejects reuse of a key with another payload", () => {
    const { database, firstUserId } = testDatabase();
    try {
      runIdempotentCommand(database, {
        userId: firstUserId,
        key: "command-key-0002",
        operation: "application:accept",
        request: { applicationId: 10 },
        execute: () => ({ ok: true }),
      });

      expect(() => runIdempotentCommand(database, {
        userId: firstUserId,
        key: "command-key-0002",
        operation: "application:accept",
        request: { applicationId: 11 },
        execute: () => ({ ok: true }),
      })).toThrow(IdempotencyConflictError);
    } finally {
      database.close();
    }
  });

  it("rejects reuse of a key for another operation", () => {
    const { database, firstUserId } = testDatabase();
    try {
      runIdempotentCommand(database, {
        userId: firstUserId,
        key: "command-key-0003",
        operation: "application:accept",
        request: {},
        execute: () => ({ ok: true }),
      });

      expect(() => runIdempotentCommand(database, {
        userId: firstUserId,
        key: "command-key-0003",
        operation: "application:decline",
        request: {},
        execute: () => ({ ok: true }),
      })).toThrow(IdempotencyConflictError);
    } finally {
      database.close();
    }
  });

  it("keeps identical keys independent between users", () => {
    const { database, firstUserId, secondUserId } = testDatabase();
    try {
      const first = runIdempotentCommand(database, {
        userId: firstUserId,
        key: "shared-command-key",
        operation: "application:accept",
        request: {},
        execute: () => ({ user: "first" }),
      });
      const second = runIdempotentCommand(database, {
        userId: secondUserId,
        key: "shared-command-key",
        operation: "application:accept",
        request: {},
        execute: () => ({ user: "second" }),
      });

      expect(first.value).toEqual({ user: "first" });
      expect(second.value).toEqual({ user: "second" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM idempotency_records").get()).toEqual({ count: 2 });
    } finally {
      database.close();
    }
  });

  it("does not retain a record or partial side effect after an exception", () => {
    const { database, firstUserId } = testDatabase();
    try {
      expect(() => runIdempotentCommand(database, {
        userId: firstUserId,
        key: "command-key-0004",
        operation: "application:sign",
        request: {},
        execute: () => {
          database.prepare("INSERT INTO command_effects (value) VALUES ('partial')").run();
          throw new Error("signing failed");
        },
      })).toThrow("signing failed");

      expect(database.prepare("SELECT COUNT(*) AS count FROM idempotency_records").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM command_effects").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("replays a lost response without repeating the side effect", () => {
    const { database, firstUserId } = testDatabase();
    try {
      const firstResponse = runIdempotentCommand(database, {
        userId: firstUserId,
        key: "command-key-0005",
        operation: "bank:application:issue",
        request: { applicationId: 10 },
        execute: () => {
          const result = database.prepare("INSERT INTO command_effects (value) VALUES ('issued')").run();
          return { effectId: Number(result.lastInsertRowid), status: "ISSUED" };
        },
      });
      expect(firstResponse.replayed).toBe(false);

      const recoveredResponse = runIdempotentCommand(database, {
        userId: firstUserId,
        key: "command-key-0005",
        operation: "bank:application:issue",
        request: { applicationId: 10 },
        execute: () => {
          throw new Error("must not execute on replay");
        },
      });

      expect(recoveredResponse).toEqual({ value: firstResponse.value, replayed: true });
      expect(database.prepare("SELECT COUNT(*) AS count FROM command_effects").get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });
});
