/** Production guard and key handling shared by fix and canary. */

const PRODUCTION = /(^|[^a-z])(prod|production|prd|live|main)([^a-z]|$)/i;

export function looksLikeProduction(name: string | undefined | null): boolean {
  if (!name) return false;
  return PRODUCTION.test(name.trim());
}

/** A Flagsmith client-side environment key (not a name). Server keys start with "ser.". */
export function looksLikeEnvKey(ref: string): boolean {
  return /^[A-Za-z0-9]{16,}$/.test(ref) || /^ser\.[A-Za-z0-9]+$/.test(ref);
}

/** Splits a command line into argv, honouring single and double quotes. No shell is involved. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}
