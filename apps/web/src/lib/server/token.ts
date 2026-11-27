import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed tokens. The challenge clock starts on the server when a session is
 * signed, so a player cannot shorten their time by editing anything in the browser.
 */
function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 16) return value;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (16+ characters) in production.");
  }
  return "dev-only-session-secret-change-me";
}

function b64(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function mac(body: string): string {
  return b64(createHmac("sha256", secret()).update(body).digest());
}

export function sign<T extends object>(payload: T): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(body)}`;
}

export function unsign<T>(token: unknown): T | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = mac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
