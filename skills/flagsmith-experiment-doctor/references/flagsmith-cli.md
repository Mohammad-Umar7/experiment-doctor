# Flagsmith CLI recipes (v2)

Only when `check --json` is not enough. Each command returns just the fields you need. Keep the environment key in a variable so it never appears in output:

```sh
ENV=$(node -p "require('./flagsmith.json').environment")   # client-side key from flagsmith init
B="api/v1/environments/$ENV"
```

| Need | Command |
| --- | --- |
| CLI and login | `flagsmith --version` (v2+), `flagsmith auth status` |
| Bind the repo | `flagsmith init --project <project> --environment <environment key>` |
| Experiments | `flagsmith api $B/experiments/ --jq '.results[] \| {id, name, status, flag: .feature.name}'` |
| One experiment | `flagsmith api $B/experiments/<id>/ --jq '{status, started_at, metrics: [.metrics[].metric], rollout: .experiment_rollout \| {enabled, rollout_percentage}}'` |
| Variations and keys | `flagsmith feature get <flag> --json --jq '.variants[] \| {id, key, value}'` |
| Metric event names | `flagsmith api $B/experiment-metrics/ --jq '.results[] \| {id, name, event: .definition.event, aggregation}'` |
| Warehouse | `flagsmith api $B/warehouse-connections/ --jq '.[] \| {warehouse_type, status, status_detail, total_events_received}'` |
| Results per variation | `flagsmith api $B/experiments/<id>/results/ --jq '.results.payload.metrics[]? \| {metric_id, n: (.variants \| map_values(.n)), conversions: (.variants \| map_values(.sum))}'` |

Writes (only after the human approves, and only in an allowlisted environment; prefer `experiment-doctor fix`, which runs exactly these):

| Change | Command |
| --- | --- |
| Give a variation a key | `flagsmith feature variant update <flag> <variation id> --key <key>` |
| Start / resume | `flagsmith api $B/experiments/<id>/start/ -X POST` |
| Refresh results (max every 5 min) | `flagsmith api $B/experiments/<id>/results/refresh/ -X POST` |
| Edit hypothesis (use PATCH, not PUT: #9136) | `flagsmith api $B/experiments/<id>/ -X PATCH --input -` with `{"hypothesis": "..."}` |

Self-hosted: set `FLAGSMITH_API_URL` (or `apiUrl` in flagsmith.json). The SDK needs `api: '<origin>/api/v1/'` and, with the Flagsmith database, `eventProcessorConfig.eventsApiUrl: '<origin>/api/'`.
