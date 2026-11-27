import { scopeToApp } from '../scope';
import type { Evidence } from '../types';
import type { RuleContext } from './types';

export function buildContext(evidence: Evidence): RuleContext {
  const config = evidence.config ?? null;
  const rawCode = evidence.code ?? null;
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
  // Monorepos: never pair calls across apps; diagnose one app.
  const scope = rawCode ? scopeToApp(rawCode, flagKey) : null;
  const code = scope ? scope.code : null;
  const now = evidence.collectedAt ? new Date(evidence.collectedAt) : null;
  const ctx: RuleContext = { evidence, config, code, flagKey, experiment, metrics, now: now && !Number.isNaN(now.getTime()) ? now : null };
  if (scope?.app !== null && scope?.app !== undefined) ctx.app = { path: scope.app, otherApps: scope.otherApps, reason: scope.reason ?? '' };
  return ctx;
}
