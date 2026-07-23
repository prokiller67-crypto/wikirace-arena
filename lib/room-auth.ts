import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const HOST_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export function makeHostToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHostToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyHostToken(token: string | undefined, expectedHash: string): boolean {
  if (!token) return false;
  const actual = Buffer.from(hashHostToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hostCookieName(code: string): string {
  return `wr-host-${code}`;
}
