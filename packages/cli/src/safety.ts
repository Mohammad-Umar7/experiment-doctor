/**
 * Mutation policy. Flagsmith changes (fix commands, canary) are refused unless
 * the human allowlisted that exact environment, by key or name:
 *   --allow-env <key|name>            (repeatable), or
 *   .experiment-doctor.json           { "allowMutations": ["Staging"] }
 * Names that look like production are not a classification we trust either
 * way: they only add a warning. --yes never bypasses the allowlist.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const POLICY_FILE = '.experiment-doctor.json';

const PRODUCTION = /(^|[^a-z])(prod|production|prd|live|main)([^a-z]|$)/i;

export function looksLikeProduction(name: string | undefined | null): boolean {
  if (!name) return false;
  return PRODUCTION.test(name.trim());
}

/** A Flagsmith client-side environment key (not a name). Server keys start with "ser.". */
export function looksLikeEnvKey(ref: string): boolean {
  return /^[A-Za-z0-9]{16,}$/.test(ref) || /^ser\.[A-Za-z0-9]+$/.test(ref);
}

export interface MutationPolicy {
  allow: string[];
  /** Where each entry came from, for messages. */
  sources: string[];
  errors: string[];
}

export function loadPolicy(root: string, cliAllow: string[] = []): MutationPolicy {
  const policy: MutationPolicy = { allow: cliAllow.map((s) => s.trim()).filter(Boolean), sources: cliAllow.length ? ['--allow-env'] : [], errors: [] };
  const file = join(root, POLICY_FILE);
  if (existsSync(file)) {
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as { allowMutations?: unknown };
      if (json.allowMutations !== undefined && !(Array.isArray(json.allowMutations) && json.allowMutations.every((x) => typeof x === 'string'))) {
        policy.errors.push(`${POLICY_FILE}: "allowMutations" must be a list of environment keys or names.`);
      } else if (Array.isArray(json.allowMutations)) {
        policy.allow.push(...(json.allowMutations as string[]).map((s) => s.trim()).filter(Boolean));
        policy.sources.push(POLICY_FILE);
      }
    } catch {
      policy.errors.push(`${POLICY_FILE} is not valid JSON, so it allows nothing.`);
    }
  }
  return policy;
}

export type Authorization = { ok: true; matched: 'key' | 'name'; warning?: string } | { ok: false; reason: string };

/** Fail-closed: unknown environment or no explicit allowlist entry means no. */
export function authorizeMutation(policy: MutationPolicy, env: { name?: string | null; key?: string | null }): Authorization {
  const how = `Allow it explicitly with --allow-env "${env.name ?? '<key or name>'}" or add it to ${POLICY_FILE}: {"allowMutations": ["${env.name ?? '<key or name>'}"]}.`;
  if (policy.errors.length) return { ok: false, reason: `${policy.errors.join(' ')} ${how}` };
  if (!env.name && !env.key) return { ok: false, reason: `The target environment could not be identified, so no change is allowed. ${how}` };
  const name = env.name?.trim().toLowerCase();
  const byKey = !!env.key && policy.allow.includes(env.key);
  const byName = !!name && policy.allow.some((a) => a.toLowerCase() === name);
  if (!byKey && !byName) {
    return { ok: false, reason: `Changes to environment "${env.name ?? 'unknown'}" are refused: it is not on the allowlist${policy.allow.length ? '' : ' (the allowlist is empty)'}. ${how}` };
  }
  const warning = looksLikeProduction(env.name) ? `"${env.name}" looks like a production environment. It is allowlisted, so the change is allowed after your confirmation.` : undefined;
  return warning ? { ok: true, matched: byKey ? 'key' : 'name', warning } : { ok: true, matched: byKey ? 'key' : 'name' };
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
