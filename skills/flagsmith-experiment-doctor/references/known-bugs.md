# Flagsmith issues the Doctor can point to

States checked 2026-11-27. A match only means the symptoms may be consistent with the issue. Confirm the affected operation and error before applying a workaround, and never propose a code patch for it.

| Issue | State | Symptom | Evidence the Doctor needs | Workaround |
| --- | --- | --- | --- | --- |
| [#9120](https://github.com/Flagsmith/flagsmith/issues/9120) | closed | After completing, flag edits do not reach users that were in the rollout | completed experiment, no `rollout_decision` | 2.295.2+: choose the rollout when completing. Older: pause, set the default to the winner, rollout 0% with the winner's weights, complete |
| [#9129](https://github.com/Flagsmith/flagsmith/issues/9129) | closed | Completed experiment still shows `is_final: false` | completed + non-final results | After the 5-minute limit, POST `results/refresh/` once more |
| [#9132](https://github.com/Flagsmith/flagsmith/issues/9132) | open | Self-hosted: some events time out or go missing | self-hosted + a canary request slower than 2.5 s | Postgres `-c jit=off` |
| [#9133](https://github.com/Flagsmith/flagsmith/issues/9133) | open | Results banner names a winner below 95% | a variation with 5% < chance to win < 95% | Treat it as inconclusive, read the interval, keep running |
| [#9136](https://github.com/Flagsmith/flagsmith/issues/9136) | open | MCP `update_experiment` (PUT) returns 400 on `feature` | code calls `update_experiment` or PUTs `.../experiments/<id>/` (an MCP config alone is a weak 15% match) | PATCH with only the changed fields |
