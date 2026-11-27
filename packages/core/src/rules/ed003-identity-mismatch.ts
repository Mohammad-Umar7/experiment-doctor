import { DOCS } from '../constants';
import type { Finding, IdentifyEvidence, TrackEventEvidence } from '../types';
import { identityKind, retargetExpr, sameIdentity } from '../util/strings';
import { codeItem, fail, makeFinding, pass, replaceInLine, skip, where, withPatch } from './helpers';
import type { Rule } from './types';

const EXPOSURE_VIA = new Set<IdentifyEvidence['via']>(['getExperimentFlag', 'trackExposureEvent', 'identify', 'init-identity', 'getIdentityFlags']);

/** ED-003: exposures and conversions are joined per identity, so both must use the same identifier. */
export const ed003: Rule = {
  id: 'ED-003',
  title: 'Exposures and conversions use the same identity',
  layer: 'identity',
  node: 'app',
  rank: 100,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');
    const conversions = code.trackEvents;
    if (!conversions.length) return skip('No trackEvent call was found.');
    const exposureIds = code.identifies.filter((i) => EXPOSURE_VIA.has(i.via));
    if (!exposureIds.length) return skip('No identity is set for exposures (see ED-002).');

    // The identity the experiment flag is read with is the reference.
    const ref = pickReference(exposureIds, code.experimentFlags.map((c) => c.loc.file));
    const findings: Finding[] = [];

    // Node conversions must carry an identifier.
    const anonymous = conversions.filter((t) => t.sdk === 'node' && !t.identifierExpr);
    if (anonymous.length) {
      const t = anonymous[0]!;
      const patch = t.raw ? replaceInLine(t.loc, `trackEvent(${t.raw})`, `trackEvent(${t.raw}, { identifier: ${ref.raw} })`) : null;
      findings.push(
        makeFinding(this, {
          severity: 'critical',
          title: 'Conversion events are sent without an identifier',
          detail:
            'In the Node SDK, trackEvent does not know who the user is unless you pass `{ identifier }`. These conversions are stored with no identity, so they can never be joined to an exposure and the metric stays at zero.',
          evidence: [...anonymous.slice(0, 3).map((a) => codeItem(`trackEvent(${a.raw}) with no identifier`, a.loc)), codeItem(`Exposure identity: ${ref.expr}`, ref.loc)],
          fix: withPatch({ summary: `Pass the same identifier used for the flag: \`{ identifier: ${ref.raw} }\`.`, docs: DOCS.runExperiment }, patch),
          confidence: 0.93,
        }),
      );
    }

    // Explicit identifiers that differ from the exposure identity.
    const mismatched = conversions.filter((t) => t.identifierExpr && !exposureIds.some((e) => sameIdentity(e.expr, t.identifierExpr!)));
    if (mismatched.length) {
      const t = mismatched[0]!;
      findings.push(mismatchFinding(this, t, ref));
    }

    // JS: re-identifying with a different kind of id moves later conversions to another identity.
    if (!findings.length) {
      const jsIds = exposureIds.filter((i) => i.sdk === 'js' && (i.via === 'identify' || i.via === 'init-identity'));
      const other = jsIds.find((i) => !sameIdentity(i.expr, ref.expr));
      if (other) {
        const jsConversions = conversions.filter((t) => t.sdk === 'js' && !t.identifierExpr);
        const target = retargetExpr(other.raw, ref.raw);
        const patch = replaceInLine(other.loc, `identify(${other.raw}`, `identify(${target}`);
        findings.push(
          makeFinding(this, {
            severity: 'critical',
            title: `The user is identified as ${describe(ref.expr)} for the flag and as ${describe(other.expr)} later`,
            detail: `Flagsmith joins exposures and conversions per identity. The experiment flag is read for \`${ref.expr}\`, but the app later calls identify(${other.raw}), so conversions${jsConversions.length ? ' tracked after that' : ''} belong to a different identity that was never exposed. They are not counted.`,
            evidence: [codeItem(`Identity used for the experiment flag: ${ref.expr}`, ref.loc), codeItem(`Different identity: ${other.expr}`, other.loc), ...jsConversions.slice(0, 2).map((c) => codeItem(`Conversion trackEvent(${c.raw})`, c.loc))],
            fix: withPatch(
              {
                summary: `Identify with the same id everywhere: use \`${target}\` instead of \`${other.raw}\`.`,
                steps: ['If you need the email too, send it as a trait, not as the identity.'],
                docs: DOCS.codingAgent,
              },
              patch,
            ),
            confidence: 0.85,
          }),
        );
      }
    }

    if (findings.length) return fail(findings);
    return pass(`Exposures and conversions both use ${ref.expr}.`);
  },
};

function pickReference(ids: IdentifyEvidence[], flagFiles: string[]): IdentifyEvidence {
  const score = (i: IdentifyEvidence) =>
    (i.via === 'getExperimentFlag' ? 4 : 0) + (flagFiles.includes(i.loc.file) ? 2 : 0) + (i.via === 'identify' || i.via === 'init-identity' ? 1 : 0);
  return [...ids].sort((a, b) => score(b) - score(a) || a.loc.file.localeCompare(b.loc.file) || a.loc.line - b.loc.line)[0]!;
}

function describe(expr: string): string {
  const kind = identityKind(expr);
  return kind === 'other' ? `\`${expr}\`` : `${kind === 'id' ? 'an id' : `an ${kind}`} (\`${expr}\`)`;
}

function mismatchFinding(rule: Rule, t: TrackEventEvidence, ref: IdentifyEvidence): Finding {
  const raw = t.identifierRaw ?? t.identifierExpr!;
  const target = retargetExpr(raw, ref.raw);
  const patch = replaceInLine(t.loc, raw, target);
  return makeFinding(rule, {
    severity: 'critical',
    title: `Exposures use ${describe(ref.expr)} but conversions use ${describe(t.identifierExpr!)}`,
    detail:
      'Flagsmith counts a conversion only for an identity that was exposed first. The flag is read for one identifier and the conversion is sent for another, so every conversion lands on an identity with no exposure and the metric stays empty.',
    evidence: [codeItem(`Exposure identity: ${ref.expr}`, ref.loc), codeItem(`Conversion identity: ${t.identifierExpr}`, t.loc)],
    fix: withPatch(
      {
        summary: `Send the conversion for the same identity: \`identifier: ${target}\`.`,
        steps: [`At ${where(t.loc)}, use ${target} as the identifier.`, 'Send other user details as traits.'],
        docs: DOCS.codingAgent,
      },
      patch,
    ),
    confidence: 0.9,
  });
}
