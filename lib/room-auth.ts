import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const HOST_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
export const PLAYER_COOKIE_MAX_AGE = HOST_COOKIE_MAX_AGE;

function makeToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function verifyToken(token: string | undefined, expectedHash: string): boolean {
  if (!token) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function makeHostToken(): string {
  return makeToken();
}

export function hashHostToken(token: string): string {
  return hashToken(token);
}

export function verifyHostToken(
  token: string | undefined,
  expectedHash: string
): boolean {
  return verifyToken(token, expectedHash);
}

export function hostCookieName(code: string): string {
  return `wr-host-${code}`;
}

export function makePlayerToken(): string {
  return makeToken();
}

export function hashPlayerToken(token: string): string {
  return hashToken(token);
}

export function verifyPlayerToken(
  token: string | undefined,
  expectedHash: string
): boolean {
  return verifyToken(token, expectedHash);
}

export function playerCookieName(code: string, playerId: string): string {
  return `wr-player-${code}-${playerId}`;
}
