import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { redactSecrets, type Patch } from '@experiment-doctor/core';
import type { Palette } from './color';

export type ApplyResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Resolves the patch target inside `root`. Both sides go through realpath, so
 * a symlink or junction that points outside the scan root is refused too.
 */
export function patchPath(root: string, patch: Patch): ApplyResult {
  if (!patch.file || isAbsolute(patch.file) || patch.file.includes('\0')) return { ok: false, reason: `Refusing an absolute or invalid patch path: ${patch.file}` };
  const full = resolve(root, patch.file);
  if (!existsSync(full)) return { ok: false, reason: `${patch.file} does not exist.` };
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = realpathSync(root);
    realFile = realpathSync(full);
  } catch {
    return { ok: false, reason: `Cannot resolve ${patch.file}.` };
  }
  const rel = relative(realRoot, realFile);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, reason: `Refusing to write outside the scanned folder: ${patch.file} resolves to ${realFile}.` };
  }
  if (!statSync(realFile).isFile()) return { ok: false, reason: `${patch.file} is not a regular file.` };
  return { ok: true, path: realFile };
}

/**
 * Applies a line patch only if the file still has exactly the `before` text at
 * `line`. Keeps the file's line endings.
 */
export function applyPatch(root: string, patch: Patch): ApplyResult {
  const target = patchPath(root, patch);
  if (!target.ok) return target;
  const path = target.path;
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
