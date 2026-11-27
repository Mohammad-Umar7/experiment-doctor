# JSON output

## `experiment-doctor check --json` (one line)

```json
{
  "v": 1,
  "verdict": "REPAIR_REQUIRED",
  "summary": "Repair required: The app sends \"Purchase\" but the metric counts \"purchase\".",
  "pipeline": { "app": "broken", "sdk": "ok", "flagsmith": "ok", "warehouse": "ok", "results": "unknown" },
  "primary": {
    "id": "ED-004", "severity": "critical", "layer": "instrumentation", "node": "app", "kind": "defect",
    "title": "...", "detail": "...", "confidence": 0.97,
    "evidence": [{ "label": "...", "source": "code", "location": { "file": "src/App.tsx", "line": 10, "snippet": "..." } }],
    "fix": {
      "summary": "...", "steps": ["..."], "docs": "https://...",
      "patch": { "file": "src/App.tsx", "line": 10, "before": "...", "after": "...", "placeholder": false },
      "command": { "command": "flagsmith api api/v1/environments/<env-key>/...", "input": "{...}", "writes": true, "description": "..." }
    }
  },
  "others": [{ "id": "ED-012", "severity": "info", "title": "..." }],
  "upstream": [{ "issue": 9133, "title": "...", "url": "...", "workaround": "..." }],
  "checks": { "pass": 12, "fail": 1, "skip": 2, "pending": 1 },
  "next": "experiment-doctor fix",
  "notes": ["Flagsmith CLI not found ..."],
  "saved": ".experiment-doctor/last-report.json"
}
```

- `verdict`: `HEALTHY` | `REPAIR_REQUIRED` | `PENDING` | `UNVERIFIABLE`.
- `pipeline` values: `ok` (verified), `broken` (evidenced failure), `unknown` (not verified).
- `primary` is `null` when nothing was found. `patch` and `command` are optional; `command.writes: true` means it changes Flagsmith.
- Exit code 1 when `REPAIR_REQUIRED`.

## `experiment-doctor verify --json` (one line)

```json
{
  "v": 2,
  "patch": { "status": "PATCH_VERIFIED", "target": "ED-004", "message": "ED-004 check now passes on fresh static and config evidence." },
  "pipeline": { "status": "PIPELINE_UNVERIFIED", "message": "No probe ran: ...", "probe": { "status": "ACCEPTED", "at": "...", "identity": "doctor-canary-...", "identityLevel": false, "scope": "ingestion-http", "detail": "..." } },
  "experiment": { "status": "EXPERIMENT_PENDING", "verdict": "PENDING", "message": "..." },
  "resolved": ["ED-004"], "remaining": [], "introduced": [],
  "verdictBefore": "REPAIR_REQUIRED", "verdictAfter": "PENDING",
  "window": { "since": "2026-11-28T10:00:00.000Z", "reason": "repair" },
  "summary": "...", "next": "...", "notes": []
}
```

- `patch.status`: `PATCH_VERIFIED` | `PATCH_FAILED` | `PATCH_UNVERIFIED` | `NO_PATCH_TARGET`.
- `pipeline.status`: `PIPELINE_VERIFIED` (identity-level evidence only) | `PIPELINE_FAILED` (a fresh probe shows rejection or wrong storage) | `PIPELINE_UNVERIFIED`.
- Pipeline evidence counts only when its `probe.binding` (environment fingerprint, experiment id, flag, metric event) matches the current report and it is newer than `window.since`: the last fix (`reason: "repair"`), or the start of this verify run when nothing was fixed (`"verify-start"`). With `--identity`, an earlier canary is never used.
- `experiment.status`: `EXPERIMENT_HEALTHY` | `EXPERIMENT_PENDING` | `EXPERIMENT_REPAIR_REQUIRED` | `EXPERIMENT_UNVERIFIABLE`.
- Exit code 1 when `PATCH_FAILED` or `PIPELINE_FAILED`.

## `experiment-doctor canary --json`

`{"status": "VERIFIED" | "ACCEPTED" | "FAILED" | "PENDING", "identity", "environment", "identityLevel", "scope": "ingestion-http", "steps": [...], "message", "maxLatencyMs", "binding": {"envFingerprint", "experimentId", "flag", "event", "sentAt"}, "evidenceAt"?}`. `VERIFIED` needs `--event-store`, and only events newer than `sentAt` count.

## `experiment-doctor fix --yes --json`

`{"finding", "action": "patched" | "ran-command" | "refused" | "failed" | ..., "file"?, "command"?, "message"}`. With `--yes`, fix refuses (`refused`, exit 3) unless the patch or command it would apply equals the one in `.experiment-doctor/last-report.json`.
