import { describe, expect, it } from 'vitest';
import { compareVersions, parseRange, parseVersion, rangeCanSatisfy } from '../src/util/semver';
import { compareNames, exprTail, identityKind, normaliseExpr, retargetExpr, sameIdentity, slugify } from '../src/util/strings';
import { eventsEndpoint, isCloudUrl, selfHostedEventsUrl, stringLiteral } from '../src/util/urls';
import { maskKey, redactDeep, redactSecrets } from '../src/util/redact';

describe('semver', () => {
  it('parses and compares versions', () => {
    expect(parseVersion('12.4.0')).toEqual([12, 4, 0]);
    expect(parseVersion('v9.1')).toEqual([9, 1, 0]);
    expect(compareVersions([12, 3, 9], [12, 4, 0])).toBe(-1);
    expect(compareVersions([12, 4, 0], [12, 4, 0])).toBe(0);
  });

  it('knows which ranges can reach a minimum version', () => {
    const min: [number, number, number] = [12, 4, 0];
    expect(rangeCanSatisfy(parseRange('^12.6.0')!, min)).toBe(true);
    expect(rangeCanSatisfy(parseRange('^12.0.0')!, min)).toBe(true);
    expect(rangeCanSatisfy(parseRange('12.3.0')!, min)).toBe(false);
    expect(rangeCanSatisfy(parseRange('~12.3.1')!, min)).toBe(false);
    expect(rangeCanSatisfy(parseRange('^11.2.0')!, min)).toBe(false);
    expect(rangeCanSatisfy(parseRange('>=10')!, min)).toBe(true);
    expect(rangeCanSatisfy(parseRange('latest')!, min)).toBe(true);
    expect(parseRange('12.3.0')!.exact).toBe(true);
  });
});

describe('names', () => {
  it('classifies event name differences', () => {
    expect(compareNames('purchase', 'purchase')).toBe('exact');
    expect(compareNames('purchase', 'Purchase')).toBe('case');
    expect(compareNames('purchase_completed', 'purchaseCompleted')).toBe('format');
    expect(compareNames('checkout_completed', 'checkout_complted')).toBe('typo');
    expect(compareNames('purchase', 'signup')).toBe('none');
  });

  it('slugifies variant values into keys', () => {
    expect(slugify('Big Green Button')).toBe('big_green_button');
    expect(slugify('control')).toBe('control_variant');
    expect(slugify('')).toBe('variant');
  });
});

describe('identity expressions', () => {
  it('normalises and compares identifiers', () => {
    expect(normaliseExpr(' user?.id ')).toBe('user.id');
    expect(normaliseExpr('String(user.id)')).toBe('user.id');
    expect(exprTail('req.user.email')).toBe('email');
    expect(identityKind('session.user.userId')).toBe('id');
    expect(identityKind('user.email')).toBe('email');
    expect(sameIdentity('user.id', 'currentUser.id')).toBe(true);
    expect(sameIdentity('user.id', 'user.email')).toBe(false);
    expect(retargetExpr('customer.email', 'user.id')).toBe('customer.id');
  });
});

describe('urls', () => {
  it('reads string literals only', () => {
    expect(stringLiteral("'http://localhost:8000/api/v1/'")).toBe('http://localhost:8000/api/v1/');
    expect(stringLiteral('process.env.API')).toBeNull();
    expect(stringLiteral('`purchase`')).toBe('purchase');
  });

  it('derives the self-hosted events URL', () => {
    expect(selfHostedEventsUrl('http://localhost:8000/api/v1/')).toBe('http://localhost:8000/api/');
    expect(selfHostedEventsUrl('https://flags.acme.io/flagsmith/api/v1')).toBe('https://flags.acme.io/flagsmith/api/');
    expect(eventsEndpoint(undefined)).toBe('https://events.api.flagsmith.com/v1/events');
    expect(eventsEndpoint('http://localhost:8000/api')).toBe('http://localhost:8000/api/v1/events');
    expect(isCloudUrl('https://edge.api.flagsmith.com/api/v1/')).toBe(true);
    expect(isCloudUrl('http://localhost:8000/api/v1/')).toBe(false);
  });
});

describe('redaction', () => {
  it('never lets keys through', () => {
    expect(redactSecrets("environmentID: 'aB3dE5fG7hJ9kL1mN3pQ5r'")).toBe("environmentID: '***'");
    expect(redactSecrets('FLAGSMITH_API_KEY="ser.abcdef123456"')).not.toContain('abcdef123456');
    expect(maskKey('aB3dE5fG7hJ9kL1mN3pQ5r')).toBe('aB3d…');
    expect(redactDeep({ a: ['path/aB3dE5fG7hJ9kL1mN3pQ5r/x'] }, ['aB3dE5fG7hJ9kL1mN3pQ5r'])).toEqual({ a: ['path/<env-key>/x'] });
  });
});
