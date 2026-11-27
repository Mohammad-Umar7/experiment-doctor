import { describe, expect, it } from 'vitest';
import { buildContext } from '../../src/rules/context';
import { ed007 } from '../../src/rules/ed007-no-warehouse';
import { healthyEvidence } from '../fixtures';

describe('ED-007 no warehouse connection', () => {
  it('passes with a connected warehouse', () => {
    expect(ed007.run(buildContext(healthyEvidence())).status).toBe('pass');
  });

  it('fails when there is no warehouse', () => {
    const ev = healthyEvidence();
    ev.config!.warehouses = [];
    const f = ed007.run(buildContext(ev)).findings![0]!;
    expect(f).toMatchObject({ id: 'ED-007', severity: 'critical', layer: 'ingestion', node: 'warehouse' });
    expect(f.title).toBe('"Staging" has no warehouse, so every event is rejected');
    expect(f.fix.command?.writes).toBe(false);
  });

  it('offers the Flagsmith database on self-hosted', () => {
    const ev = healthyEvidence();
    ev.config!.warehouses = [];
    ev.config!.environment!.selfHosted = true;
    const f = ed007.run(buildContext(ev)).findings![0]!;
    expect(f.fix.command).toMatchObject({ writes: true });
    expect(JSON.parse(f.fix.command!.input!)).toEqual({ warehouse_type: 'postgres', config: { source: 'flagsmith_database' } });
  });

  it('reports an errored connection with its detail', () => {
    const ev = healthyEvidence();
    ev.config!.warehouses = [{ id: 2, type: 'snowflake', status: 'errored', statusDetail: 'Permission denied on the events table.' }];
    const f = ed007.run(buildContext(ev)).findings![0]!;
    expect(f.severity).toBe('critical');
    expect(f.detail).toContain('Permission denied');
  });

  it('skips when warehouses were not collected', () => {
    const ev = healthyEvidence();
    delete ev.config!.warehouses;
    expect(ed007.run(buildContext(ev)).status).toBe('skip');
  });
});
