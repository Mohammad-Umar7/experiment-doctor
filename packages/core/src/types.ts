/**
 * Evidence, findings and reports.
 *
 * Convention used everywhere: a field that is `undefined` was NOT collected
 * (unknown), while `null` or an empty array means we looked and found nothing.
 * Rules must never turn "unknown" into "ok".
 */

export type Severity = 'critical' | 'warning' | 'info';

export type Layer =
  | 'config'
  | 'instrumentation'
  | 'identity'
  | 'transport'
  | 'ingestion'
  | 'results';

export type LayerStatus = 'ok' | 'broken' | 'unknown';

export type Verdict = 'HEALTHY' | 'REPAIR_REQUIRED' | 'PENDING' | 'UNVERIFIABLE';

/** The five boxes of the pipeline map: App -> SDK -> Flagsmith -> Warehouse -> Results. */
export type PipelineNodeId = 'app' | 'sdk' | 'flagsmith' | 'warehouse' | 'results';

export type RuleId =
  | 'ED-001'
  | 'ED-002'
  | 'ED-003'
  | 'ED-004'
  | 'ED-005'
  | 'ED-006'
  | 'ED-007'
  | 'ED-008'
  | 'ED-009'
  | 'ED-010'
  | 'ED-011'
  | 'ED-012'
  | 'ED-013'
  | 'ED-014'
  | 'ED-015'
  | 'ED-016';

export interface SourceLocation {
  /** Path relative to the scanned root, with forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The source line, trimmed, with secrets redacted. */
  snippet?: string;
  /** Exact line text, kept only when it holds no secret. Used to build patches. */
  text?: string;
}

// ---------------------------------------------------------------------------
// Config evidence (what Flagsmith says)
// ---------------------------------------------------------------------------

export type ExperimentStatus = 'created' | 'running' | 'paused' | 'completed';

export interface VariantEvidence {
  /** Multivariate option id. */
  id: number;
  value: string | number | boolean | null;
  /** Variation label. Unlabelled variations record no exposures. */
  key: string | null;
  /** Default percentage allocation, when known. */
  weight?: number;
}

export interface FlagEvidence {
  id?: number;
  name: string;
  type?: string;
  enabled?: boolean;
  variants: VariantEvidence[];
}

export interface MetricEvidence {
  id: number;
  name: string;
  /** The event name the metric counts. Case-sensitive. */
  event: string;
  /** occurrence | count | sum | mean */
  aggregation: string;
  direction?: string;
}

export interface RolloutEvidence {
  enabled: boolean;
  rolloutPercentage: number;
}

export interface ExperimentEvidence {
  id: number;
  name: string;
  status: ExperimentStatus | string;
  featureId?: number;
  featureName?: string;
  /** Ids of the metrics attached to the experiment. */
  metricIds: number[];
  startedAt?: string | null;
  endedAt?: string | null;
  rolloutDecision?: string | null;
  rollout?: RolloutEvidence | null;
}

export interface WarehouseEvidence {
  id: number;
  /** flagsmith | snowflake | clickhouse | databricks | postgres */
  type: string;
  /** created | pending_connection | connected | errored */
  status: string;
  statusDetail?: string | null;
  /** True when the Flagsmith database itself stores the events (self-hosted). */
  flagsmithDatabase?: boolean;
  totalEventsReceived?: number | null;
  lastEventAt?: string | null;
}

export interface VariantResultEvidence {
  /** Variant key ("control" for the flag's own value). */
  variant: string;
  /** Identities exposed (n). */
  identities: number;
  /** For occurrence metrics, identities that converted. */
  conversions?: number;
  /** Probability (0-1) that this variant beats control. */
  chanceToWin?: number | null;
  lift?: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
}

export interface MetricResultEvidence {
  metricId: number;
  aggregation?: string;
  variants: VariantResultEvidence[];
}

export interface ResultsEvidence {
  asOf?: string | null;
  isFinal?: boolean;
  lastErrorAt?: string | null;
  srmPValue?: number | null;
  metrics: MetricResultEvidence[];
}

export interface EnvironmentEvidence {
  name: string;
  /** Masked environment key, e.g. "ab12…". Never the full key. */
  keyHint?: string;
  /** Admin API base URL the CLI talks to (from flagsmith.json apiUrl). */
  apiUrl?: string;
  selfHosted?: boolean;
}

export interface ConfigEvidence {
  source: 'flagsmith-cli' | 'file';
  environment?: EnvironmentEvidence;
  /** `null`: we looked and there is no experiment for the flag. */
  experiment?: ExperimentEvidence | null;
  flag?: FlagEvidence | null;
  /** Metrics attached to the experiment (resolved from experiment-metrics). */
  metrics?: MetricEvidence[];
  warehouses?: WarehouseEvidence[];
  /** `null`: the experiment has no computed results yet. */
  results?: ResultsEvidence | null;
  /** Problems met while collecting (missing CLI, HTTP errors). Never contains secrets. */
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Code evidence (what the app does)
// ---------------------------------------------------------------------------

export type SdkKind = 'js' | 'node' | 'react-native' | 'unknown';

export interface SdkPackageEvidence {
  name: string;
  kind: SdkKind;
  /** Range from package.json, e.g. "^12.6.0". */
  range: string | null;
  /** Version actually installed (node_modules), when known. */
  installed?: string | null;
  manifest: SourceLocation;
}

export interface InitEvidence {
  loc: SourceLocation;
  sdk: 'js' | 'node';
  /** How the client is created: flagsmith.init, new Flagsmith, <FlagsmithProvider>. */
  style: 'init' | 'constructor' | 'provider';
  /** Literal "true"/"false", another expression, or null when absent. */
  enableEvents: string | null;
  enableEventsLoc?: SourceLocation;
  /** JS `api` or Node `apiUrl` value: a literal URL or an expression; null when absent. */
  apiUrl: string | null;
  apiUrlLoc?: SourceLocation;
  /** eventProcessorConfig.eventsApiUrl, null when absent. */
  eventsApiUrl: string | null;
  eventsApiUrlLoc?: SourceLocation;
  hasEventProcessorConfig: boolean;
  /** `enableAnalytics` is flag analytics, often mistaken for experiment events. */
  enableAnalytics?: string | null;
  /** JS init `identity` option, when present. */
  identityExpr?: string | null;
  /** Line after which a new option can be inserted (the line that opens the options object). */
  insertAfter?: SourceLocation;
  /** Indentation used by the properties of the options object. */
  propIndent?: string;
  /** Receiver variable for the client (flagsmith, client, ...). */
  client?: string;
  /**
   * The options are not fully visible: they contain a spread (`...options`) or
   * come from a variable or helper the scanner cannot read. Then enableEvents,
   * apiUrl and eventsApiUrl hold a value only when it is set after every
   * spread; null means UNKNOWN, not missing.
   */
  opaque?: boolean;
}

export interface IdentifyEvidence {
  loc: SourceLocation;
  /** The identifier expression, normalised (whitespace removed, ?. -> .). */
  expr: string;
  /** Raw argument text as written. */
  raw: string;
  via: 'identify' | 'init-identity' | 'getIdentityFlags' | 'getExperimentFlag' | 'trackExposureEvent';
  awaited: boolean;
  sdk: 'js' | 'node';
}

export interface ExperimentFlagCallEvidence {
  loc: SourceLocation;
  flag: string | null;
  method: 'getExperimentFlag' | 'useExperiment';
  sdk: 'js' | 'node';
  /** Node only: the identifier argument. */
  identifierExpr?: string | null;
  client?: string;
}

export interface PlainFlagReadEvidence {
  loc: SourceLocation;
  flag: string | null;
  method: string;
  client?: string;
}

export interface TrackEventEvidence {
  loc: SourceLocation;
  /** Resolved literal event name, or null when it is computed at runtime. */
  event: string | null;
  /** The first argument as written. */
  raw: string;
  /** The `identifier` option, normalised, when passed. */
  identifierExpr: string | null;
  identifierRaw?: string | null;
  sdk: 'js' | 'node';
  client?: string;
}

export interface ExposureCallEvidence {
  loc: SourceLocation;
  flag: string | null;
  identifierExpr: string | null;
}

export interface FlushEvidence {
  loc: SourceLocation;
  method: 'flushEvents' | 'close';
  client?: string;
  /** True when the call sits inside a pagehide/visibilitychange/beforeunload/SIGTERM handler. */
  inExitHandler?: boolean;
}

export type FileRuntime = 'browser' | 'react' | 'node-script' | 'node-server' | 'serverless' | 'unknown';

export interface ExitEvidence {
  loc: SourceLocation;
  kind: 'process.exit' | 'unload-handler' | 'signal-handler' | 'return';
}

export interface FileSummary {
  file: string;
  runtime: FileRuntime;
  usesFlagsmith: boolean;
}

export interface CodeEvidence {
  root?: string;
  scannedFiles: number;
  files: FileSummary[];
  packages: SdkPackageEvidence[];
  inits: InitEvidence[];
  identifies: IdentifyEvidence[];
  experimentFlags: ExperimentFlagCallEvidence[];
  plainFlagReads: PlainFlagReadEvidence[];
  trackEvents: TrackEventEvidence[];
  exposures: ExposureCallEvidence[];
  flushes: FlushEvidence[];
  exits: ExitEvidence[];
  /** True when the repo wires the Flagsmith MCP server (.mcp.json and friends). */
  usesFlagsmithMcp?: boolean;
  /** Code that updates an experiment with PUT or the MCP update_experiment tool (Flagsmith #9136). */
  experimentUpdates?: { loc: SourceLocation; via: 'mcp-update_experiment' | 'http-put' }[];
  /** Folders that hold a package.json ('' is the scan root): each is one app or package. */
  appRoots?: string[];
  /** Files left out because they are not app code. */
  skipped?: SkippedFile[];
}

export interface SkippedFile {
  file: string;
  reason: 'test' | 'bundle' | 'minified' | 'sdk-copy';
}

// ---------------------------------------------------------------------------
// Active probe evidence (canary)
// ---------------------------------------------------------------------------

export interface ProbeEvidence {
  identity: string;
  sentAt: string;
  /** Slowest request of the probe, in ms. */
  maxLatencyMs?: number;
  accepted?: number;
  rejected?: { index: number; error: string }[];
  httpStatus?: number;
}

export interface Evidence {
  schemaVersion: 1;
  collectedAt?: string;
  target?: { flag?: string; experimentId?: number };
  /** `null`: config evidence was not collected at all. */
  config: ConfigEvidence | null;
  /** `null`: code was not scanned. */
  code: CodeEvidence | null;
  probe?: ProbeEvidence | null;
}

// ---------------------------------------------------------------------------
// Findings and reports
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  /** What we saw, in plain words. */
  label: string;
  source: 'code' | 'config' | 'results' | 'probe' | 'registry';
  location?: SourceLocation;
  value?: string;
}

export interface Patch {
  file: string;
  /** 1-based line where `before` starts. */
  line: number;
  /** Exact current text of the affected line(s), joined with \n. */
  before: string;
  /** Replacement text, joined with \n. */
  after: string;
  /** True when the patch contains a placeholder the human must edit. */
  placeholder?: boolean;
}

export interface FixCommand {
  /** Shell command using the official Flagsmith CLI. `<env-key>` is substituted at run time. */
  command: string;
  /** JSON body piped to `--input -`, if any. */
  input?: string;
  /** True when the command changes Flagsmith state (needs approval). */
  writes: boolean;
  description: string;
}

export interface Fix {
  /** The fix in plain words. */
  summary: string;
  steps?: string[];
  patch?: Patch;
  command?: FixCommand;
  docs?: string;
}

export type FindingKind = 'defect' | 'pending';

export interface Finding {
  id: RuleId;
  severity: Severity;
  layer: Layer;
  node: PipelineNodeId;
  kind: FindingKind;
  title: string;
  detail: string;
  evidence: EvidenceItem[];
  fix: Fix;
  /** 0..1 */
  confidence: number;
}

/** pass: verified by evidence. fail: a blocking finding. skip: not enough evidence. pending: waiting for data. */
export type CheckStatus = 'pass' | 'fail' | 'skip' | 'pending';

export interface CheckResult {
  id: RuleId;
  title: string;
  layer: Layer;
  node: PipelineNodeId;
  status: CheckStatus;
  /** Why it was skipped, or what passing was based on. */
  note?: string;
}

export interface PipelineNode {
  id: PipelineNodeId;
  label: string;
  status: LayerStatus;
  findingIds: RuleId[];
}

export interface UpstreamMatch {
  issue: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  /** Date the issue state was last checked (YYYY-MM-DD). */
  checkedOn: string;
  confidence: number;
  matched: string[];
  workaround: string | null;
  workaroundSource: 'issue' | 'docs' | null;
  note: string;
}

export interface Report {
  schemaVersion: 1;
  tool: { name: 'experiment-doctor'; version: string };
  generatedAt: string;
  verdict: Verdict;
  /** One sentence for humans and agents. */
  summary: string;
  target: {
    flag?: string;
    experimentId?: number;
    experimentName?: string;
    environment?: string;
    /** In a monorepo: the app folder that was diagnosed ('' or '.' is the root). */
    app?: string;
    /** Other app folders with Flagsmith code that were not mixed in (diagnose them with --dir). */
    otherApps?: string[];
  };
  layers: Record<Layer, LayerStatus>;
  pipeline: PipelineNode[];
  /** Sorted by priority, defects before pending items. */
  findings: Finding[];
  primaryFinding: Finding | null;
  checks: CheckResult[];
  upstream: UpstreamMatch[];
  coverage: { config: boolean; code: boolean; probe: boolean };
}
