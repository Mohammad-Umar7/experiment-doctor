import { DOCS, EVENTS_FLUSH_INTERVAL_SECONDS } from '../constants';
import type { CodeEvidence, FileRuntime, Finding, SourceLocation } from '../types';
import { codeItem, fail, insertBefore, makeFinding, pass, skip, where, withPatch } from './helpers';
import type { Rule } from './types';

interface Producer {
  loc: SourceLocation;
  sdk: 'js' | 'node';
  client?: string;
}

/** ED-005: events are buffered (~10 s) and lost when the process or page ends before a flush. */
export const ed005: Rule = {
  id: 'ED-005',
  title: 'Buffered events are flushed before exit',
  layer: 'transport',
  node: 'sdk',
  rank: 120,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip('Code was not scanned.');
    const producers: Producer[] = [
      ...code.trackEvents.map((t) => ({ loc: t.loc, sdk: t.sdk, client: t.client })),
      ...code.experimentFlags.map((c) => ({ loc: c.loc, sdk: c.sdk, client: c.client })),
      ...code.exposures.map((e) => ({ loc: e.loc, sdk: 'node' as const })),
    ];
    if (!producers.length) return skip('No code sends experiment events.');

    const runtimeOf = (file: string): FileRuntime => code.files.find((f) => f.file === file)?.runtime ?? 'unknown';
    const projectHasServer = code.files.some((f) => f.runtime === 'node-server');
    const byFile = new Map<string, Producer[]>();
    for (const p of producers) byFile.set(p.loc.file, [...(byFile.get(p.loc.file) ?? []), p]);

    const critical: Finding[] = [];
    const advisory: Finding[] = [];
    for (const [file, ps] of byFile) {
      const runtime = runtimeOf(file);
      const flushedHere = code.flushes.some((f) => f.loc.file === file);
      const client = ps.find((p) => p.client)?.client ?? code.inits.find((i) => i.loc.file === file)?.client ?? 'flagsmith';
      const isNode = ps.some((p) => p.sdk === 'node');

      if (runtime === 'node-script' && !flushedHere) critical.push(scriptFinding(this, file, ps, code, client));
      else if (runtime === 'serverless' && !flushedHere) critical.push(serverlessFinding(this, ps[0]!, client, isNode));
      else if ((runtime === 'node-server' || (isNode && projectHasServer)) && !code.flushes.some((f) => f.inExitHandler)) {
        advisory.push(serverFinding(this, ps[0]!, client));
      } else if ((runtime === 'browser' || runtime === 'react') && code.flushes.length === 0) {
        advisory.push(browserFinding(this, ps[0]!, client));
      }
    }

    if (critical.length) return fail([...critical, ...advisory]);
    const warnings = advisory.filter((f) => f.severity !== 'info');
    if (warnings.length) return fail(advisory);
    if (advisory.length) return { status: 'pass', findings: advisory, note: 'Events flush on the SDK timer; the last few seconds before a page closes can be lost.' };
    return pass(code.flushes.length ? `Events are flushed (${code.flushes.map((f) => `${f.method}() at ${where(f.loc)}`).join(', ')}).` : 'Long-lived app: the SDK flushes every 10 s.');
  },
};

function scriptFinding(rule: Rule, file: string, ps: Producer[], code: CodeEvidence, client: string): Finding {
  const exit = code.exits.find((e) => e.loc.file === file && e.kind === 'process.exit');
  const isNode = ps.some((p) => p.sdk === 'node');
  const call = isNode ? `await ${client}.close();` : `await ${client}.flushEvents();`;
  const patch = exit ? insertBefore(exit.loc, call) : null;
  return makeFinding(rule, {
    severity: 'critical',
    title: 'The script exits before buffered events are sent',
    detail: `The SDK buffers events and sends them every ${EVENTS_FLUSH_INTERVAL_SECONDS} seconds. This script ${exit ? 'calls process.exit()' : 'ends'} without ${isNode ? 'close()' : 'flushEvents()'}, so every exposure and conversion still in the buffer is dropped. Nothing reaches Flagsmith, and no error is shown.`,
    evidence: [codeItem('Events are produced here', ps[0]!.loc), ...(exit ? [codeItem('The process exits here with no flush', exit.loc)] : [])],
    fix: withPatch(
      {
        summary: `Call \`${call}\` before the script exits.`,
        steps: isNode ? ['close() sends the buffered events and stops the client (Node SDK).'] : ['flushEvents() sends the buffered events now.'],
        docs: DOCS.codingAgent,
      },
      patch,
    ),
    confidence: exit ? 0.92 : 0.8,
  });
}

function serverlessFinding(rule: Rule, p: Producer, client: string, isNode: boolean): Finding {
  return makeFinding(rule, {
    severity: 'critical',
    title: 'The function returns before buffered events are sent',
    detail: 'Serverless functions and route handlers can be frozen or stopped as soon as they respond. The SDK sends events on a timer (every 10 seconds unless flushInterval is set), so events tracked in the request are usually lost.',
    evidence: [codeItem('Events are produced in a request handler with no flush', p.loc)],
    fix: {
      summary: `Await \`${client}.flushEvents()\` before returning the response.`,
      steps: [`In ${p.loc.file}, add \`await ${client}.flushEvents();\` right before the handler returns.${isNode ? ' (Node SDK: flushEvents() keeps the client usable; close() would stop it.)' : ''}`],
      docs: DOCS.runExperiment,
    },
    confidence: 0.8,
  });
}

function serverFinding(rule: Rule, p: Producer, client: string): Finding {
  return makeFinding(rule, {
    severity: 'warning',
    title: 'Events buffered at shutdown are lost',
    detail: 'A long-running server flushes on a timer (every 10 seconds unless flushInterval is set), but a deploy or restart drops whatever is still buffered. Close the client on SIGTERM so the last batch is sent.',
    evidence: [codeItem('Events are produced by a server process with no shutdown flush', p.loc)],
    fix: {
      summary: `Call \`await ${client}.close()\` in a SIGTERM handler.`,
      steps: [`process.on('SIGTERM', async () => { await ${client}.close(); process.exit(0); });`],
      docs: DOCS.runExperiment,
    },
    confidence: 0.6,
  });
}

function browserFinding(rule: Rule, p: Producer, client: string): Finding {
  return makeFinding(rule, {
    severity: 'info',
    title: 'Events tracked just before the page closes can be lost',
    detail: 'The browser SDK sends events on a timer (every 10 seconds unless flushInterval is set). A conversion tracked right before navigation (for example a redirect to a payment page) may never be sent. Flush on pagehide to keep it.',
    evidence: [codeItem('Events are produced in the browser; no flushEvents() found', p.loc)],
    fix: {
      summary: `Flush on pagehide: \`window.addEventListener('pagehide', () => ${client}.flushEvents())\`.`,
      docs: DOCS.runExperiment,
    },
    confidence: 0.5,
  });
}
