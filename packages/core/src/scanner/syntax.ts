/**
 * Bracket matching and argument splitting. All functions work on the lexer's
 * skeleton (string contents blanked, so brackets inside strings never count)
 * and return offsets that are valid in the original source too.
 */

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Index of the bracket that closes the one at `open`, or -1. */
export function findClose(skel: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < skel.length; i++) {
    const c = skel[i]!;
    if (c in OPEN) stack.push(OPEN[c]!);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

export interface Span {
  start: number;
  end: number;
}

/** Splits skel[start, end) on top-level commas. Empty trailing parts are dropped. */
export function splitTopLevel(skel: string, start: number, end: number): Span[] {
  const parts: Span[] = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i++) {
    const c = skel[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '<' && /[A-Za-z]/.test(skel[i + 1] ?? '') && depth === 0) {
      // possible TS generic or JSX inside an argument; leave depth alone
    } else if (c === ',' && depth === 0) {
      parts.push({ start: from, end: i });
      from = i + 1;
    }
  }
  parts.push({ start: from, end });
  return parts.filter((p) => skel.slice(p.start, p.end).trim().length > 0);
}

export interface CallArgs {
  /** Offset of "(" */
  open: number;
  /** Offset of ")" */
  close: number;
  args: Span[];
}

export function readCallArgs(skel: string, open: number): CallArgs | null {
  const close = findClose(skel, open);
  if (close < 0) return null;
  return { open, close, args: splitTopLevel(skel, open + 1, close) };
}

export interface Prop {
  key: string;
  /** Value text, trimmed. For shorthand props, the key itself. */
  value: string;
  keyOffset: number;
  valueOffset: number;
  valueEnd: number;
  shorthand: boolean;
}

/** Top-level properties of the object literal whose "{" is at `open`. */
export function parseObject(code: string, skel: string, open: number): { props: Prop[]; close: number } | null {
  if (skel[open] !== '{') return null;
  const close = findClose(skel, open);
  if (close < 0) return null;
  const props: Prop[] = [];
  for (const part of splitTopLevel(skel, open + 1, close)) {
    const text = code.slice(part.start, part.end);
    const lead = text.length - text.trimStart().length;
    const body = text.trim();
    if (body.startsWith('...')) continue;
    const m = /^(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*(:)?/.exec(body);
    if (!m) continue;
    const key = (m[2] ?? m[3])!;
    if (m[4]) {
      const after = m[0].length;
      const rawValue = body.slice(after);
      const valueLead = rawValue.length - rawValue.trimStart().length;
      props.push({
        key,
        value: rawValue.trim(),
        keyOffset: part.start + lead,
        valueOffset: part.start + lead + after + valueLead,
        valueEnd: part.end,
        shorthand: false,
      });
    } else if (/^[A-Za-z_$][\w$]*$/.test(body)) {
      props.push({ key, value: key, keyOffset: part.start + lead, valueOffset: part.start + lead, valueEnd: part.end, shorthand: true });
    }
  }
  return { props, close };
}

/** Offset of the first non-space character at or after `from`. */
export function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

/**
 * Reads the receiver expression immediately before a ".method" at `dot`
 * (e.g. "this.flagsmith"). `start` is where the receiver begins, or `dot`
 * when there is none (e.g. a call result).
 */
export function receiverBefore(skel: string, dot: number): { text: string; start: number } {
  let i = dot - 1;
  if (skel[i] === '?') i--; // optional chaining "?."
  while (i >= 0 && /\s/.test(skel[i]!)) i--;
  const end = i + 1;
  while (i >= 0) {
    const c = skel[i]!;
    if (/[\w$]/.test(c) || c === '.') {
      i--;
      continue;
    }
    if (c === '?' && skel[i + 1] === '.') {
      i--;
      continue;
    }
    break;
  }
  const start = i + 1;
  const text = skel.slice(start, end).replace(/\?\./g, '.').replace(/^\.+/, '');
  return { text, start: text ? start : dot };
}

/** The last identifier of a receiver chain: "this.flagsmith" -> "flagsmith". */
export function lastIdent(receiver: string): string {
  const m = /([A-Za-z_$][\w$]*)$/.exec(receiver);
  return m?.[1] ?? '';
}
