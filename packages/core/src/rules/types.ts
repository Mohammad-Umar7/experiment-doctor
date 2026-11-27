import type {
  CheckStatus,
  CodeEvidence,
  ConfigEvidence,
  Evidence,
  ExperimentEvidence,
  Finding,
  Layer,
  MetricEvidence,
  PipelineNodeId,
  RuleId,
} from '../types';

export interface RuleContext {
  evidence: Evidence;
  config: ConfigEvidence | null;
  code: CodeEvidence | null;
  /** The flag under test: config flag, else the experiment's feature, else --flag. */
  flagKey: string | null;
  /** undefined: not collected. null: there is no experiment. */
  experiment: ExperimentEvidence | null | undefined;
  metrics: MetricEvidence[] | undefined;
  /** When the evidence was collected (keeps diagnose deterministic). */
  now: Date | null;
}

export interface RuleOutcome {
  status: CheckStatus;
  findings?: Finding[];
  /** Why the rule passed or was skipped. Shown in reports. */
  note?: string;
}

export interface Rule {
  id: RuleId;
  title: string;
  layer: Layer;
  node: PipelineNodeId;
  /** Lower runs first in the report when severities tie. */
  rank: number;
  run(ctx: RuleContext): RuleOutcome;
}
