#!/usr/bin/env sh
# One-screen state of a Flagsmith experiment, read-only, keys never printed.
#   sh scripts/snapshot.sh <flag>
# Needs: flagsmith CLI v2 (logged in), node, and flagsmith.json from `flagsmith init`.
set -eu
FLAG="${1:?usage: snapshot.sh <flag>}"
ENV=$(node -p "require('./flagsmith.json').environment" 2>/dev/null) || { echo "no flagsmith.json here: run flagsmith init" >&2; exit 2; }
B="api/v1/environments/$ENV"

echo "== experiment"
flagsmith api "$B/experiments/" --jq ".results[] | select(.feature.name == \"$FLAG\") | {id, name, status, started_at, metrics: [.metrics[].metric]}"
ID=$(flagsmith api "$B/experiments/" --jq "[.results[] | select(.feature.name == \"$FLAG\")][0].id" 2>/dev/null || true)

echo "== variations (each needs a key)"
flagsmith feature get "$FLAG" --json --jq '.variants[] | {id, key, value}'

echo "== metrics (event names are case-sensitive)"
flagsmith api "$B/experiment-metrics/" --jq '.results[] | {id, name, event: .definition.event, aggregation}'

echo "== warehouse"
flagsmith api "$B/warehouse-connections/" --jq '.[] | {warehouse_type, status, status_detail}'

if [ -n "${ID:-}" ] && [ "$ID" != "null" ]; then
  echo "== results (50 identities and 5 conversions per variation before inference)"
  flagsmith api "$B/experiments/$ID/results/" --jq '.results.payload.metrics[]? | {metric_id, identities: (.variants | map_values(.n)), conversions: (.variants | map_values(.sum))}'
fi
