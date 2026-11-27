import type { Report, RuleId, Verdict } from './types';

/**
 * `verify` answers three different questions and never folds them into one
 * green check:
 *
 * - patch:      does the rule the last report targeted now pass? (static + config evidence)
 * - pipeline:   is there identity-level proof that an exposure and a conversion reached storage? (only from a probe)
 * - experiment: does the whole experiment pass every required check, with enough results data?
 */
export type PatchStatus = 'PATCH_VERIFIED' | 'PATCH_FAILED' | 'PATCH_UNVERIFIED' | 'NO_PATCH_TARGET';
export type PipelineStatus = 'PIPELINE_VERIFIED' | 'PIPELINE_UNVERIFIED';
export type ExperimentLevelStatus = 'EXPERIMENT_HEALTHY' | 'EXPERIMENT_PENDING' | 'EXPERIMENT_REPAIR_REQUIRED' | 'EXPERIMENT_UNVERIFIABLE';

/** What the last active probe (canary) established. */
export interface PipelineProbe {
  /** IDENTITY_VERIFIED needs this identity's own exposure and conversion read back from Flagsmith. */
  status: 'IDENTITY_VERIFIED' | 'ACCEPTED' | 'FAILED' | 'PENDING';
  at: string;
  identity: string;
  /** True only when the evidence is about this identity, not aggregate counters. */
  identityLevel: boolean;
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

function pipelineStatus(before: Report, probe: PipelineProbe | null | undefined): Verification['pipeline'] {
  if (!probe) {
    return { status: 'PIPELINE_UNVERIFIED', message: 'No probe ran: static and config checks cannot prove that events reach storage.' };
  }
  const fresh = probe.at >= before.generatedAt;
  if (probe.identityLevel && probe.status === 'IDENTITY_VERIFIED' && fresh) {
    return { status: 'PIPELINE_VERIFIED', message: `Flagsmith shows the exposure and conversion of ${probe.identity}.`, probe };
  }
  const why =
    probe.status === 'ACCEPTED'
      ? `the last canary (${probe.at}) was accepted by ingestion (HTTP 2xx), but Flagsmith offers no identity-level read to confirm it was stored`
      : probe.status === 'FAILED'
        ? `the last canary (${probe.at}) failed`
        : `the last canary (${probe.at}) is still pending`;
  return { status: 'PIPELINE_UNVERIFIED', message: `Not verified: ${why}${fresh ? '' : ', and it ran before the last check'}.`, probe };
}

/** Compares a fresh report with the previous one. */
export function compareReports(before: Report, after: Report, probe?: PipelineProbe | null): Verification {
  const was = defects(before);
  const now = defects(after);
  const introduced = now.filter((id) => !was.includes(id));
  return {
    v: 2,
    patch: patchStatus(before, after, introduced),
    pipeline: pipelineStatus(before, probe),
    experiment: { status: EXPERIMENT[after.verdict], verdict: after.verdict, message: after.summary },
    resolved: was.filter((id) => !now.includes(id)),
    remaining: now.filter((id) => was.includes(id)),
    introduced,
    verdictBefore: before.verdict,
    verdictAfter: after.verdict,
  };
}
