import { describe, expect, it } from 'vitest';
import { evaluateIdentityEvents, IDENTITY_EVENTS_SQL, parseStoredEvents } from '../src/identity-events';

const rows = (...lines: string[]) => parseStoredEvents(lines.join('\n'));

describe('identity-level pipeline evidence', () => {
  it('parses psql tab-separated rows', () => {
    expect(rows('$flag_exposure\tcheckout_button\t2026-11-28T10:00:00.000Z\tgreen')).toEqual([
      { event: '$flag_exposure', featureName: 'checkout_button', at: '2026-11-28T10:00:00.000Z', value: 'green' },
    ]);
  });

  it('verifies an exposure followed by the exact conversion', () => {
    const v = evaluateIdentityEvents('u1', rows('$flag_exposure\tcheckout_button\t2026-11-28T10:00:00.000Z\tgreen', 'purchase\t\t2026-11-28T10:00:05.000Z\t'), { flag: 'checkout_button', event: 'purchase' });
    expect(v.status).toBe('IDENTITY_VERIFIED');
    expect(v.message).toMatch(/in order/);
  });

  it('fails on a case-only near miss or a conversion before the exposure', () => {
    const near = evaluateIdentityEvents('u1', rows('$flag_exposure\tcheckout_button\t2026-11-28T10:00:00.000Z\tgreen', 'Purchase\t\t2026-11-28T10:00:05.000Z\t'), { flag: 'checkout_button', event: 'purchase' });
    expect(near).toMatchObject({ status: 'FAILED', problems: ['conversion stored as "Purchase", the metric counts "purchase"'] });
    const early = evaluateIdentityEvents('u1', rows('purchase\t\t2026-11-28T09:00:00.000Z\t', '$flag_exposure\tcheckout_button\t2026-11-28T10:00:00.000Z\tgreen'), { flag: 'checkout_button', event: 'purchase' });
    expect(early.problems).toEqual(['the conversion was stored before the exposure, so it is not attributed']);
  });

  it('is pending when nothing is stored yet', () => {
    expect(evaluateIdentityEvents('u1', [], { flag: 'f', event: 'e' }).status).toBe('PENDING');
  });

  it('never splices values into the SQL', () => {
    expect(IDENTITY_EVENTS_SQL).toContain(":'identity'");
    expect(IDENTITY_EVENTS_SQL).toContain(":'env'");
  });
});
