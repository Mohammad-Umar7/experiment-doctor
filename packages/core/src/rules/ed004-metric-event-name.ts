import { DOCS } from '../constants';
import type { Finding, MetricEvidence, TrackEventEvidence } from '../types';
import { compareNames, type NameMatch } from '../util/strings';
import { stringLiteral } from '../util/urls';
import { codeItem, configItem, fail, makeFinding, pass, quoteLike, replaceInLine, skip, where, withPatch } from './helpers';
import type { Rule } from './types';

const ORDER: NameMatch[] = ['case', 'format', 'typo'];
const HOW: Record<string, string> = {
  case: 'differs only in letter case',
  format: 'uses a different word format',
  typo: 'is misspelled',
};

/** ED-004: trackEvent names must equal the metric's event name exactly (case-sensitive). */
export const ed004: Rule = {
  id: 'ED-004',
  title: 'Tracked event names match the experiment metrics',
  layer: 'instrumentation',
  node: 'app',
  rank: 80,
  run(ctx) {
    const metrics = ctx.metrics;
    if (metrics === undefined) return skip('Experiment metrics were not collected.');
    if (metrics.length === 0) return skip('The experiment has no metrics (see ED-013).');
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');

    const literal = code.trackEvents.filter((t) => t.event !== null);
    const dynamic = code.trackEvents.filter((t) => t.event === null);
    const findings: Finding[] = [];
    let unresolved = 0;

    for (const metric of metrics) {
      if (literal.some((t) => t.event === metric.event)) continue;
      const near = literal
        .map((t) => ({ t, how: compareNames(metric.event, t.event!) }))
        .filter((x) => x.how !== 'none' && x.how !== 'exact')
        .sort((a, b) => ORDER.indexOf(a.how) - ORDER.indexOf(b.how));
      if (near.length) {
        findings.push(nearMiss(this, metric, near[0]!.t, near[0]!.how));
      } else if (dynamic.length) {
        unresolved++;
      } else {
        findings.push(neverSent(this, metric, literal));
      }
    }

    if (findings.length) return fail(findings);
    if (unresolved) {
      return skip(`${unresolved} metric event name(s) could not be matched: trackEvent is called with names computed at runtime (${dynamic.map((d) => where(d.loc)).join(', ')}).`);
    }
    return pass(`Every metric event (${metrics.map((m) => `"${m.event}"`).join(', ')}) is tracked with the exact name.`);
  },
};

function nearMiss(rule: Rule, metric: MetricEvidence, t: TrackEventEvidence, how: NameMatch): Finding {
  const isLiteral = stringLiteral(t.raw) !== null;
  const patch = isLiteral ? replaceInLine(t.loc, t.raw, quoteLike(t.raw, metric.event)) : null;
  return makeFinding(rule, {
    severity: 'critical',
    title: `The app sends "${t.event}" but the metric counts "${metric.event}"`,
    detail: `Event names are case-sensitive and must equal the metric's event name exactly. "${t.event}" ${HOW[how]}, so Flagsmith silently ignores every one of these conversions and "${metric.name}" stays at zero.`,
    evidence: [codeItem(`trackEvent sends "${t.event}"`, t.loc), configItem(`Metric "${metric.name}" counts the event`, metric.event)],
    fix: withPatch(
      {
        summary: `Track the exact event name "${metric.event}".`,
        steps: isLiteral
          ? [`At ${where(t.loc)}, change ${t.raw} to ${quoteLike(t.raw, metric.event)}.`]
          : [`${t.raw} resolves to "${t.event}". Change that constant to "${metric.event}".`],
        docs: DOCS.runExperiment,
      },
      patch,
    ),
    confidence: how === 'case' ? 0.97 : how === 'format' ? 0.9 : 0.8,
  });
}

function neverSent(rule: Rule, metric: MetricEvidence, literal: TrackEventEvidence[]): Finding {
  const sent = [...new Set(literal.map((t) => t.event!))];
  return makeFinding(rule, {
    severity: 'critical',
    title: `No code sends the metric event "${metric.event}"`,
    detail: sent.length
      ? `The metric "${metric.name}" counts "${metric.event}", but the scanned code only tracks ${sent.map((s) => `"${s}"`).join(', ')}. Unmatched events are ignored, so the metric stays at zero.`
      : `The metric "${metric.name}" counts "${metric.event}", but the scanned code never calls trackEvent. If conversions are sent from another service, scan that code too.`,
    evidence: [configItem(`Metric "${metric.name}" counts`, metric.event), ...literal.slice(0, 3).map((t) => codeItem(`trackEvent sends "${t.event}"`, t.loc))],
    fix: {
      summary: `Call trackEvent('${metric.event}') where the conversion happens.`,
      steps: ['Track it for the same identity that saw the flag.', 'Or point the metric at an event you already send.'],
      docs: DOCS.runExperiment,
    },
    confidence: sent.length ? 0.75 : 0.65,
  });
}
