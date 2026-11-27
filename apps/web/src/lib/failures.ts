/**
 * The failure catalog the Doctor checks for. IDs match the rules in packages/core.
 * Wording is written for people who just saw "0 conversions" and want the cause.
 */
export type Layer = "config" | "instrumentation" | "identity" | "transport" | "ingestion" | "results";

export type Failure = {
  id: string;
  title: string;
  layer: Layer;
  symptom: string;
  fix: string;
};

export const FAILURES: Failure[] = [
  {
    id: "ED-001",
    title: "Variation without a key",
    layer: "config",
    symptom: "Exposures panel stays empty for one variation.",
    fix: "Give every variation a key. Exposures are attributed by label.",
  },
  {
    id: "ED-002",
    title: "Flag fetched before identify()",
    layer: "identity",
    symptom: "No exposures at all, even with traffic.",
    fix: "Call identify() before getExperimentFlag(). Anonymous exposures are skipped.",
  },
  {
    id: "ED-003",
    title: "Two different identities",
    layer: "identity",
    symptom: "Exposures arrive, conversions never join them.",
    fix: "Use one identifier for the flag and the event, not user.id then user.email.",
  },
  {
    id: "ED-004",
    title: "Metric event name mismatch",
    layer: "results",
    symptom: "Events send fine, the metric stays at zero.",
    fix: "Event names are case-sensitive. 'Purchase' is not 'purchase'.",
  },
  {
    id: "ED-005",
    title: "Events never flushed",
    layer: "transport",
    symptom: "Works locally sometimes, loses events on navigation or exit.",
    fix: "Call flushEvents() before unload or process exit. Events buffer for 10s.",
  },
  {
    id: "ED-006",
    title: "Events sent to the wrong place",
    layer: "transport",
    symptom: "Self-hosted flags work, events never reach your instance.",
    fix: "Set the SDK events URL to your own API, ending in /api/.",
  },
  {
    id: "ED-007",
    title: "No warehouse connected",
    layer: "ingestion",
    symptom: "Every event is rejected by the ingestion service.",
    fix: "Connect a warehouse to the environment before starting the experiment.",
  },
  {
    id: "ED-008",
    title: "Experiment not running",
    layer: "config",
    symptom: "The flag serves control to everyone.",
    fix: "Start the experiment. Drafts and completed experiments enrol nobody.",
  },
  {
    id: "ED-009",
    title: "Events not enabled in the SDK",
    layer: "instrumentation",
    symptom: "Nothing is sent, nothing errors.",
    fix: "Pass enableEvents: true when you initialise the SDK.",
  },
  {
    id: "ED-010",
    title: "SDK too old for experiments",
    layer: "instrumentation",
    symptom: "getExperimentFlag is missing or silently does nothing.",
    fix: "Upgrade, e.g. @flagsmith/flagsmith 12.4.0 or @flagsmith/nodejs 9.1.0.",
  },
  {
    id: "ED-011",
    title: "Flag read without an exposure",
    layer: "instrumentation",
    symptom: "Users see variants but nobody is enrolled.",
    fix: "Use getExperimentFlag(), or trackExposureEvent() at the point of display.",
  },
  {
    id: "ED-012",
    title: "Still collecting data",
    layer: "results",
    symptom: "Results show nothing yet. Not broken.",
    fix: "Each variation needs 50 identities and 5 conversions. Results refresh every 5 minutes.",
  },
];

export const LAYER_LABEL: Record<Layer, string> = {
  config: "Configuration",
  instrumentation: "Instrumentation",
  identity: "Identity",
  transport: "Transport",
  ingestion: "Ingestion",
  results: "Results",
};
