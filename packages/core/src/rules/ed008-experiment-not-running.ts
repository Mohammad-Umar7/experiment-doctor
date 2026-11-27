import { DOCS } from '../constants';
import { createExperimentHint, startExperimentCommand } from '../flagsmith/commands';
import { configItem, fail, makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

/** ED-008: only a running experiment enrols identities; otherwise getExperimentFlag records nothing. */
export const ed008: Rule = {
  id: 'ED-008',
  title: 'The experiment is running',
  layer: 'config',
  node: 'flagsmith',
  rank: 20,
  run(ctx) {
    const exp = ctx.experiment;
    if (exp === undefined) return skip('The experiment was not collected.');
    if (exp === null) {
      const flag = ctx.flagKey ?? '<flag>';
      return fail([
        makeFinding(this, {
          severity: 'critical',
          title: `There is no experiment for "${flag}" in this environment`,
          detail: 'Exposures are only recorded for flags with a running experiment. Without one, getExperimentFlag behaves like a normal flag read.',
          evidence: [configItem('GET experiments/ returned no experiment for the flag', flag)],
          fix: { summary: 'Create a metric and an experiment for the flag, then start it.', command: createExperimentHint(flag), docs: DOCS.codingAgent },
          confidence: 0.9,
        }),
      ]);
    }

    switch (exp.status) {
      case 'running':
        return pass(`Experiment "${exp.name}" is running.`);
      case 'created':
        return fail([
          makeFinding(this, {
            severity: 'critical',
            title: `Experiment "${exp.name}" was created but never started`,
            detail:
              'An experiment in the "created" state is a draft: no identity is enrolled, so the SDK sees no experiment on the flag and getExperimentFlag records no exposures.',
            evidence: [configItem(`Experiment ${exp.id} status`, 'created')],
            fix: {
              summary: 'Start the experiment. This locks the flag and turns on the rollout, so it needs your approval.',
              command: startExperimentCommand(exp.id),
              docs: DOCS.codingAgent,
            },
            confidence: 0.98,
          }),
        ]);
      case 'paused':
        return fail([
          makeFinding(this, {
            severity: 'critical',
            title: `Experiment "${exp.name}" is paused`,
            detail: 'While paused, the experiment is not attached to the flag, so the SDK does not enrol identities and getExperimentFlag records no new exposures.',
            evidence: [configItem(`Experiment ${exp.id} status`, 'paused')],
            fix: { summary: 'Resume the experiment when you are ready to collect data again.', command: startExperimentCommand(exp.id, true), docs: DOCS.codingAgent },
            confidence: 0.95,
          }),
        ]);
      case 'completed':
        return fail([
          makeFinding(this, {
            severity: 'critical',
            title: `Experiment "${exp.name}" is completed and no longer collects data`,
            detail: 'A completed experiment is final. New exposures and conversions are not added to it.',
            evidence: [configItem(`Experiment ${exp.id} status`, `completed${exp.endedAt ? ` at ${exp.endedAt}` : ''}`)],
            fix: { summary: 'To keep testing, create a new experiment on the flag and start it.', command: createExperimentHint(ctx.flagKey ?? exp.featureName ?? '<flag>'), docs: DOCS.codingAgent },
            confidence: 0.9,
          }),
        ]);
      default:
        return skip(`Unknown experiment status "${exp.status}".`);
    }
  },
};
