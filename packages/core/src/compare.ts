import type { Report, RuleId, Verdict } from './types';

/**
 * `verify` answers three different questions and never folds them into one
 * green check:
 *
 * - patch:      does the rule the last report targeted now pass? (static + config evidence)
 * - pipeline:   is there identity-level proof that an exposure and a conversion reached storage? (only from a probe;
 *               PIPELINE_FAILED when a fresh probe shows they did not)
 * - experiment: does the whole experiment pass every required check, with enough results data?
 */
export type PatchStatus = 'PATCH_VERIFIED' | 'PATCH_FAILED' | 'PATCH_UNVERIFIED' | 'NO_PATCH_TARGET';
export type PipelineStatus = 'PIPELINE_VERIFIED' | 'PIPELINE_FAILED' | 'PIPELINE_UNVERIFIED';
export type ExperimentLevelStatus = 'EXPERIMENT_HEALTHY' | 'EXPERIMENT_PENDING' | 'EXPERIMENT_REPAIR_REQUIRED' | 'EXPERIMENT_UNVERIFIABLE';

/** What the evidence is about. Every field must match the current report for it to count. */
export interface ProbeBinding {
  /** keyFingerprint() of the environment key the events were read from or sent to. */
  envFingerprint?: string;
  experimentId?: number;
  flag?: string;
  /** The conversion event the probe looked for. */
  event?: string;
}

/** What the last active probe (canary, or one identity read from the event store) established. */
export interface PipelineProbe {
  /**
   * IDENTITY_VERIFIED needs this identity's own exposure and conversion read back from storage.
   * UNAVAILABLE: the evidence could not be read (the reason is in `detail`).
   */
  status: 'IDENTITY_VERIFIED' | 'ACCEPTED' | 'FAILED' | 'PENDING' | 'UNAVAILABLE';
  at: string;
  identity: string;
  /** True only when the evidence is about this identity, not aggregate counters. */
  identityLevel: boolean;
  /** Where the identity's events came from: a canary over HTTP, or the app's own SDK traffic. */
  scope?: 'ingestion-http' | 'app-sdk';
  /** What the probe saw, in plain words. */
  detail?: string;
  binding?: ProbeBinding;
  /** Timestamp of the earliest event used as proof (the exposure). */
  evidenceAt?: string;
}

/** The current report's identity, which probe evidence must match, and the time it must postdate. */
export interface PipelineContext {
  envFingerprint?: string;
  experimentId?: number;
  flag?: string;
  /** Conversion events of the experiment's metrics. */
  events?: string[];
  /** Only evidence at or after this ISO time counts. */
  since: string;
  sinceReason: 'repair' | 'verify-start';
}

export interface Verification {
  v: 2;
  patch: { status: PatchStatus; target: RuleId | null; message: string };
  pipeline: { status: PipelineStatus; message: string; probe?: PipelineProbe };
  experiment: { status: ExperimentLevelStatus; verdict: Verdict; message: string };
  resolved: RuleId[];
  remaining: RuleId[];
  introduced: RuleId[];
  verdictBefore: Verdict;
  verdictAfter: Verdict;
}

const defects = (r: Report) => [...new Set(r.findings.filter((f) => f.kind === 'defect' && f.severity !== 'info').map((f) => f.id))];

const EXPERIMENT: Record<Verdict, ExperimentLevelStatus> = {
  HEALTHY: 'EXPERIMENT_HEALTHY',
  PENDING: 'EXPERIMENT_PENDING',
  REPAIR_REQUIRED: 'EXPERIMENT_REPAIR_REQUIRED',
  UNVERIFIABLE: 'EXPERIMENT_UNVERIFIABLE',
};

function patchStatus(before: Report, after: Report, introduced: RuleId[]): Verification['patch'] {
  const target = before.primaryFinding && before.primaryFinding.kind === 'defect' ? before.primaryFinding.id : null;
  if (!target) return { status: 'NO_PATCH_TARGET', target: null, message: 'The last report had no defect to repair.' };
  const still = after.findings.find((f) => f.id === target && f.kind === 'defect' && f.severity !== 'info');
  if (still) return { status: 'PATCH_FAILED', target, message: `${target} is still there: ${still.title}.` };
  if (introduced.length) {
    const first = after.findings.find((f) => f.id === introduced[0])!;
    return { status: 'PATCH_FAILED', target, message: `${target} is gone, but ${introduced.join(', ')} appeared: ${first.title}.` };
  }
  const check = after.checks.find((c) => c.id === target);
  if (check?.status !== 'pass') {
    return { status: 'PATCH_UNVERIFIED', target, message: `${target} no longer shows, but its check could not run (${check?.note ?? 'no evidence'}), so the patch is not verified.` };
  }
  return { status: 'PATCH_VERIFIED', target, message: `${target} check now passes on fresh static and config evidence.` };
}

function bindingProblem(probe: PipelineProbe, ctx: PipelineContext): string | null {
  const b = probe.binding;
  if (!b) return 'the probe records no environment, experiment, flag or event, so it cannot be tied to this report';
  if (!ctx.envFingerprint) return 'the current environment key is unknown, so the evidence cannot be tied to it';
  if (b.envFingerprint !== ctx.envFingerprint) return 'the evidence is for a different environment';
  if (ctx.experimentId === undefined) return 'the current experiment is unknown, so the evidence cannot be tied to it';
  if (b.experimentId !== ctx.experimentId) return `the evidence is for experiment ${b.experimentId ?? 'unknown'}, not ${ctx.experimentId}`;
  if (!ctx.flag || b.flag !== ctx.flag) return `the evidence is for flag "${b.flag ?? 'unknown'}", not "${ctx.flag ?? 'unknown'}"`;
  if (!ctx.events?.length || !b.event || !ctx.events.includes(b.event)) return `the evidence is for event "${b.event ?? 'unknown'}", not a metric event of this experiment`;
  return null;
}

function pipelineStatus(before: Report, probe: PipelineProbe | null | undefined, ctx?: PipelineContext): Verification['pipeline'] {
  if (!probe) {
    return { status: 'PIPELINE_UNVERIFIED', message: 'No probe ran: static and config checks cannot prove that events reach storage.' };
  }
  if (probe.status === 'UNAVAILABLE') {
    return { status: 'PIPELINE_UNVERIFIED', message: `Not verified: ${probe.detail ?? 'the evidence could not be read'}.`, probe };
  }
  const since = ctx?.since ?? before.generatedAt;
  const evidenceAt = probe.evidenceAt ?? probe.at;
  if (ctx) {
    const problem = bindingProblem(probe, ctx);
    if (problem) return { status: 'PIPELINE_UNVERIFIED', message: `Not verified: ${problem}.`, probe };
  }
  if (Date.parse(evidenceAt) < Date.parse(since)) {
    const when = ctx?.sinceReason === 'verify-start' ? `this verify run started (${since})` : `the repair (${since})`;
    return { status: 'PIPELINE_UNVERIFIED', message: `Not verified: the evidence for ${probe.identity} (${evidenceAt}) is older than ${when}, so it cannot prove it.`, probe };
  }
  if (probe.identityLevel && probe.status === 'IDENTITY_VERIFIED') {
    const via = probe.scope === 'app-sdk' ? "your app's SDK traffic" : probe.scope === 'ingestion-http' ? "a canary sent over HTTP (not your app's SDK path)" : 'a probe';
    return { status: 'PIPELINE_VERIFIED', message: `The event store holds the exposure and the conversion of ${probe.identity}, in order (identity-level, from ${via}).`, probe };
  }
  if (probe.status === 'FAILED') {
    return { status: 'PIPELINE_FAILED', message: `The probe for ${probe.identity} failed${probe.detail ? `: ${probe.detail}` : '.'}`, probe };
  }
  const why =
    probe.status === 'ACCEPTED'
      ? `the last canary (${probe.at}) was accepted by ingestion (HTTP 2xx), but Flagsmith offers no identity-level read to confirm it was stored`
      : `the evidence for ${probe.identity} is inconclusive${probe.detail ? ` (${probe.detail})` : ''}`;
  return { status: 'PIPELINE_UNVERIFIED', message: `Not verified: ${why}.`, probe };
}

/**
 * Compares a fresh report with the previous one. Pass `context` to bind probe
 * evidence to the current environment, experiment, flag and metric event, and
 * to a time window (the CLI always does).
 */
export function compareReports(before: Report, after: Report, probe?: PipelineProbe | null, context?: PipelineContext): Verification {
  const was = defects(before);
  const now = defects(after);
  const introduced = now.filter((id) => !was.includes(id));
  return {
    v: 2,
    patch: patchStatus(before, after, introduced),
    pipeline: pipelineStatus(before, probe, context),
    experiment: { status: EXPERIMENT[after.verdict], verdict: after.verdict, message: after.summary },
    resolved: was.filter((id) => !now.includes(id)),
    remaining: now.filter((id) => was.includes(id)),
    introduced,
    verdictBefore: before.verdict,
    verdictAfter: after.verdict,
  };
}
