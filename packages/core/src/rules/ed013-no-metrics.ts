import { DOCS } from '../constants';
import { configItem, fail, makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

/** ED-013: an experiment without a metric has nothing to compute. */
export const ed013: Rule = {
  id: 'ED-013',
  title: 'The experiment has at least one metric',
  layer: 'config',
  node: 'flagsmith',
  rank: 35,
  run(ctx) {
    const exp = ctx.experiment;
    if (!exp) return skip('No experiment was collected.');
    if (exp.metricIds.length) return pass(`${exp.metricIds.length} metric(s) attached.`);
    return fail([
      makeFinding(this, {
        severity: 'critical',
        title: `Experiment "${exp.name}" has no metric`,
        detail: 'Results are computed per metric. With no metric attached, exposures are recorded but there is no conversion to compare, so the experiment can never show a result.',
        evidence: [configItem(`Experiment ${exp.id} metrics`, '[] (none)')],
        fix: {
          summary: 'Create a metric for your conversion event and attach it to the experiment.',
          steps: [
            'flagsmith api api/v1/environments/<env-key>/experiment-metrics/ --input - with {"name": "...", "aggregation": "occurrence", "direction": "up", "definition": {"version": 1, "event": "<event name>"}}',
            'Metrics cannot be changed on an existing experiment through the API: attach it when you create the experiment.',
          ],
          docs: DOCS.codingAgent,
        },
        confidence: 0.95,
      }),
    ]);
  },
};
