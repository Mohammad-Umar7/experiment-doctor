import type { Evidence } from '../types';
import type { RuleContext } from './types';

export function buildContext(evidence: Evidence): RuleContext {
  const config = evidence.config ?? null;
  const code = evidence.code ?? null;
  const experiment = config ? config.experiment : undefined;
  const flagKey = config?.flag?.name ?? experiment?.featureName ?? evidence.target?.flag ?? null;
  let metrics = config?.metrics;
  if (metrics && experiment) {
    // Only metrics attached to the experiment matter.
    if (experiment.metricIds.length === 0) metrics = [];
    else {
      const attached = metrics.filter((m) => experiment.metricIds.includes(m.id));
      if (attached.length) metrics = attached;
    }
  }
  const now = evidence.collectedAt ? new Date(evidence.collectedAt) : null;
  return { evidence, config, code, flagKey, experiment, metrics, now: now && !Number.isNaN(now.getTime()) ? now : null };
}
