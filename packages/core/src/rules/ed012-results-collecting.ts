import { DOCS, RESULTS_MIN_CONVERSIONS_PER_VARIANT, RESULTS_MIN_IDENTITIES_PER_VARIANT, RESULTS_REFRESH_MINUTES } from '../constants';
import { refreshResultsCommand } from '../flagsmith/commands';
import type { EvidenceItem } from '../types';
import { makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

/** ED-012: below 50 identities (and 5 conversions for occurrence metrics) per variation, results say "collecting data". */
export const ed012: Rule = {
  id: 'ED-012',
  title: 'Each variation has enough data for results',
  layer: 'results',
  node: 'results',
  rank: 150,
  run(ctx) {
    const exp = ctx.experiment;
    if (!exp) return skip('No experiment to read results for.');
    if (exp.status !== 'running' && exp.status !== 'completed') return skip(`The experiment is ${exp.status}.`);
    const results = ctx.config?.results;
    if (results === undefined) return skip('Results were not collected.');

    if (results === null) {
      return {
        status: 'pending',
        findings: [
          makeFinding(this, {
            kind: 'pending',
            severity: 'info',
            title: 'Results have not been computed yet',
            detail: `Flagsmith computes results on request. Refresh them (at most every ${RESULTS_REFRESH_MINUTES} minutes) and check again. This is not a failure.`,
            evidence: [{ label: 'GET results/ returned null', source: 'results' }],
            fix: { summary: 'Refresh the results, wait a few minutes, then run verify.', command: refreshResultsCommand(exp.id), docs: DOCS.codingAgent },
            confidence: 0.9,
          }),
        ],
      };
    }

    const expected = new Set(['control', ...(ctx.config?.flag?.variants ?? []).map((v) => v.key).filter((k): k is string => !!k)]);
    const short: EvidenceItem[] = [];
    let worst = Infinity;
    for (const metric of results.metrics) {
      const name = ctx.metrics?.find((m) => m.id === metric.metricId)?.name ?? `metric ${metric.metricId}`;
      const occurrence = (metric.aggregation ?? ctx.metrics?.find((m) => m.id === metric.metricId)?.aggregation) === 'occurrence';
      const seen = new Map(metric.variants.map((v) => [v.variant, v]));
      for (const key of new Set([...expected, ...seen.keys()])) {
        const v = seen.get(key);
        const ids = v?.identities ?? 0;
        const conv = v?.conversions ?? 0;
        const lowIds = ids < RESULTS_MIN_IDENTITIES_PER_VARIANT;
        const lowConv = occurrence && conv < RESULTS_MIN_CONVERSIONS_PER_VARIANT;
        if (lowIds || lowConv) {
          worst = Math.min(worst, ids / RESULTS_MIN_IDENTITIES_PER_VARIANT);
          short.push({
            label: `${name}, ${key}: ${ids}/${RESULTS_MIN_IDENTITIES_PER_VARIANT} identities${occurrence ? `, ${conv}/${RESULTS_MIN_CONVERSIONS_PER_VARIANT} conversions` : ''}`,
            source: 'results',
          });
        }
      }
    }
    if (!results.metrics.length) short.push({ label: 'Results contain no metric yet', source: 'results' });

    if (!short.length) return pass(`Every variation has at least ${RESULTS_MIN_IDENTITIES_PER_VARIANT} identities${results.asOf ? ` (as of ${results.asOf})` : ''}.`);
    return {
      status: 'pending',
      findings: [
        makeFinding(this, {
          kind: 'pending',
          severity: 'info',
          title: 'Still collecting data: not every variation has enough users yet',
          detail: `Flagsmith shows "collecting data" until each variation has ${RESULTS_MIN_IDENTITIES_PER_VARIANT} identities and, for occurrence metrics, ${RESULTS_MIN_CONVERSIONS_PER_VARIANT} conversions. The pipeline can be healthy and still be here. Keep the experiment running.`,
          evidence: short.slice(0, 8),
          fix: {
            summary: 'Wait for more traffic, refresh the results, then run verify. Nothing to repair.',
            command: refreshResultsCommand(exp.id),
            docs: DOCS.codingAgent,
          },
          confidence: Number.isFinite(worst) ? 0.9 : 0.8,
        }),
      ],
    };
  },
};
