import crypto from "node:crypto";

const PASSWORD_PREFIX = "scrypt";
const PASSWORD_KEY_LENGTH = 64;

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const derivedKey = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  return `${PASSWORD_PREFIX}$${salt}$${derivedKey.toString("hex")}`;
}

export function isPasswordHash(value: string): boolean {
  return /^scrypt\$[a-f\d]+\$[a-f\d]{128}$/i.test(value);
}

export function verifyStoredPassword(password: string, storedPassword: string): PasswordVerification {
  const [prefix, salt, expectedHex, ...extra] = storedPassword.split("$");

  if (prefix === PASSWORD_PREFIX && salt && expectedHex && extra.length === 0) {
    try {
      const expected = Buffer.from(expectedHex, "hex");
      const actual = crypto.scryptSync(password, salt, expected.length);
      return {
        valid: expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual),
        needsRehash: false,
      };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  const supplied = Buffer.from(password);
  const legacy = Buffer.from(storedPassword);
  const valid = supplied.length === legacy.length && crypto.timingSafeEqual(supplied, legacy);
  return { valid, needsRehash: valid };
}

interface RateLimitBucket {
  attempts: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, currentTime = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const existing = this.buckets.get(key);
    const bucket = !existing || existing.resetAt <= currentTime
      ? { attempts: 0, resetAt: currentTime + this.windowMs }
      : existing;

    if (bucket.attempts >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
      };
    }

    bucket.attempts += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
