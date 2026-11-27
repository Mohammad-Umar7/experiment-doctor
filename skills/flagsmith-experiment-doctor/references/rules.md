# Findings

Ordered as the Doctor ranks them: environment and config blockers, then instrumentation, identity, transport, results. `check --json` returns the first one as `primary`.

| Id | Means | Usual fix | Evidence |
| --- | --- | --- | --- |
| ED-007 | No connected warehouse: ingestion rejects every event | Connect one (self-hosted Postgres: the Flagsmith database) | config |
| ED-001 | A variation has no `key`: its exposures are dropped | `flagsmith feature variant update <flag> <id> --key <key>` (flag is locked while running) | config |
| ED-008 | Experiment not running (created, paused, completed, or missing) | Start or resume (needs approval), or create one | config |
| ED-013 | Experiment has no metric | Create a metric, attach it when creating the experiment | config |
| ED-015 | Rollout 0% or disabled | Raise the rollout (needs approval) | config |
| ED-010 | SDK too old (`@flagsmith/flagsmith` < 12.4.0, `@flagsmith/nodejs` < 9.1.0, `flagsmith-nodejs`, `flagsmith`) | Upgrade or switch package | code |
| ED-009 | `enableEvents: true` missing (note: `enableAnalytics` is different) | Add the option | code |
| ED-011 | Flag read with getValue / hasFeature / useFlags / getAllFlags: no exposure | `getExperimentFlag(...)` / `useExperiment(...)`, or `trackExposureEvent` at display | code |
| ED-004 | Tracked event name differs from the metric (case, format, typo) or is never sent | Use the exact metric event name | code + config |
| ED-002 | No identify before the experiment flag read, or identify not awaited | `await flagsmith.identify(<user id>)` first | code |
| ED-003 | Exposure and conversion use different identities (id vs email, missing Node `identifier`) | Same identifier everywhere; other data as traits | code |
| ED-006 | Events go to a different Flagsmith than flags (self-hosted API + Cloud events URL, `/api/v1/` events URL) | `eventProcessorConfig.eventsApiUrl: '<origin>/api/'` | code + config |
| ED-005 | Buffered events not flushed (script exits, serverless returns, server shutdown, page close) | `await client.close()` (Node) / `flushEvents()` | code |
| ED-016 | Warehouse has received no events (pending, not broken: may be no traffic) | Scan the code, send traffic | config |
| ED-014 | Sample ratio mismatch | Check every variation records exposures the same way | results |
| ED-012 | Below 50 identities / 5 conversions per variation: collecting data (pending) | Wait, refresh results | results |

Severity: `critical` and `warning` defects make the verdict `REPAIR_REQUIRED`; `info` items are advice. `kind: "pending"` means waiting for data, never broken.

A check that lacks evidence is `skip` and its pipeline node stays gray (`unknown`): the Doctor never shows green without evidence.
