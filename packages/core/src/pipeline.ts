import type { CheckResult, Finding, Layer, LayerStatus, PipelineNode, PipelineNodeId } from './types';
import type { Rule } from './rules/types';

export const PIPELINE: { id: PipelineNodeId; label: string }[] = [
  { id: 'app', label: 'App' },
  { id: 'sdk', label: 'SDK' },
  { id: 'flagsmith', label: 'Flagsmith' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'results', label: 'Results' },
];

export const LAYERS: Layer[] = ['config', 'instrumentation', 'identity', 'transport', 'ingestion', 'results'];

const blocking = (f: Finding) => f.kind === 'defect' && f.severity !== 'info';

/**
 * broken: a blocking finding we have evidence for.
 * ok: every required check passed (never green without evidence).
 * unknown: anything else, including pending data.
 */
function statusOf(checks: CheckResult[], findings: Finding[], optional: Set<string>): LayerStatus {
  if (findings.some(blocking)) return 'broken';
  const required = checks.filter((c) => !(optional.has(c.id) && c.status === 'skip'));
  if (required.length === 0) return 'unknown';
  return required.every((c) => c.status === 'pass') ? 'ok' : 'unknown';
}

export function buildPipeline(checks: CheckResult[], findings: Finding[], rules: Rule[]): PipelineNode[] {
  const optional = new Set(rules.filter((r) => r.optional).map((r) => r.id));
  return PIPELINE.map(({ id, label }) => {
    const nodeFindings = findings.filter((f) => f.node === id);
    return {
      id,
      label,
      status: statusOf(
        checks.filter((c) => c.node === id),
        nodeFindings,
        optional,
      ),
      findingIds: [...new Set(nodeFindings.map((f) => f.id))],
    };
  });
}

export function buildLayers(checks: CheckResult[], findings: Finding[], rules: Rule[]): Record<Layer, LayerStatus> {
  const optional = new Set(rules.filter((r) => r.optional).map((r) => r.id));
  const out = {} as Record<Layer, LayerStatus>;
  for (const layer of LAYERS) {
    out[layer] = statusOf(
      checks.filter((c) => c.layer === layer),
      findings.filter((f) => f.layer === layer),
      optional,
    );
  }
  return out;
}
