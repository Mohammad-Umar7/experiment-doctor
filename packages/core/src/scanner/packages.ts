import { SDK_REQUIREMENTS } from '../constants';
import type { SdkPackageEvidence } from '../types';

export const SDK_PACKAGE_NAMES = SDK_REQUIREMENTS.map((r) => r.name);

const INSTALLED_RE = new RegExp(
  `(^|/)node_modules/(${SDK_PACKAGE_NAMES.map((n) => n.replace(/[/.]/g, '\\$&')).join('|')})/package\\.json$`,
);

export function isInstalledManifest(path: string): boolean {
  return INSTALLED_RE.test(path);
}

/** Reads the Flagsmith SDK dependencies declared in one package.json. */
export function readManifest(path: string, content: string): SdkPackageEvidence[] {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const out: SdkPackageEvidence[] = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = json[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
      const req = SDK_REQUIREMENTS.find((r) => r.name === name);
      if (!req) continue;
      if (out.some((p) => p.name === name)) continue;
      const idx = lines.findIndex((l) => l.includes(`"${name}"`));
      out.push({
        name,
        kind: req.kind,
        range: typeof range === 'string' ? range : null,
        manifest: idx >= 0 ? { file: path, line: idx + 1, snippet: lines[idx]!.trim(), text: lines[idx]! } : { file: path, line: 1 },
      });
    }
  }
  return out;
}

/** Version from an installed node_modules/<pkg>/package.json. */
export function readInstalled(path: string, content: string): { name: string; version: string; root: string } | null {
  const m = INSTALLED_RE.exec(path);
  if (!m) return null;
  try {
    const json = JSON.parse(content) as { name?: string; version?: string };
    if (!json.version) return null;
    const root = path.slice(0, m.index + (m[1] ? 1 : 0));
    return { name: m[2]!, version: json.version, root };
  } catch {
    return null;
  }
}
