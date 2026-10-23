import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter, hashPassword, isPasswordHash, verifyStoredPassword } from "../server/security";

describe("password storage", () => {
  it("stores a salted scrypt hash and verifies the correct password", () => {
    const first = hashPassword("demo123", "00112233445566778899aabbccddeeff");
    const second = hashPassword("demo123", "ffeeddccbbaa99887766554433221100");

    expect(first).not.toContain("$demo123");
    expect(first).not.toBe(second);
    expect(isPasswordHash(first)).toBe(true);
    expect(isPasswordHash("demo123")).toBe(false);
    expect(verifyStoredPassword("demo123", first)).toEqual({ valid: true, needsRehash: false });
  });

  it("rejects an incorrect or malformed hash", () => {
    const stored = hashPassword("demo123");

    expect(verifyStoredPassword("wrong", stored).valid).toBe(false);
    expect(verifyStoredPassword("demo123", "scrypt$broken$zzzz").valid).toBe(false);
  });

  it("accepts a legacy demo password once and marks it for rehashing", () => {
    expect(verifyStoredPassword("demo123", "demo123")).toEqual({ valid: true, needsRehash: true });
    expect(verifyStoredPassword("wrong", "demo123")).toEqual({ valid: false, needsRehash: false });
  });
});

describe("login rate limiter", () => {
  it("blocks attempts inside the window and allows them after reset", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);

    expect(limiter.consume("client1", 0).allowed).toBe(true);
    expect(limiter.consume("client1", 100).allowed).toBe(true);
    expect(limiter.consume("client1", 200)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.consume("client1", 1_000).allowed).toBe(true);

    limiter.reset("client1");
    expect(limiter.consume("client1", 1_001).allowed).toBe(true);
  });
});
