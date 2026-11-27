/** String helpers for comparing event names and identifier expressions. */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** "Purchase Completed", "purchase_completed" and "purchaseCompleted" all fold to "purchasecompleted". */
export function foldName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-.:/]+/g, '');
}

export type NameMatch = 'exact' | 'case' | 'format' | 'typo' | 'none';

/** How close is `candidate` to the expected event name? */
export function compareNames(expected: string, candidate: string): NameMatch {
  if (expected === candidate) return 'exact';
  if (expected.toLowerCase() === candidate.toLowerCase()) return 'case';
  if (foldName(expected) === foldName(candidate)) return 'format';
  const a = foldName(expected);
  const b = foldName(candidate);
  const limit = Math.max(1, Math.floor(Math.min(a.length, b.length) / 5));
  if (levenshtein(a, b) <= Math.min(2, limit)) return 'typo';
  return 'none';
}

/** A safe variation key derived from a value: "Big Green Button" -> "big_green_button". */
export function slugify(value: unknown): string {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s || s === 'control') return s === 'control' ? 'control_variant' : 'variant';
  return s.slice(0, 50);
}

/** Normalises an identifier expression for comparison. */
export function normaliseExpr(expr: string): string {
  let e = expr.trim();
  // String(x), `${x}`, x.toString()
  const str = /^String\((.*)\)$/s.exec(e);
  if (str?.[1]) e = str[1];
  const tpl = /^`\$\{([^}]*)\}`$/.exec(e);
  if (tpl?.[1]) e = tpl[1];
  e = e.replace(/\.toString\(\)$/, '');
  e = e.replace(/\s+/g, '').replace(/\?\./g, '.').replace(/!/g, '');
  e = e.replace(/^this\./, '');
  return e;
}

/** The last property of a member expression: "req.user.email" -> "email". */
export function exprTail(expr: string): string {
  const n = normaliseExpr(expr);
  const m = /([A-Za-z_$][\w$]*)\s*(?:\[\s*['"]([^'"]+)['"]\s*\])?$/.exec(n);
  if (!m) return n;
  return (m[2] ?? m[1] ?? n).toLowerCase();
}

/** Identifier-ish words that all mean "the user's id". */
const ID_WORDS = new Set(['id', 'userid', 'uid', 'user_id', 'uuid', 'sub', 'accountid', 'customerid', 'identifier', 'identity']);
const EMAIL_WORDS = new Set(['email', 'emailaddress', 'mail', 'useremail']);
const NAME_WORDS = new Set(['name', 'username', 'login', 'handle', 'displayname']);

export type IdentityKind = 'id' | 'email' | 'name' | 'session' | 'other';

export function identityKind(expr: string): IdentityKind {
  const t = exprTail(expr).replace(/[^a-z_]/g, '');
  if (ID_WORDS.has(t) || /(^|_)id$/.test(t) || /id$/.test(t)) return 'id';
  if (EMAIL_WORDS.has(t) || t.includes('email')) return 'email';
  if (NAME_WORDS.has(t)) return 'name';
  if (t.includes('session') || t.includes('anon') || t.includes('device')) return 'session';
  return 'other';
}

/** Do two identifier expressions plausibly refer to the same value? */
export function sameIdentity(a: string, b: string): boolean {
  const na = normaliseExpr(a);
  const nb = normaliseExpr(b);
  if (na === nb) return true;
  const ka = identityKind(na);
  const kb = identityKind(nb);
  if (ka !== 'other' && ka === kb) return true;
  return exprTail(na) === exprTail(nb);
}

/** Replace the tail property of `expr` with the tail of `like`: (customer.email, user.id) -> customer.id */
export function retargetExpr(expr: string, like: string): string {
  const raw = expr.trim();
  const tail = /^(.*[.\]])\s*([A-Za-z_$][\w$]*)$/.exec(raw.replace(/\?\./g, '?.'));
  const likeTail = /([A-Za-z_$][\w$]*)$/.exec(normaliseExpr(like));
  if (tail?.[1] && likeTail?.[1]) return `${tail[1]}${likeTail[1]}`;
  return like.trim();
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
