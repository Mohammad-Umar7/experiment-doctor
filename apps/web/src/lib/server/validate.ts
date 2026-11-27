import "server-only";
import { HINT_VARIANTS, type HintVariant } from "@/lib/site";

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const HANDLE = /^[A-Za-z0-9_.-]{2,20}$/;

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export function isVariant(value: unknown): value is HintVariant {
  return value === HINT_VARIANTS.control || value === HINT_VARIANTS.challenger;
}

/** Trim, drop anything outside [A-Za-z0-9_.-] and enforce 2 to 20 characters. */
export function cleanHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.-]/g, "");
  return HANDLE.test(handle) ? handle : null;
}

export async function readJson(request: Request, maxBytes = 16_384): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
