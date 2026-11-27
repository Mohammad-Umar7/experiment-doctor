import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { redactSecrets, type Patch } from '@experiment-doctor/core';
import type { Palette } from './color';

export type ApplyResult = { ok: true; path: string } | { ok: false; reason: string };

/** Resolves the patch file inside `root`, refusing anything that escapes it. */
export function patchPath(root: string, patch: Patch): string | null {
  if (isAbsolute(patch.file)) return null;
  const full = resolve(root, patch.file);
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

/**
 * Applies a line patch only if the file still has exactly the `before` text at
 * `line`. Keeps the file's line endings.
 */
export function applyPatch(root: string, patch: Patch): ApplyResult {
  const path = patchPath(root, patch);
  if (!path) return { ok: false, reason: `Refusing to write outside ${root}: ${patch.file}` };
  if (!existsSync(path)) return { ok: false, reason: `${patch.file} does not exist.` };
  const text = readFileSync(path, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const before = patch.before.split('\n');
  const start = patch.line - 1;
  const current = lines.slice(start, start + before.length);
  if (current.join('\n') !== patch.before) {
    return { ok: false, reason: `${patch.file}:${patch.line} changed since the diagnosis. Run experiment-doctor check again.` };
  }
  lines.splice(start, before.length, ...patch.after.split('\n'));
  writeFileSync(path, lines.join(eol));
  return { ok: true, path };
}

export function renderDiff(patch: Patch, c: Palette): string {
  const out = [c.bold(`--- ${patch.file}`), c.bold(`+++ ${patch.file}`), c.info(`@@ line ${patch.line} @@`)];
  const before = patch.before.split('\n');
  const after = patch.after.split('\n');
  // show unchanged leading lines as context
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same++;
  for (let i = 0; i < same; i++) out.push(c.muted(`  ${redactSecrets(before[i]!)}`));
  for (const l of before.slice(same)) out.push(c.critical(`- ${redactSecrets(l)}`));
  for (const l of after.slice(same)) out.push(c.healthy(`+ ${redactSecrets(l)}`));
  if (patch.placeholder) out.push(c.warning('! This patch contains a placeholder (for example user.id). Edit it to match your app.'));
  return out.join('\n');
}
