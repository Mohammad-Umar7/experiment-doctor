/**
 * Keeps keys out of anything we print, save or render. Server-side keys
 * (ser.*) are secrets; client-side environment keys are public by design but
 * we still never echo them, so reports can be shared without thinking.
 */

const SERVER_KEY = /\bser\.[A-Za-z0-9_-]{6,}/g;
const KEY_PROP = /\b(environmentID|environmentKey|environment_key|apiKey|api_key|FLAGSMITH_API_KEY|FLAGSMITH_ENVIRONMENT_KEY|X-Environment-Key|Authorization)(\s*[:=]\s*|["']\s*:\s*)(['"`])([^'"`\s]{4,})\3/g;
const BEARER = /\b(Bearer|Token|Api-Key)\s+[A-Za-z0-9._-]{12,}/g;

export function maskKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 6) return '***';
  return `${key.slice(0, 4)}…`;
}

export function redactSecrets(text: string): string {
  return text
    .replace(SERVER_KEY, 'ser.***')
    .replace(KEY_PROP, (_m, name: string, sep: string, q: string) => `${name}${sep}${q}***${q}`)
    .replace(BEARER, (_m, scheme: string) => `${scheme} ***`);
}

/** Redacts every string inside a JSON-like value. Also replaces exact known keys. */
export function redactDeep<T>(value: T, knownSecrets: string[] = []): T {
  const secrets = knownSecrets.filter((s) => s && s.length >= 6);
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = redactSecrets(v);
      for (const s of secrets) out = out.split(s).join('<env-key>');
      return out;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = visit(val);
      return o;
    }
    return v;
  };
  return visit(value) as T;
}
