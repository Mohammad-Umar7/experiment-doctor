import { DOCS, SRM_MIN_TOTAL_IDENTITIES, SRM_P_VALUE_THRESHOLD } from '../constants';
import { fail, makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

/** ED-014: sample ratio mismatch. The observed split differs from the configured weights. */
export const ed014: Rule = {
  id: 'ED-014',
  title: 'Traffic splits the way the experiment is configured',
  layer: 'results',
  node: 'results',
  rank: 140,
  optional: true,
  run(ctx) {
    const results = ctx.config?.results;
    if (!results) return skip('No computed results.');
    const p = results.srmPValue;
    const metric = results.metrics[0];
    const total = metric ? metric.variants.reduce((s, v) => s + v.identities, 0) : 0;
    if (p === null || p === undefined || total < SRM_MIN_TOTAL_IDENTITIES) return skip('Not enough traffic to judge the split.');
    if (p >= SRM_P_VALUE_THRESHOLD) return pass(`Split looks as configured (p = ${p.toFixed(3)}).`);
    return fail([
      makeFinding(this, {
        severity: 'warning',
        title: 'The traffic split does not match the configured weights',
        detail: `The sample ratio check gives p = ${p.toExponential(1)} (below ${SRM_P_VALUE_THRESHOLD}). Random assignment almost never drifts this far, so some users of one variation are not being exposed or counted. Results cannot be trusted until this is explained.`,
        evidence: metric!.variants.map((v) => ({ label: `${v.variant}: ${v.identities} identities`, source: 'results' as const })),
        fix: {
          summary: 'Check that every variation records exposures the same way (same code path, same identify, same flush).',
          steps: ['Look for a variation whose page crashes, redirects early or reads the flag with getValue.', 'Do not change the rollout while the experiment runs.'],
          docs: DOCS.runExperiment,
        },
        confidence: 0.8,
      }),
    ]);
  },
};
