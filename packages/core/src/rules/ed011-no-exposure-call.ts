import { DOCS } from '../constants';
import type { Finding, PlainFlagReadEvidence } from '../types';
import { codeItem, fail, makeFinding, pass, rewriteCall, skip, where, withPatch } from './helpers';
import type { Rule } from './types';

/** ED-011: normal flag reads (getValue, hasFeature, getAllFlags, useFlags) record no exposure. */
export const ed011: Rule = {
  id: 'ED-011',
  title: 'The experiment flag is read with getExperimentFlag',
  layer: 'instrumentation',
  node: 'app',
  rank: 70,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');
    const key = ctx.flagKey;
    const exp = code.experimentFlags;
    const reads = code.plainFlagReads;

    if (key) {
      const viaExperiment = exp.filter((c) => c.flag === key);
      const viaExposure = code.exposures.filter((e) => e.flag === key);
      if (viaExperiment.length || viaExposure.length) {
        const first = viaExperiment[0]?.loc ?? viaExposure[0]!.loc;
        return pass(`"${key}" records exposures (${viaExperiment.length ? viaExperiment[0]!.method : 'trackExposureEvent'} at ${where(first)}).`);
      }
      const plain = reads.filter((r) => r.flag === key);
      if (plain.length) return fail([plainRead(this, key, plain)]);
      if (exp.some((c) => c.flag === null)) return skip('getExperimentFlag is called with a flag name computed at runtime.');
      const bulk = reads.filter((r) => r.flag === null);
      if (bulk.length) {
        return fail([
          makeFinding(this, {
            severity: 'warning',
            title: `"${key}" is only read through ${bulk[0]!.method}(), which records no exposure`,
            detail: 'Reading all flags at once evaluates them but never records an exposure, so the experiment sees no enrolled users.',
            evidence: bulk.slice(0, 3).map((r) => codeItem(`${r.method}()`, r.loc)),
            fix: { summary: `Read the flag with getExperimentFlag('${key}') where the user sees the variation.`, docs: DOCS.runExperiment },
            confidence: 0.6,
          }),
        ]);
      }
      return fail([
        makeFinding(this, {
          severity: 'warning',
          title: `The scanned code never reads "${key}"`,
          detail: 'No call reads the experiment flag, so nothing records exposures. If the flag is read in another app or package, scan that directory instead.',
          evidence: [{ label: `No reference to "${key}" in ${code.scannedFiles} scanned files`, source: 'code' }],
          fix: { summary: `Call getExperimentFlag('${key}') where the user sees the variation, or run the check on the right directory with --dir.`, docs: DOCS.runExperiment },
          confidence: 0.5,
        }),
      ]);
    }

    if (exp.length || code.exposures.length) return pass('Exposures are recorded with getExperimentFlag (flag key unknown).');
    if (reads.length && code.trackEvents.length) {
      return fail([
        makeFinding(this, {
          severity: 'warning',
          title: 'Conversions are tracked but no code records exposures',
          detail: 'The app tracks events and reads flags, but never calls getExperimentFlag or trackExposureEvent, so no user is counted as exposed.',
          evidence: reads.slice(0, 3).map((r) => codeItem(`${r.method}(${r.flag ? `'${r.flag}'` : ''})`, r.loc)),
          fix: { summary: 'Read the experiment flag with getExperimentFlag (useExperiment in React). Pass --flag to check a specific flag.', docs: DOCS.runExperiment },
          confidence: 0.6,
        }),
      ]);
    }
    return skip('No experiment flag key is known and no flag reads were found.');
  },
};

function plainRead(rule: Rule, key: string, plain: PlainFlagReadEvidence[]): Finding {
  const r = plain[0]!;
  let patch = null;
  let summary = `Read "${key}" with getExperimentFlag where the user sees it.`;
  if (r.method === 'getValue') {
    patch = rewriteCall(r.loc, 'getValue', 'getExperimentFlag', '?.value');
    summary = `Replace getValue('${key}') with getExperimentFlag('${key}')?.value.`;
  } else if (r.method === 'hasFeature') {
    patch = rewriteCall(r.loc, 'hasFeature', 'getExperimentFlag', '?.enabled');
    summary = `Replace hasFeature('${key}') with getExperimentFlag('${key}')?.enabled.`;
  } else if (r.method === 'useFlags') {
    summary = `Use \`const flag = useExperiment('${key}')\` from flagsmith/react instead of useFlags(['${key}']).`;
  } else if (r.method === 'getFeatureValue' || r.method === 'isFeatureEnabled' || r.method === 'getFlag') {
    summary = `Use \`await client.getExperimentFlag('${key}', identifier)\` instead of getIdentityFlags(...).${r.method}('${key}').`;
  }
  return makeFinding(rule, {
    severity: 'critical',
    title: `"${key}" is read with ${r.method}(), which records no exposure`,
    detail: `Only getExperimentFlag (useExperiment in React) records the exposure that enrols a user in the experiment. ${r.method}() returns the same variation but tells Flagsmith nothing, so the experiment shows no exposures and conversions are never attributed.`,
    evidence: plain.slice(0, 3).map((p) => codeItem(`${p.method}('${key}')`, p.loc)),
    fix: withPatch(
      {
        summary,
        steps: ['If the flag is evaluated in one place and shown in another, keep the normal read and call trackExposureEvent at display time instead.'],
        docs: DOCS.runExperiment,
      },
      patch,
    ),
    confidence: 0.93,
  });
}
