import { IDENTITY_EVENTS_SQL, parseStoredEvents, type StoredEvent } from '@experiment-doctor/core';
import { UsageError } from './args';
import type { Io } from './io';

/**
 * Read-only access to a Flagsmith-database event store (self-hosted, warehouse
 * "Flagsmith database"): the experimentation_sdkexperimentationevent table.
 *
 *   docker:<compose project>[/<service>][?db=flagsmith&user=postgres]
 *       runs psql inside the running Postgres container of that compose project
 *   psql:<postgres url>
 *       runs a local psql against that URL
 *
 * Identity and environment key are validated and handed to psql as variables
 * (\set on stdin), never spliced into SQL and never put on the command line.
 */
export type EventStoreSpec =
  | { kind: 'docker'; project: string; service: string; db: string; user: string }
  | { kind: 'psql'; url: string };

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const IDENTITY = /^[A-Za-z0-9_.:@-]{1,200}$/;
const ENV_KEY = /^[A-Za-z0-9._-]{1,100}$/;

export function parseEventStore(spec: string): EventStoreSpec {
  if (spec.startsWith('docker:')) {
    const [target = '', query = ''] = spec.slice('docker:'.length).split('?');
    const [project = '', service = 'postgres'] = target.split('/');
    const params = new URLSearchParams(query);
    const db = params.get('db') ?? 'flagsmith';
    const user = params.get('user') ?? 'postgres';
    for (const [label, v] of [['project', project], ['service', service], ['db', db], ['user', user]] as const) {
      if (!NAME.test(v)) throw new UsageError(`--event-store: invalid ${label} "${v}". Use docker:<compose project>[/<service>][?db=...&user=...].`);
    }
    return { kind: 'docker', project, service, db, user };
  }
  if (spec.startsWith('psql:')) {
    const url = spec.slice('psql:'.length);
    if (!/^postgres(ql)?:\/\//.test(url)) throw new UsageError('--event-store psql:<url> needs a postgres:// or postgresql:// URL.');
    return { kind: 'psql', url };
  }
  throw new UsageError('--event-store must be docker:<compose project>[/<service>] or psql:<postgres url>.');
}

/** Human description, without any password. */
export function describeEventStore(s: EventStoreSpec): string {
  return s.kind === 'docker' ? `docker compose project "${s.project}", service ${s.service}, database ${s.db}` : `psql ${s.url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@')}`;
}

export type EventStoreRead = { ok: true; rows: StoredEvent[] } | { ok: false; error: string };

export async function readIdentityEvents(io: Io, spec: EventStoreSpec, identity: string, envKey: string): Promise<EventStoreRead> {
  if (!IDENTITY.test(identity)) return { ok: false, error: 'The identity has characters the event-store query does not accept.' };
  if (!ENV_KEY.test(envKey)) return { ok: false, error: 'The environment key has unexpected characters.' };
  const script = `\\set identity ${identity}\n\\set env ${envKey}\n${IDENTITY_EVENTS_SQL}\n`;
  const psqlArgs = ['-At', '-F', '\t', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'];

  let res;
  if (spec.kind === 'docker') {
    const ps = await io.runProcess('docker', [
      'ps',
      '--filter',
      `label=com.docker.compose.project=${spec.project}`,
      '--filter',
      `label=com.docker.compose.service=${spec.service}`,
      '--format',
      '{{.Names}}',
    ]);
    if (ps.notFound) return { ok: false, error: 'docker is not installed or not on PATH.' };
    if (ps.code !== 0) return { ok: false, error: `docker ps failed: ${ps.stderr.trim().split('\n')[0] ?? ''}` };
    const container = ps.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (!container) return { ok: false, error: `No running "${spec.service}" container in compose project "${spec.project}".` };
    res = await io.runProcess('docker', ['exec', '-i', container, 'psql', '-U', spec.user, '-d', spec.db, ...psqlArgs], script);
  } else {
    res = await io.runProcess('psql', [spec.url, ...psqlArgs], script);
    if (res.notFound) return { ok: false, error: 'psql is not installed or not on PATH.' };
  }
  if (res.code !== 0) {
    const first = (res.stderr || res.stdout).trim().split('\n')[0] ?? '';
    return { ok: false, error: `Event store query failed: ${first.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@')}` };
  }
  return { ok: true, rows: parseStoredEvents(res.stdout) };
}
