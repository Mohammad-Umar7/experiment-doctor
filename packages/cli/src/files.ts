import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SourceFile } from '@experiment-doctor/core';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.vercel', '.cache', '.experiment-doctor', '.svelte-kit', '.output']);
const WANTED = /\.(?:[mc]?[jt]sx?)$|(^|[\\/])package\.json$|(^|[\\/])(\.mcp\.json|mcp\.json)$/i;
const SDK_PACKAGES = ['@flagsmith/flagsmith', '@flagsmith/nodejs', 'flagsmith-nodejs', 'flagsmith', 'react-native-flagsmith'];
const MAX_FILES = 5000;
const MAX_BYTES = 750_000;

/** Reads the files the scanner understands, skipping node_modules (except installed SDK manifests). */
export function readSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const manifests: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (files.length >= MAX_FILES || depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.') && !['.cursor', '.vscode'].includes(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && WANTED.test(full)) {
        if (/\.d\.ts$/.test(e.name)) continue;
        try {
          if (statSync(full).size > MAX_BYTES) continue;
          files.push({ path: toPosix(relative(root, full)), content: readFileSync(full, 'utf8') });
          if (e.name === 'package.json') manifests.push(dir);
        } catch {
          // unreadable file: skip
        }
      }
    }
  };
  walk(root, 0);
  // Installed SDK versions beat package.json ranges.
  for (const dir of manifests) {
    for (const pkg of SDK_PACKAGES) {
      const p = join(dir, 'node_modules', ...pkg.split('/'), 'package.json');
      if (existsSync(p)) {
        try {
          files.push({ path: toPosix(relative(root, p)), content: readFileSync(p, 'utf8') });
        } catch {
          // ignore
        }
      }
    }
  }
  return files;
}

export function toPosix(p: string): string {
  return p.split(sep).join('/');
}
