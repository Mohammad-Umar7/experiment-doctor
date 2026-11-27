/**
 * @experiment-doctor/core
 *
 * Pure TypeScript (no Node APIs): evidence model, code scanner, diagnosis
 * rules, known-bug registry and report rendering. Safe to import in a browser.
 */
export * from './types';
export * from './constants';
export { diagnose, verdictOf, compareFindings, type DiagnoseOptions } from './diagnose';
export { buildPipeline, buildLayers, PIPELINE, LAYERS } from './pipeline';
export { toAgentSummary, nextStep, type AgentSummary } from './summary';
export { compareReports, type Verification, type PatchStatus, type PipelineStatus, type ExperimentLevelStatus, type PipelineProbe } from './compare';
export { scanFiles, type SourceFile, type ScanOptions } from './scanner/scan';
export { lex, LineIndex } from './scanner/lexer';
export { ALL_RULES, buildContext } from './rules';
export type { Rule, RuleContext, RuleOutcome } from './rules';
export { KNOWN_BUGS, matchKnownBugs, type KnownBug } from './registry/known-bugs';
export { renderHtmlReport } from './report/html';
export * as commands from './flagsmith/commands';
export { ENV_KEY_PLACEHOLDER, withEnvKey } from './flagsmith/commands';
export {
  listOf,
  mapEnvironment,
  mapExperiment,
  mapExperimentFeature,
  mapFeatureGet,
  mapMetrics,
  mapResults,
  mapWarehouses,
  pickExperiment,
} from './flagsmith/mappers';
export { redactSecrets, redactDeep, maskKey } from './util/redact';
export { compareNames, levenshtein, slugify } from './util/strings';
export { parseRange, parseVersion, compareVersions } from './util/semver';
export { eventsEndpoint, ensureTrailingSlash, isCloudUrl, selfHostedEventsUrl, stringLiteral, originOf, hostOf } from './util/urls';
