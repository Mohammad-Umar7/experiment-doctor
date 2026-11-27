import { DOCS } from '../constants';
import { configItem, fail, makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

/** ED-015: a running experiment whose rollout enrols nobody. */
export const ed015: Rule = {
  id: 'ED-015',
  title: 'The experiment rollout enrols identities',
  layer: 'config',
  node: 'flagsmith',
  rank: 40,
  run(ctx) {
    const exp = ctx.experiment;
    if (!exp || exp.status !== 'running') return skip('The experiment is not running.');
    const r = exp.rollout;
    if (r === undefined) return skip('The rollout was not collected.');
    if (r === null) return skip('The experiment has no rollout segment yet.');
    if (r.enabled && r.rolloutPercentage > 0) return pass(`${r.rolloutPercentage}% of identities are enrolled.`);
    return fail([
      makeFinding(this, {
        severity: 'critical',
        title: r.enabled ? 'The rollout is 0%, so nobody is enrolled' : 'The experiment rollout is disabled',
        detail: 'Only identities inside the rollout are enrolled. Users outside it record no exposure, so a 0% or disabled rollout keeps the experiment empty.',
        evidence: [configItem(`Experiment ${exp.id} rollout`, `enabled: ${r.enabled}, rollout_percentage: ${r.rolloutPercentage}`)],
        fix: {
          summary: 'Set the rollout percentage above 0 in the experiment (this changes who sees the variations, so it needs approval).',
          steps: ['Editing the rollout mid-experiment can affect the statistical validity of results.'],
          docs: DOCS.runExperiment,
        },
        confidence: 0.9,
      }),
    ]);
  },
};
