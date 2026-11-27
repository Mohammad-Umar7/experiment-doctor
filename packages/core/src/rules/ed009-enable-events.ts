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
    // Options built elsewhere (a spread, a helper, a variable): enableEvents is unknown, not missing.
    const unknown = code.inits.filter((i) => i.opaque && i.enableEvents === null);
    const visible = code.inits.filter((i) => !unknown.includes(i));
    const off = visible.filter((i) => i.enableEvents === null || i.enableEvents === 'false');
    const dynamic = visible.filter((i) => i.enableEvents !== null && i.enableEvents !== 'true' && i.enableEvents !== 'false');

    // Only blame an init that plausibly serves the experiment calls: same file, the only init,
    // or imported by a file with experiment calls. If every init lacks enableEvents, all are to blame.
    const expFiles = [...new Set([...code.experimentFlags, ...code.trackEvents, ...code.exposures].map((x) => x.loc.file))];
    const stem = (p: string) => p.replace(/\.(?:[mc]?[jt]sx?)$/i, '');
    const importedBy = (initFile: string, file: string) =>
      (code.files.find((f) => f.file === file)?.imports ?? []).some((imp) => imp === stem(initFile) || `${imp}/index` === stem(initFile));
    const serves = (i: InitEvidence) => expFiles.length === 0 || code.inits.length === 1 || expFiles.includes(i.loc.file) || expFiles.some((f) => importedBy(i.loc.file, f));
    const everyInitOff = unknown.length === 0 && off.length === visible.length;
    const blamed = off.filter((i) => everyInitOff || serves(i));
    const excused = off.filter((i) => !blamed.includes(i));

    if (blamed.length) {
      const init = blamed[0]!;
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
    const notes: string[] = [];
    if (unknown.length) notes.push(`The SDK options at ${unknown.map((i) => where(i.loc)).join(', ')} are built elsewhere (a spread or a helper), so enableEvents cannot be read: unknown, not missing.`);
    if (dynamic.length) notes.push(`enableEvents is computed at runtime (\`${dynamic[0]!.enableEvents}\` at ${where(dynamic[0]!.enableEventsLoc ?? dynamic[0]!.loc)}); make sure it is true where the experiment runs.`);
    if (notes.length) return skip(notes.join(' '));
    const on = visible.filter((i) => i.enableEvents === 'true');
    if (excused.length) {
      return pass(
        `enableEvents: true is set where the experiment runs (${on.map((i) => where(i.loc)).join(', ')}). ${excused.map((i) => where(i.loc)).join(', ')} has no enableEvents, but no experiment call uses that init, so it is not a defect.`,
      );
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
