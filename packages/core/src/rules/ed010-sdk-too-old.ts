import { DOCS, SDK_REQUIREMENTS } from '../constants';
import type { Finding, SdkPackageEvidence } from '../types';
import { compareVersions, parseRange, parseVersion, rangeCanSatisfy } from '../util/semver';
import { codeItem, fail, makeFinding, pass, replaceInLine, skip, withPatch } from './helpers';
import type { Rule } from './types';

/** ED-010: experiment events need @flagsmith/flagsmith >= 12.4.0 or @flagsmith/nodejs >= 9.1.0. */
export const ed010: Rule = {
  id: 'ED-010',
  title: 'The SDK version can send experiment events',
  layer: 'instrumentation',
  node: 'sdk',
  rank: 50,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');
    if (!code.packages.length) return skip('No package.json in the scanned code declares a Flagsmith SDK.');

    const findings: Finding[] = [];
    const unsure: string[] = [];
    const ok: string[] = [];
    for (const pkg of code.packages) {
      const req = SDK_REQUIREMENTS.find((r) => r.name === pkg.name)!;
      if (req.minVersion === null) {
        findings.push(replacedPackage(this, pkg));
        continue;
      }
      const min = parseVersion(req.minVersion)!;
      const installed = parseVersion(pkg.installed);
      if (installed) {
        if (compareVersions(installed, min) < 0) findings.push(tooOld(this, pkg, `installed ${pkg.installed}`));
        else ok.push(`${pkg.name}@${pkg.installed}`);
        continue;
      }
      const range = parseRange(pkg.range);
      if (!range) {
        unsure.push(`${pkg.name} "${pkg.range}" cannot be read`);
        continue;
      }
      if (compareVersions(range.min, min) >= 0) ok.push(`${pkg.name}@${pkg.range}`);
      else if (!rangeCanSatisfy(range, min)) findings.push(tooOld(this, pkg, `"${pkg.range}" in package.json`));
      else unsure.push(`${pkg.name} "${pkg.range}" also allows versions below ${req.minVersion}; the installed version is unknown (run npm ls ${pkg.name})`);
    }

    if (findings.length) return fail(findings);
    if (unsure.length) return skip(unsure.join('. '));
    return pass(`SDK versions support experiments: ${ok.join(', ')}.`);
  },
};

function tooOld(rule: Rule, pkg: SdkPackageEvidence, seen: string): Finding {
  const req = SDK_REQUIREMENTS.find((r) => r.name === pkg.name)!;
  const target = `^${req.recommended ?? req.minVersion}`;
  const patch = pkg.range ? replaceInLine(pkg.manifest, `"${pkg.range}"`, `"${target}"`) : null;
  return makeFinding(rule, {
    severity: 'critical',
    title: `${pkg.name} is too old to send experiment events (${seen})`,
    detail: `Experiments need ${pkg.name} ${req.minVersion} or newer. Older versions have no event pipeline, or record exposures without the experiment enrolment check, so the experiment gets no usable data.`,
    evidence: [codeItem(`${pkg.name} ${seen}`, pkg.manifest)],
    fix: withPatch(
      {
        summary: `Upgrade ${pkg.name} to ${target}, then reinstall.`,
        steps: [`npm install ${pkg.name}@${req.recommended ?? req.minVersion}`],
        docs: DOCS.codingAgent,
      },
      patch,
    ),
    confidence: pkg.installed ? 0.97 : 0.9,
  });
}

function replacedPackage(rule: Rule, pkg: SdkPackageEvidence): Finding {
  const req = SDK_REQUIREMENTS.find((r) => r.name === pkg.name)!;
  const repl = SDK_REQUIREMENTS.find((r) => r.name === req.replacement);
  const version = repl?.recommended ?? repl?.minVersion ?? 'latest';
  const patch = req.replacement && pkg.range ? replaceInLine(pkg.manifest, `"${pkg.name}": "${pkg.range}"`, `"${req.replacement}": "^${version}"`) : null;
  return makeFinding(rule, {
    severity: req.kind === 'react-native' ? 'warning' : 'critical',
    title: `${pkg.name} cannot send experiment events`,
    detail: `${req.note}${req.replacement ? ` Move to ${req.replacement} ${repl?.minVersion ?? ''}+.` : ''}`,
    evidence: [codeItem(`${pkg.name} ${pkg.range ?? ''}`.trim(), pkg.manifest)],
    fix: withPatch(
      {
        summary: req.replacement ? `Replace ${pkg.name} with ${req.replacement}@^${version} and update the imports.` : `Use an SDK that supports experiments.`,
        steps: req.replacement
          ? [`npm uninstall ${pkg.name} && npm install ${req.replacement}@${version}`, `Change imports from '${pkg.name}' to '${req.replacement}'.`]
          : [],
        docs: DOCS.codingAgent,
      },
      patch,
    ),
    confidence: 0.95,
  });
}
