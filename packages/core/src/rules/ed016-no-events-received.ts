import { DOCS } from '../constants';
import { configItem, makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

const GRACE_MINUTES = 15;

/** ED-016: the experiment is running but the warehouse has received no event at all. Pending, not broken: it may be no traffic. */
export const ed016: Rule = {
  id: 'ED-016',
  title: 'The warehouse is receiving events',
  layer: 'ingestion',
  node: 'warehouse',
  rank: 130,
  optional: true,
  run(ctx) {
    const exp = ctx.experiment;
    const w = ctx.config?.warehouses?.find((x) => x.status === 'connected');
    if (!exp || exp.status !== 'running') return skip('The experiment is not running.');
    if (!w) return skip('No connected warehouse.');
    if (w.totalEventsReceived === undefined || w.totalEventsReceived === null) return skip('This warehouse does not report event counts.');
    if (w.totalEventsReceived > 0) return pass(`${w.totalEventsReceived} events received${w.lastEventAt ? `, last at ${w.lastEventAt}` : ''}.`);
    const started = exp.startedAt ? new Date(exp.startedAt) : null;
    const minutes = started && ctx.now ? (ctx.now.getTime() - started.getTime()) / 60000 : null;
    if (minutes !== null && minutes < GRACE_MINUTES) return skip(`The experiment started ${Math.round(minutes)} minutes ago; events may still be on their way.`);
    // Zero events alone is not proof of a defect: there may be no traffic yet.
    return {
      status: 'pending',
      findings: [
        makeFinding(this, {
          kind: 'pending',
          severity: 'info',
          title: 'No events have reached the warehouse yet',
          detail: `The warehouse reports 0 events received${minutes !== null ? ` ${Math.round(minutes / 60)} hours after the experiment started` : ''}. That can simply mean no traffic yet, or that something between the app and Flagsmith drops every event. Scan the app code (--dir) to check the wiring.`,
          evidence: [configItem(`Warehouse ${w.id} total_events_received`, '0')],
          fix: {
            summary: 'Run `experiment-doctor check --dir <your app>` so the code checks can confirm the wiring, then send real or test traffic.',
            docs: DOCS.runExperiment,
          },
          confidence: 0.5,
        }),
      ],
    };
  },
};
