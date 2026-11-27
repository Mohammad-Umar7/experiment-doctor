import { DOCS } from '../constants';
import type { ExperimentFlagCallEvidence, Finding, IdentifyEvidence, InitEvidence } from '../types';
import { codeItem, fail, insertAfter, insertBefore, makeFinding, pass, replaceInLine, skip, where, withPatch } from './helpers';
import type { Rule } from './types';

const PLACEHOLDER_ID = 'user.id';

/** ED-002: getExperimentFlag without an identified user records no exposure. */
export const ed002: Rule = {
  id: 'ED-002',
  title: 'The user is identified before the experiment flag is read',
  layer: 'identity',
  node: 'app',
  rank: 90,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');
    let calls = code.experimentFlags;
    if (ctx.flagKey) {
      const forFlag = calls.filter((c) => c.flag === ctx.flagKey || c.flag === null);
      if (forFlag.length) calls = forFlag;
    }
    if (!calls.length) return skip('No getExperimentFlag or useExperiment call was found.');

    const findings: Finding[] = [];
    let unknownIdentity: string | null = null;

    // Node: the identifier is an argument.
    for (const c of calls.filter((x) => x.sdk === 'node' && !x.identifierExpr)) {
      findings.push(
        makeFinding(this, {
          severity: 'critical',
          title: 'getExperimentFlag is called without an identifier',
          detail: 'The Node SDK needs the identity as the second argument: `getExperimentFlag(flag, identifier)`. Without it there is no identity to enrol, so no exposure is recorded.',
          evidence: [codeItem('Experiment flag read with no identifier', c.loc)],
          fix: { summary: 'Pass the user id as the second argument.', steps: [`At ${where(c.loc)}, call getExperimentFlag('${c.flag ?? 'flag'}', user.id).`], docs: DOCS.runExperiment },
          confidence: 0.9,
        }),
      );
    }

    const jsCalls = calls.filter((c) => c.sdk === 'js');
    if (jsCalls.length) {
      const ids = code.identifies.filter((i) => i.sdk === 'js' && (i.via === 'identify' || i.via === 'init-identity'));
      const opaque = code.inits.find((i) => i.sdk === 'js' && i.opaque);
      if (ids.length === 0 && opaque) {
        unknownIdentity = `The SDK options at ${where(opaque.loc)} are built elsewhere, so an identity may be set there: unknown, not missing.`;
      } else if (ids.length === 0) {
        findings.push(neverIdentifies(this, jsCalls[0]!, code.inits.find((i) => i.style === 'provider' && i.insertAfter)));
      } else {
        const ordering = orderingProblem(this, jsCalls, ids);
        if (ordering) findings.push(ordering);
      }
    }

    if (findings.length) return fail(findings);
    if (unknownIdentity) return skip(unknownIdentity);
    return pass(`${calls.length === 1 ? 'The experiment flag is' : 'Experiment flags are'} read after the user is identified (static check).`);
  },
};

function neverIdentifies(rule: Rule, call: ExperimentFlagCallEvidence, provider?: InitEvidence): Finding {
  const isHook = call.method === 'useExperiment';
  const client = call.client ?? 'flagsmith';
  let patch = null;
  if (isHook && provider?.insertAfter) patch = insertAfter(provider.insertAfter, [`identity: ${PLACEHOLDER_ID},`], provider.propIndent ?? '  ', true);
  else if (!isHook) patch = insertBefore(call.loc, `await ${client}.identify(${PLACEHOLDER_ID});`, true);
  return makeFinding(rule, {
    severity: 'critical',
    title: 'The app never identifies the user, so no exposure is recorded',
    detail: `${isHook ? 'useExperiment' : 'getExperimentFlag'} only records an exposure for an identified user who is enrolled in the experiment. This app never calls identify() and sets no identity option, so every read is anonymous and the Exposures panel stays empty.`,
    evidence: [codeItem(`${isHook ? 'useExperiment' : 'getExperimentFlag'}('${call.flag ?? '?'}') with no identify() anywhere in the scanned code`, call.loc)],
    fix: withPatch(
      {
        summary: isHook ? 'Pass the signed-in user as the `identity` option of FlagsmithProvider.' : `Call \`await ${client}.identify(<user id>)\` before reading the experiment flag.`,
        steps: [
          `Replace ${PLACEHOLDER_ID} with the stable id of the signed-in user. Use the same id later for trackEvent.`,
          'Identify before the flag is read, and await it so the identity\'s flags (with experiment enrolment) are loaded.',
        ],
        docs: DOCS.runExperiment,
      },
      patch,
    ),
    confidence: 0.92,
  });
}

function orderingProblem(rule: Rule, calls: ExperimentFlagCallEvidence[], ids: IdentifyEvidence[]): Finding | null {
  for (const call of calls) {
    if (call.method !== 'getExperimentFlag') continue;
    const sameFile = ids.filter((i) => i.loc.file === call.loc.file);
    const otherFiles = ids.filter((i) => i.loc.file !== call.loc.file);
    const before = sameFile.filter((i) => i.loc.line <= call.loc.line);
    const after = sameFile.filter((i) => i.loc.line > call.loc.line);

    if (!before.length && after.length && !otherFiles.length) {
      const late = after[0]!;
      const patch = late.loc.text !== undefined ? insertBefore(call.loc, `await ${call.client ?? 'flagsmith'}.identify(${late.raw});`) : null;
      return makeFinding(rule, {
        severity: 'critical',
        title: 'identify() runs after getExperimentFlag, so the first read is anonymous',
        detail: 'getExperimentFlag records the exposure at the moment it is called. Here the user is identified only afterwards, so that read has no identity and no exposure is recorded.',
        evidence: [codeItem('Experiment flag read', call.loc), codeItem('identify() comes later', late.loc)],
        fix: withPatch({ summary: 'Identify the user before reading the experiment flag.', docs: DOCS.runExperiment }, patch),
        confidence: 0.8,
      });
    }

    const nearest = before.filter((i) => i.via === 'identify').sort((a, b) => b.loc.line - a.loc.line)[0];
    if (nearest && !nearest.awaited && call.loc.line - nearest.loc.line <= 12) {
      const client = call.client ?? 'flagsmith';
      const patch = replaceInLine(nearest.loc, `${client}.identify(`, `await ${client}.identify(`);
      return makeFinding(rule, {
        severity: 'warning',
        title: 'identify() is not awaited before getExperimentFlag',
        detail:
          'identify() fetches the identity\'s flags, including whether the user is enrolled in the experiment. Reading the flag before that request finishes evaluates the anonymous environment flags, so getExperimentFlag skips the exposure.',
        evidence: [codeItem('identify() without await', nearest.loc), codeItem('Experiment flag read right after', call.loc)],
        fix: withPatch({ summary: 'Await identify() before reading the experiment flag.', docs: DOCS.runExperiment }, patch),
        confidence: 0.7,
      });
    }
  }
  return null;
}
