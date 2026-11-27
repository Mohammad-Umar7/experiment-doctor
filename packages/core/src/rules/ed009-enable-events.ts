import { DOCS } from '../constants';
import type { InitEvidence } from '../types';
import { codeItem, fail, insertAfter, makeFinding, pass, replaceInLine, skip, where, withPatch } from './helpers';
import type { Rule } from './types';

/** ED-009: without enableEvents: true the SDK never creates its event processor. */
export const ed009: Rule = {
  id: 'ED-009',
  title: 'The SDK is initialised with enableEvents: true',
  layer: 'instrumentation',
  node: 'sdk',
  rank: 60,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');
    if (!code.inits.length) {
      const usesEvents = code.experimentFlags.length + code.trackEvents.length > 0;
      return skip(usesEvents ? 'The SDK is used, but its initialisation was not found in the scanned code.' : 'No SDK initialisation was found.');
    }
    const off = code.inits.filter((i) => i.enableEvents === null || i.enableEvents === 'false');
    const dynamic = code.inits.filter((i) => i.enableEvents !== null && i.enableEvents !== 'true' && i.enableEvents !== 'false');

    if (off.length) {
      const init = off[0]!;
      return fail([
        makeFinding(this, {
          severity: 'critical',
          title: init.enableEvents === 'false' ? 'Events are turned off: enableEvents is false' : 'enableEvents is missing, so the SDK sends no events',
          detail: `${detailFor(init)}${init.enableAnalytics ? ' Note: enableAnalytics is a different setting (flag usage analytics). It does not send experiment events.' : ''}`,
          evidence: [codeItem(`${initName(init)} without enableEvents: true`, init.loc), ...(init.enableAnalytics ? [codeItem(`enableAnalytics: ${init.enableAnalytics}`, init.loc)] : [])],
          fix: withPatch({ summary: 'Add `enableEvents: true` to the SDK options.', steps: [`In ${where(init.loc)}, add enableEvents: true next to the environment key.`], docs: DOCS.runExperiment }, patchFor(init)),
          confidence: 0.95,
        }),
      ]);
    }
    if (dynamic.length) {
      const init = dynamic[0]!;
      return fail([
        makeFinding(this, {
          severity: 'warning',
          title: 'enableEvents depends on runtime configuration',
          detail: `enableEvents is set to \`${init.enableEvents}\`. If that resolves to false in this environment, the SDK sends no exposures or conversions.`,
          evidence: [codeItem(`enableEvents: ${init.enableEvents}`, init.enableEventsLoc ?? init.loc)],
          fix: { summary: 'Make sure enableEvents resolves to true wherever the experiment runs, or set it to true.', docs: DOCS.runExperiment },
          confidence: 0.5,
        }),
      ]);
    }
    return pass(`enableEvents: true is set (${code.inits.map((i) => where(i.loc)).join(', ')}).`);
  },
};

function initName(init: InitEvidence): string {
  if (init.style === 'provider') return '<FlagsmithProvider options>';
  if (init.style === 'constructor') return 'new Flagsmith({...})';
  return 'flagsmith.init({...})';
}

function detailFor(init: InitEvidence): string {
  return init.sdk === 'node'
    ? 'The Node SDK only creates its event processor when enableEvents is true. Without it, getExperimentFlag and trackEvent throw "ValueError: enableEvents must be true".'
    : 'The JavaScript SDK only starts its event pipeline when enableEvents is true. Without it, getExperimentFlag degrades to a plain flag read (no exposure) and trackEvent does nothing, silently.';
}

function patchFor(init: InitEvidence) {
  if (init.enableEvents === 'false' && init.enableEventsLoc) {
    return replaceInLine(init.enableEventsLoc, 'false', 'true');
  }
  if (init.insertAfter) return insertAfter(init.insertAfter, ['enableEvents: true,'], init.propIndent ?? '  ');
  return null;
}
