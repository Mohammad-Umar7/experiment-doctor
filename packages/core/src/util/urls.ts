import { CLOUD_HOSTS, DEFAULT_EVENTS_API_URL } from '../constants';

/** Returns the literal string value of a JS string literal, or null for any other expression. */
export function stringLiteral(expr: string | null | undefined): string | null {
  if (!expr) return null;
  const e = expr.trim();
  const m = /^(['"])((?:\\.|(?!\1).)*)\1$/s.exec(e);
  if (m) return (m[2] ?? '').replace(/\\(.)/g, '$1');
  const t = /^`([^`$]*)`$/s.exec(e);
  if (t) return t[1] ?? '';
  return null;
}

export function hostOf(url: string): string | null {
  const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url.trim());
  return m?.[1]?.toLowerCase() ?? null;
}

/** scheme://host[:port] of a URL. */
export function originOf(url: string): string | null {
  const m = /^([a-z]+:\/\/[^/?#]+)/i.exec(url.trim());
  return m?.[1] ?? null;
}

export function isCloudUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return (CLOUD_HOSTS as readonly string[]).includes(host) || host.endsWith('.flagsmith.com');
}

export function isDefaultEventsUrl(url: string): boolean {
  const host = hostOf(url);
  return host === (hostOf(DEFAULT_EVENTS_API_URL) ?? '');
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * The events URL a self-hosted install with the Flagsmith database should use:
 * the API origin followed by /api/ (the SDK appends v1/events).
 */
export function selfHostedEventsUrl(apiUrl: string): string | null {
  const origin = originOf(apiUrl);
  if (!origin) return null;
  const path = apiUrl.trim().slice(origin.length);
  // Keep any path prefix before /api (reverse proxies such as /flagsmith/api/v1/).
  const prefix = /^(.*?)\/api(?:\/v1)?\/?$/.exec(path)?.[1] ?? '';
  return `${origin}${prefix}/api/`;
}

/** Where the SDK will POST events for a given eventsApiUrl (mirrors the JS and Node SDKs). */
export function eventsEndpoint(eventsApiUrl: string | null | undefined): string {
  return `${ensureTrailingSlash(eventsApiUrl || DEFAULT_EVENTS_API_URL)}v1/events`;
}
