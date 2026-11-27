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

describe('binding to the repair window and the experiment', () => {
  const tagged = (exp: number, at: string) => `$flag_exposure\tcheckout_button\t${at}\tgreen\t{"experiment_id":${exp}}`;
  const buy = (at: string) => `purchase\t\t${at}\t\t{}`;

  it('ignores events older than the repair', () => {
    const v = evaluateIdentityEvents('u1', rows(tagged(42, '2026-11-28T09:00:00.000Z'), buy('2026-11-28T09:00:01.000Z')), {
      flag: 'checkout_button',
      event: 'purchase',
      experimentId: 42,
      since: '2026-11-28T10:00:00.000Z',
    });
    expect(v).toMatchObject({ status: 'PENDING', stale: 2 });
    expect(v.message).toMatch(/older than 2026-11-28T10:00:00.000Z/);
  });

  it('counts only fresh events when old and new are mixed', () => {
    const v = evaluateIdentityEvents(
      'u1',
      rows(tagged(42, '2026-11-28T09:00:00.000Z'), buy('2026-11-28T09:00:01.000Z'), tagged(42, '2026-11-28T10:05:00.000Z')),
      { flag: 'checkout_button', event: 'purchase', experimentId: 42, since: '2026-11-28T10:00:00.000Z' },
    );
    expect(v).toMatchObject({ status: 'PENDING', stale: 2, problems: ['no "purchase" event yet'] });
  });

  it('only counts exposures tagged with the current experiment', () => {
    const other = evaluateIdentityEvents('u1', rows(tagged(7, '2026-11-28T10:00:00.000Z'), buy('2026-11-28T10:00:01.000Z')), { flag: 'checkout_button', event: 'purchase', experimentId: 42 });
    expect(other.status).toBe('PENDING');
    expect(other.problems[0]).toMatch(/belongs to experiment 7, not 42/);
    const untagged = evaluateIdentityEvents('u1', rows('$flag_exposure\tcheckout_button\t2026-11-28T10:00:00.000Z\tgreen\t{}', buy('2026-11-28T10:00:01.000Z')), { flag: 'checkout_button', event: 'purchase', experimentId: 42 });
    expect(untagged.problems[0]).toMatch(/carries no experiment_id/);
    const ok = evaluateIdentityEvents('u1', rows(tagged(42, '2026-11-28T10:00:00.000Z'), buy('2026-11-28T10:00:01.000Z')), { flag: 'checkout_button', event: 'purchase', experimentId: 42 });
    expect(ok.status).toBe('IDENTITY_VERIFIED');
  });

  it('a missing conversion is pending, not failed', () => {
    expect(evaluateIdentityEvents('u1', rows(tagged(42, '2026-11-28T10:00:00.000Z')), { flag: 'checkout_button', event: 'purchase', experimentId: 42 }).status).toBe('PENDING');
  });

  it('fingerprints keys without exposing them', async () => {
    const { keyFingerprint } = await import('../src/identity-events');
    expect(keyFingerprint('aB3dE5fG7hJ9kL1mN3pQ5r')).toMatch(/^fnv1a:[0-9a-f]{8}$/);
    expect(keyFingerprint('a')).not.toBe(keyFingerprint('b'));
  });
});
