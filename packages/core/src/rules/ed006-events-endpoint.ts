import { DEFAULT_EVENTS_API_URL, DOCS } from '../constants';
import type { Finding, InitEvidence } from '../types';
import { eventsEndpoint, hostOf, isCloudUrl, isDefaultEventsUrl, originOf, selfHostedEventsUrl, stringLiteral } from '../util/urls';
import { codeItem, configItem, fail, insertAfter, makeFinding, pass, replaceInLine, skip, withPatch } from './helpers';
import type { Rule, RuleContext } from './types';

const INGESTION_PLACEHOLDER = 'https://<your-events-host>/';

/** ED-006: flags from one Flagsmith, events to another (usually self-hosted API + Cloud events). */
export const ed006: Rule = {
  id: 'ED-006',
  title: 'Events go to the same Flagsmith as the flags',
  layer: 'transport',
  node: 'sdk',
  rank: 110,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');
    if (!code.inits.length) return skip('No SDK initialisation was found in the scanned code.');

    const findings: Finding[] = [];
    const notes: string[] = [];
    for (const init of code.inits) {
      const f = check(this, ctx, init, notes);
      if (f) findings.push(f);
    }
    if (findings.length) return fail(findings);
    if (notes.length) return skip(notes.join(' '));
    return pass('Flags and events point at the same Flagsmith.');
  },
};

function check(rule: Rule, ctx: RuleContext, init: InitEvidence, notes: string[]): Finding | null {
  const env = ctx.config?.environment;
  const warehouses = ctx.config?.warehouses;
  const usesFlagsmithDb = warehouses ? warehouses.some((w) => w.flagsmithDatabase) : undefined;
  const apiLit = stringLiteral(init.apiUrl);
  const eventsLit = stringLiteral(init.eventsApiUrl);
  const apiOpt = init.sdk === 'node' ? 'apiUrl' : 'api';
  const indent = init.propIndent ?? '  ';

  // Options built elsewhere: an unset api or eventsApiUrl here may be set by the spread or helper.
  if (init.opaque && (init.apiUrl === null || init.eventsApiUrl === null)) {
    notes.push(`The SDK options at ${init.loc.file}:${init.loc.line} are built elsewhere (a spread or a helper), so ${apiOpt} and eventsApiUrl cannot be checked statically.`);
    return null;
  }

  // 1. The app points flags at a self-hosted Flagsmith.
  if (apiLit && !isCloudUrl(apiLit)) {
    const expected = usesFlagsmithDb === false ? null : selfHostedEventsUrl(apiLit);
    const target = expected ?? INGESTION_PLACEHOLDER;
    if (init.eventsApiUrl === null) {
      const patch = !init.hasEventProcessorConfig && init.apiUrlLoc ? insertAfter(init.apiUrlLoc, [`eventProcessorConfig: { eventsApiUrl: '${target}' },`], indent, !expected) : null;
      return makeFinding(rule, {
        severity: 'critical',
        title: `Flags come from ${hostOf(apiLit)} but events go to Flagsmith Cloud`,
        detail: `The SDK reads flags from your self-hosted API, but no events URL is set, so exposures and conversions are posted to ${DEFAULT_EVENTS_API_URL}. Flagsmith Cloud does not know this environment key, so every event is dropped.`,
        evidence: [codeItem(`${apiOpt}: ${apiLit}`, init.apiUrlLoc ?? init.loc), codeItem('No eventProcessorConfig.eventsApiUrl', init.loc, eventsEndpoint(null))],
        fix: withPatch(
          {
            summary: `Set \`eventProcessorConfig.eventsApiUrl\` to ${expected ? `'${expected}'` : 'your event ingestion URL'}.`,
            steps: expected
              ? ['With the Flagsmith database as the warehouse, the events URL is your API URL ending in /api/ (the SDK appends v1/events).']
              : ['Your warehouse is not the Flagsmith database, so use the URL of your event ingestion service.'],
            docs: DOCS.codingAgent,
          },
          patch,
        ),
        confidence: 0.92,
      });
    }
    if (eventsLit && isDefaultEventsUrl(eventsLit)) {
      const patch = init.eventsApiUrlLoc ? replaceInLine(init.eventsApiUrlLoc, eventsLit, target) : null;
      return makeFinding(rule, {
        severity: 'critical',
        title: `Flags come from ${hostOf(apiLit)} but events are sent to Flagsmith Cloud`,
        detail: 'eventsApiUrl is the Cloud events host while flags come from your own Flagsmith. Cloud rejects events for environments it does not have.',
        evidence: [codeItem(`${apiOpt}: ${apiLit}`, init.apiUrlLoc ?? init.loc), codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc)],
        fix: withPatch({ summary: `Point eventsApiUrl at ${target}.`, docs: DOCS.codingAgent }, patch),
        confidence: 0.95,
      });
    }
    if (eventsLit && /\/api\/v1\/?$/.test(eventsLit)) {
      const fixed = selfHostedEventsUrl(eventsLit) ?? target;
      const patch = init.eventsApiUrlLoc ? replaceInLine(init.eventsApiUrlLoc, eventsLit, fixed) : null;
      return makeFinding(rule, {
        severity: 'critical',
        title: 'eventsApiUrl ends in /api/v1/, so events go to /api/v1/v1/events',
        detail: `The SDK appends v1/events to eventsApiUrl, so this posts to ${eventsEndpoint(eventsLit)}, which does not exist. The events URL must end in /api/.`,
        evidence: [codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc, eventsEndpoint(eventsLit))],
        fix: withPatch({ summary: `Use '${fixed}' as eventsApiUrl.`, docs: DOCS.codingAgent }, patch),
        confidence: 0.95,
      });
    }
    if (eventsLit && usesFlagsmithDb && originOf(eventsLit) !== originOf(apiLit)) {
      return makeFinding(rule, {
        severity: 'warning',
        title: 'Events go to a different host than the flags',
        detail: `This environment stores events in the Flagsmith database, so events must go to your Flagsmith API (${expected}), but eventsApiUrl points at ${hostOf(eventsLit)}.`,
        evidence: [codeItem(`${apiOpt}: ${apiLit}`, init.apiUrlLoc ?? init.loc), codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc)],
        fix: withPatch({ summary: `Use '${expected}' as eventsApiUrl.`, docs: DOCS.codingAgent }, init.eventsApiUrlLoc && expected ? replaceInLine(init.eventsApiUrlLoc, eventsLit, expected) : null),
        confidence: 0.75,
      });
    }
    return null;
  }

  // 2. Flagsmith says the experiment lives on a self-hosted instance, but the app talks to Cloud.
  if (env?.selfHosted && env.apiUrl && init.apiUrl === null) {
    const origin = originOf(env.apiUrl) ?? env.apiUrl;
    const lines = [`${apiOpt}: '${origin}/api/v1/',`, `eventProcessorConfig: { eventsApiUrl: '${origin}/api/' },`];
    const patch = !init.hasEventProcessorConfig && init.insertAfter ? insertAfter(init.insertAfter, lines, indent) : null;
    return makeFinding(rule, {
      severity: 'critical',
      title: `The experiment lives on ${hostOf(origin)} but the app talks to Flagsmith Cloud`,
      detail: `flagsmith.json points at a self-hosted Flagsmith (${origin}), but the SDK sets no ${apiOpt} and no events URL, so it reads flags from and sends events to Flagsmith Cloud.`,
      evidence: [configItem('Flagsmith CLI API URL', origin), codeItem(`No ${apiOpt} and no eventsApiUrl`, init.loc)],
      fix: withPatch({ summary: `Set ${apiOpt} and eventProcessorConfig.eventsApiUrl to your Flagsmith.`, docs: DOCS.codingAgent }, patch),
      confidence: 0.85,
    });
  }

  // 3. Flags from Cloud, events to somewhere else.
  if ((init.apiUrl === null || (apiLit && isCloudUrl(apiLit))) && eventsLit && !isCloudUrl(eventsLit)) {
    return makeFinding(rule, {
      severity: 'critical',
      title: `Flags come from Flagsmith Cloud but events go to ${hostOf(eventsLit)}`,
      detail: `No self-hosted ${apiOpt} is set, so flags come from Flagsmith Cloud, yet events are posted to ${eventsEndpoint(eventsLit)}. Exposures never reach the environment the flags came from.`,
      evidence: [codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc)],
      fix: {
        summary: env?.selfHosted === false || !env ? 'On Flagsmith Cloud, remove eventsApiUrl (the SDK default is correct).' : `Set ${apiOpt} to your self-hosted API as well.`,
        steps: [`If you self-host, also set ${apiOpt} to your Flagsmith API URL.`],
        docs: DOCS.codingAgent,
      },
      confidence: 0.7,
    });
  }

  // 4. The API URL is computed at runtime.
  if (init.apiUrl !== null && apiLit === null) {
    if (init.eventsApiUrl === null && env?.selfHosted && env.apiUrl) {
      const expected = `${originOf(env.apiUrl) ?? env.apiUrl}/api/`;
      return makeFinding(rule, {
        severity: 'warning',
        title: 'The API URL is configurable but no events URL is set',
        detail: `${apiOpt} comes from runtime config and flagsmith.json points at a self-hosted Flagsmith, but no eventsApiUrl is set, so events still go to Flagsmith Cloud.`,
        evidence: [codeItem(`${apiOpt}: ${init.apiUrl}`, init.apiUrlLoc ?? init.loc), configItem('Flagsmith CLI API URL', env.apiUrl)],
        fix: withPatch(
          { summary: `Set eventProcessorConfig.eventsApiUrl to '${expected}' (or derive it from the same setting).`, docs: DOCS.codingAgent },
          !init.hasEventProcessorConfig && init.apiUrlLoc ? insertAfter(init.apiUrlLoc, [`eventProcessorConfig: { eventsApiUrl: '${expected}' },`], indent) : null,
        ),
        confidence: 0.6,
      });
    }
    notes.push(`${apiOpt} is set at runtime (${init.apiUrl}), so the endpoints cannot be checked statically.`);
  }
  return null;
}
