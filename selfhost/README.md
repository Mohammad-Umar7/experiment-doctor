# Self-hosted rescue lab

A self-hosted Flagsmith with Experimentation, a broken storefront, real SDK traffic, and verification that reads **one identity's own events** from Flagsmith's Postgres event store. Nothing here trusts an aggregate counter.

## Run it

```bash
docker compose -p doctor-lab -f selfhost/docker-compose.yml up -d   # official images, EXPERIMENTATION_ENABLED
node selfhost/seed.mjs              # admin, org, project, env, "Flagsmith database" warehouse, flag, metric, running experiment
node selfhost/lab.mjs broken        # 30 shoppers through the shipped bug, with the real @flagsmith/flagsmith SDK
node selfhost/verify-events.mjs <identity>
```

`seed.mjs` writes `selfhost/lab.env` and `selfhost/flagsmith.json` (both git-ignored) so the official Flagsmith CLI and the Doctor can talk to `localhost:8000`:

```bash
set -a; . selfhost/lab.env; set +a
npx -y --package=https://experimentdoctor.vercel.app/doctor.tgz experiment-doctor check --dir selfhost/checkout-app
```

## What is broken, on purpose and not

| Finding | Where | How it got there |
| --- | --- | --- |
| ED-004: the app sends `Purchase`, the metric counts `purchase` | `checkout-app/src/checkout.js` | planted |
| ED-006: the experiment is self-hosted, the SDK sends events to Flagsmith Cloud | `checkout-app/src/experiment.js` | planted (no `api` / `eventsApiUrl`) |
| ED-001: the `one_click` variation has no key, so its exposures are not attributed | Flagsmith config | **not planted.** `seed.mjs` passes `key: "one_click"` inside `multivariate_options` when it creates the feature, but the stored variation came back with `key: null`. The Doctor caught it on its first run. |

Fixing ED-001 needs a Flagsmith write (`flagsmith feature variant update checkout_button <id> --key one_click`) and the flag is locked while the experiment runs, so the Doctor proposes it and never runs it without approval and an allowlisted environment.

## What verification proves

`verify-events.mjs` (and `experiment-doctor verify --event-store docker:doctor-lab --identity <id>`) query `experimentation_sdkexperimentationevent` for a single identity, with the identity passed as a psql variable on stdin, never spliced into SQL:

- `PIPELINE_VERIFIED`: a `$flag_exposure` for the flag **and** the metric's exact event were stored for that identity, in order.
- `FAILED`: e.g. `conversion stored as "Purchase", the metric counts "purchase"`.
- `PENDING`: nothing stored yet (events are buffered for up to 10 s).

Captured from a real run:

```
events stored for lab-broken-mwzesjta-3:
  20:03:28.150Z  $flag_exposure (checkout_button) = control
  20:03:28.150Z  Purchase
FAILED   conversion stored as "Purchase", the metric counts "purchase"

events stored for doctor-probe-mwzet3ec:
  20:03:53.170Z  $flag_exposure (checkout_button) = control
  20:03:53.170Z  purchase
PIPELINE_VERIFIED  exposure (control) and "purchase" stored for the same identity, in order
```

The credentials in `seed.mjs` are for this throwaway local lab only. Change every secret before exposing it anywhere.
