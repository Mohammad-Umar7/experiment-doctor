# Token use: skill vs a plain agent

**Results are in [BENCHMARK.md](BENCHMARK.md)** (18 runs, Claude Sonnet 5.5, losses included). This file keeps the original plan for reference.

## Question

How many tokens does a coding agent spend to find and fix a broken Flagsmith experiment

- **A. with the `flagsmith-experiment-doctor` skill** (reads `SKILL.md`, runs `experiment-doctor check --json`, reads only the primary finding), versus
- **B. as a plain agent** that has the Flagsmith CLI and the docs pages ([run an experiment](https://docs.flagsmith.com/experimentation/run-an-experiment), [set up with a coding agent](https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent)) but no skill?

## Setup

- Same model, same agent harness, same temperature, fresh session per run.
- Same task prompt for both: *"Exposures or conversions are not showing for the checkout_button experiment. Find out why and fix it. Ask me before changing anything."*
- Same repo state: one case from `examples/broken-apps` copied into an empty directory, with its `evidence.json` (A uses `--evidence`; B is given the same Flagsmith state as a JSON file it may read, so neither needs a live account).
- B may read the two docs pages (fetched once, counted as input tokens) and any file in the repo.
- A run ends when the agent has proposed the right fix and stopped to ask for approval, or after 30 turns.

## What we record per run

| Field | How |
| --- | --- |
| input tokens | sum of prompt tokens over all turns, from the harness usage log |
| output tokens | sum of completion tokens |
| tool calls | count |
| turns | count |
| correct root cause | the rule id the fix addresses matches `cases.json` |
| asked before writing | yes / no |
| wall time | seconds |

Static costs, measured once:

| Item | Tokens |
| --- | ---: |
| `SKILL.md` body | _todo_ |
| `references/rules.md` (only if loaded) | _todo_ |
| median `check --json` output (`node bench/accuracy.mjs`) | ≈ 400 (bytes / 4) |
| the two docs pages, as fetched | _todo_ |

Count tokens with the model's tokenizer (for example the Anthropic token counting endpoint) rather than bytes / 4 when filling in the final table.

## Results

| Case | A input | A output | A calls | A correct | B input | B output | B calls | B correct |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| 01-missing-variant-key | | | | | | | | |
| 02-no-identify | | | | | | | | |
| 03-identity-mismatch | | | | | | | | |
| 04-event-name-case | | | | | | | | |
| 05-unflushed-script | | | | | | | | |
| 06-wrong-events-endpoint | | | | | | | | |
| 07-no-warehouse | | | | | | | | |
| 08-experiment-draft | | | | | | | | |
| 09-events-disabled | | | | | | | | |
| 10-old-sdk | | | | | | | | |
| 11-plain-flag-read | | | | | | | | |
| 12-collecting-data | | | | | | | | |
| **median** | | | | | | | | |

Report the median and the ratio B / A for input tokens, plus how many cases each got right. Note any run where B found the cause but A did not.

## Why the skill should be cheaper (hypothesis, to be checked)

- The agent never reads the docs: the rules encode them.
- `check --json` returns one primary finding with its evidence and patch, and one line per other finding, instead of raw API responses.
- When the agent needs Flagsmith data directly, the skill tells it to use `--json --jq` so only the needed fields come back.
