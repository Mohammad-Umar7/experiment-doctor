# Demo runbook (3-minute video)

Everything shown is real: a self-hosted Flagsmith, the real Flagsmith CLI, a real GitHub check, the live site. Record each scene separately, then cut. Target 2:55.

## Before recording

```bash
docker compose -p doctor-lab -f selfhost/docker-compose.yml up -d
node selfhost/seed.mjs                       # only on a fresh lab
set -a; . selfhost/lab.env; set +a           # lab credentials for the Flagsmith CLI
export FLAGSMITH_CLI_BIN=<path to flagsmith>  # if `flagsmith` is not on PATH
cp -r selfhost/checkout-app /tmp/lab-app     # record on a copy so the lab app stays broken
cp selfhost/flagsmith.json /tmp/lab-app/
```

Use a large terminal font (18 px or more), dark theme, 1920×1080. Browser at 100% zoom.

## Scenes

| Time | Screen | Do | Say (roughly) |
| --- | --- | --- | --- |
| 0:00–0:15 | experimentdoctor.vercel.app hero | Let the monitor loop from flatline to revived once | "Your app works and customers are buying, but your A/B test shows zero conversions. One instrumentation mistake silently kills the experiment." |
| 0:15–0:43 | Terminal in `/tmp/lab-app` | `npx -y --package=https://experimentdoctor.vercel.app/doctor.tgz experiment-doctor check` | "A real self-hosted Flagsmith experiment. The Doctor reads the live config through the Flagsmith CLI v2 and scans the code. Three causes, one of them a variation without a key that our own seed script created by mistake." |
| 0:43–1:10 | Same terminal, then `selfhost/verify-events.mjs` | `experiment-doctor fix` → show the diff → `y`. Then `node selfhost/lab.mjs probe`, `node selfhost/verify-events.mjs <id>` | "One diff, nothing changes without a yes. Then we read the stored events for one identity: exposure and conversion, in order. Patch, pipeline and experiment are reported separately." |
| 1:10–1:30 | GitHub PR #1, Files changed tab, annotation | Scroll to `checkout.js:12` | "A harmless-looking rename passes every test. The CI Gate fails the check and points at the exact line. PR #2 changes a label and passes." |
| 1:30–1:53 | /play | Start a case, open the hint, fix it, verify, watch the heartbeat return | "Human vs Doctor: fix a broken experiment in three minutes. Flagsmith decides which hint you get, a full report or one prioritized fix." |
| 1:53–2:18 | /rescue | Show the A/B panel, reconciliation, timeline | "The metric is a server-verified repair within 180 seconds, first run per player only. We reconcile our counts with Flagsmith's and show its Bayesian result as is." Read the real numbers. |
| 2:18–2:42 | bench/BENCHMARK.md on GitHub | Scroll the suite 1 and suite 4 tables | "Plain Claude Code is faster on easy cases. On real ones the Doctor fixed 6 of 6 game cases against 3 of 6, and found 3 of 3 lab bugs in 85 seconds against 1 of 3 in 329." |
| 2:42–2:55 | README top, then the hero | Show the evidence index, end on the revived monitor | "One engine powers the CLI, the browser Doctor, the CI Gate and the Agent Skill. Before you trust the winner of your experiment, make sure the experiment is telling the truth." |

## Numbers to read out (from bench/BENCHMARK.md)

- Six game cases: Doctor 6/6, plain 3/6.
- Lab: Doctor 3/3 in 85 s for $0.33; plain 1/3 in 329 s for $0.85.
- Easy case: plain wins on speed (21 s vs 44.6 s). Say it.

Experiment numbers: read them off /rescue at recording time. If Flagsmith still shows "collecting data", say so. Never put placeholder numbers in the video.
