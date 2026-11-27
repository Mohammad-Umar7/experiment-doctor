import { DOCS } from '../constants';
import { variantKeyCommand } from '../flagsmith/commands';
import { slugify } from '../util/strings';
import { configItem, fail, makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

/** ED-001: a variation without a key (label) records no exposures. */
export const ed001: Rule = {
  id: 'ED-001',
  title: 'Every variation has a key',
  layer: 'config',
  node: 'flagsmith',
  rank: 30,
  run(ctx) {
    const flag = ctx.config?.flag;
    if (flag === undefined) return skip('Flag variations were not collected.');
    if (flag === null) return skip('The flag was not found in Flagsmith.');
    if (flag.variants.length === 0) return skip(`Flag "${flag.name}" has no variations.`);

    const missing = flag.variants.filter((v) => !v.key || !v.key.trim());
    if (missing.length === 0) return pass(`All ${flag.variants.length} variations of "${flag.name}" have keys.`);

    const used = new Set(flag.variants.map((v) => v.key).filter(Boolean));
    const keys = missing.map((v) => {
      let key = slugify(v.value);
      let n = 2;
      while (used.has(key)) key = `${slugify(v.value)}_${n++}`;
      used.add(key);
      return { id: v.id, key, value: v.value };
    });
    const running = ctx.experiment?.status === 'running';
    const steps = [
      ...keys.map((k) => `Give variation ${k.id} (value ${JSON.stringify(k.value)}) the key "${k.key}".`),
      'Re-run `experiment-doctor verify` to confirm.',
    ];
    if (running) {
      steps.unshift('The flag is locked while the experiment runs: complete this experiment, add the keys, then create and start a new one.');
    }
    return fail([
      makeFinding(this, {
        severity: 'critical',
        title: missing.length === 1 ? 'A variation has no key, so its exposures are not counted' : `${missing.length} variations have no key, so their exposures are not counted`,
        detail:
          'Flagsmith joins exposures to a variation by its key. Variations created through the API without a `key` are unlabelled, and their exposures are dropped from the results, so that arm looks empty no matter how much traffic it gets.',
        evidence: missing.map((v) => configItem(`Variation ${v.id} of "${flag.name}" has no key`, JSON.stringify(v.value))),
        fix: {
          summary: `Add a key to ${missing.length === 1 ? 'the variation' : 'each unlabelled variation'} of "${flag.name}".`,
          steps,
          command: variantKeyCommand(flag.name, keys),
          docs: DOCS.runExperiment,
        },
        confidence: 0.97,
      }),
    ]);
  },
};
