import { DOCS } from '../constants';
import { connectFlagsmithDatabaseCommand, listWarehousesCommand } from '../flagsmith/commands';
import { configItem, fail, makeFinding, pass, skip } from './helpers';
import type { Rule } from './types';

/** ED-007: without a connected warehouse the ingestion service rejects every event. */
export const ed007: Rule = {
  id: 'ED-007',
  title: 'The environment has a connected warehouse',
  layer: 'ingestion',
  node: 'warehouse',
  rank: 10,
  run(ctx) {
    const warehouses = ctx.config?.warehouses;
    if (warehouses === undefined) return skip('Warehouse connections were not collected.');
    const env = ctx.config?.environment?.name ?? 'this environment';
    const selfHosted = ctx.config?.environment?.selfHosted === true;

    if (warehouses.length === 0) {
      return fail([
        makeFinding(this, {
          severity: 'critical',
          title: `${env === 'this environment' ? 'This environment' : `"${env}"`} has no warehouse, so every event is rejected`,
          detail:
            'Experiment events are stored in a warehouse connected to the environment. With none connected, the ingestion service rejects exposures and conversions, so the experiment can never show data, however correct the code is.',
          evidence: [configItem(`GET warehouse-connections for ${env}`, '[] (none)')],
          fix: {
            summary: 'Connect a warehouse to this environment, then re-run the check.',
            steps: selfHosted
              ? ['On self-hosted PostgreSQL you can store events in the Flagsmith database itself (command below).', 'Otherwise connect Snowflake, ClickHouse, Databricks or PostgreSQL in the environment settings.']
              : ['Connect a warehouse in the environment settings of the Flagsmith dashboard (Experiments).'],
            command: selfHosted ? connectFlagsmithDatabaseCommand() : listWarehousesCommand(),
            docs: DOCS.runExperiment,
          },
          confidence: 0.98,
        }),
      ]);
    }

    const connected = warehouses.filter((w) => w.status === 'connected');
    if (connected.length) {
      const w = connected[0]!;
      return pass(`Warehouse "${w.type}${w.flagsmithDatabase ? ' (Flagsmith database)' : ''}" is connected.`);
    }
    const w = warehouses[0]!;
    const errored = w.status === 'errored';
    return fail([
      makeFinding(this, {
        severity: errored ? 'critical' : 'warning',
        title: errored ? `The ${w.type} warehouse connection is failing` : `The ${w.type} warehouse is not connected yet (status "${w.status}")`,
        detail: errored
          ? `Flagsmith cannot deliver events to the warehouse${w.statusDetail ? `: "${w.statusDetail}"` : ''}. Until it is fixed, events are not stored and results cannot be computed.`
          : 'The connection exists but has not been verified as connected, so events may not be stored yet.',
        evidence: [configItem(`Warehouse ${w.id} (${w.type}) status`, w.statusDetail ? `${w.status}: ${w.statusDetail}` : w.status)],
        fix: {
          summary: errored ? 'Fix the warehouse credentials or permissions, then test the connection again.' : 'Finish setting up the warehouse connection and test it.',
          steps: ['In the environment settings, open the warehouse connection and run "Test connection".'],
          command: listWarehousesCommand(),
          docs: DOCS.runExperiment,
        },
        confidence: errored ? 0.95 : 0.6,
      }),
    ]);
  },
};
