/** Tiny semver helpers, enough to compare SDK versions from package.json. */

export type Version = [number, number, number];

export function parseVersion(text: string | null | undefined): Version | null {
  if (!text) return null;
  const m = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(text);
  if (!m) return null;
  const part = (s: string | undefined) => (s === undefined || s === 'x' || s === '*' ? 0 : Number(s));
  return [Number(m[1]), part(m[2]), part(m[3])];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function formatVersion(v: Version): string {
  return v.join('.');
}

export interface RangeInfo {
  /** Lowest version the range accepts. */
  min: Version;
  /** Does the range accept this exact version? */
  accepts: (v: Version) => boolean;
  /** True for a pinned version such as "12.3.0". */
  exact: boolean;
}

const gte = (a: Version, b: Version) => compareVersions(a, b) >= 0;

/**
 * Understands the ranges people actually write: 1.2.3, ^1.2.3, ~1.2.3, >=1.2.3,
 * 1.x, *, latest, workspace:*, npm:@scope/pkg@^1.2.3. Unknown forms return null.
 */
export function parseRange(range: string | null | undefined): RangeInfo | null {
  if (range === null || range === undefined) return null;
  let r = range.trim();
  const alias = /^npm:(?:@[^/]+\/)?[^@]+@(.+)$/.exec(r);
  if (alias?.[1]) r = alias[1];
  if (r === '' || r === '*' || r === 'x' || r === 'latest' || r.startsWith('workspace:')) {
    return { min: [0, 0, 0], accepts: () => true, exact: false };
  }
  if (/^(file:|link:|git|https?:|github:)/.test(r)) return null;
  const first = r.split('||')[0]!.trim().split(/\s+/)[0]!;
  const op = /^(\^|~|>=|>|=|<=|<)?v?(.*)$/.exec(first);
  if (!op) return null;
  const operator = op[1] ?? '';
  const body = op[2] ?? '';
  const v = parseVersion(body);
  if (!v) return null;
  const parts = body.split('.');
  const wildcard = parts.length < 3 || parts.some((p) => p === 'x' || p === '*');

  switch (operator) {
    case '>=':
    case '>':
      return { min: v, accepts: (t) => gte(t, v), exact: false };
    case '<':
    case '<=':
      return { min: [0, 0, 0], accepts: (t) => compareVersions(t, v) < (operator === '<=' ? 1 : 0), exact: false };
    case '^':
      if (v[0] > 0) return { min: v, accepts: (t) => t[0] === v[0] && gte(t, v), exact: false };
      return { min: v, accepts: (t) => t[0] === 0 && t[1] === v[1] && gte(t, v), exact: false };
    case '~':
      return { min: v, accepts: (t) => t[0] === v[0] && t[1] === v[1] && gte(t, v), exact: false };
    default:
      if (wildcard) {
        return {
          min: v,
          accepts: (t) => t[0] === v[0] && (parts.length < 2 || parts[1] === 'x' || parts[1] === '*' || t[1] === v[1]),
          exact: false,
        };
      }
      return { min: v, accepts: (t) => compareVersions(t, v) === 0, exact: true };
  }
}

/**
 * Can this range resolve to a version >= target? Caret ranges accept later
 * minors in the same major, so ^12.0.0 can still install 12.6.0.
 */
export function rangeCanSatisfy(range: RangeInfo, target: Version): boolean {
  if (gte(range.min, target)) return true;
  if (range.exact) return false;
  const probes: Version[] = [target, [target[0], target[1], target[2] + 1], [target[0], target[1] + 1, 0], [target[0], 99, 0]];
  return probes.some((p) => range.accepts(p));
}
