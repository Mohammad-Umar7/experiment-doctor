import type { FixCommand } from '../types';

/**
 * Commands for the official Flagsmith CLI (v2). `<env-key>` is a placeholder
 * the Experiment Doctor CLI fills in at run time, so reports never carry keys.
 */

export const ENV_KEY_PLACEHOLDER = '<env-key>';

const envPath = (rest: string) => `api/v1/environments/${ENV_KEY_PLACEHOLDER}/${rest}`;

export function startExperimentCommand(experimentId: number, resume = false): FixCommand {
  return {
    command: `flagsmith api ${envPath(`experiments/${experimentId}/start/`)} -X POST`,
    writes: true,
    description: resume
      ? `Resume experiment ${experimentId}. This turns the rollout back on.`
      : `Start experiment ${experimentId}. This locks the flag and turns on the rollout.`,
  };
}

export function refreshResultsCommand(experimentId: number): FixCommand {
  return {
    command: `flagsmith api ${envPath(`experiments/${experimentId}/results/refresh/`)} -X POST`,
    writes: false,
    description: 'Ask Flagsmith to recompute results (allowed once every 5 minutes).',
  };
}

export function readResultsCommand(experimentId: number): FixCommand {
  return {
    command: `flagsmith api ${envPath(`experiments/${experimentId}/results/`)} --json`,
    writes: false,
    description: 'Read the latest computed results.',
  };
}

export function variantKeyCommand(flag: string, variants: { id: number; key: string }[]): FixCommand {
  return {
    command: variants.map((v) => `flagsmith feature variant update ${flag} ${v.id} --key ${v.key}`).join(' && '),
    writes: true,
    description: `Give ${variants.length === 1 ? 'the variation a key' : 'each variation a key'} so exposures are counted.`,
  };
}

export function listWarehousesCommand(): FixCommand {
  return {
    command: `flagsmith api ${envPath('warehouse-connections/')} --json --jq '.[] | {warehouse_type, status, status_detail}'`,
    writes: false,
    description: 'Check the warehouse connection for this environment.',
  };
}

export function connectFlagsmithDatabaseCommand(): FixCommand {
  return {
    command: `flagsmith api ${envPath('warehouse-connections/')} --input -`,
    input: JSON.stringify({ warehouse_type: 'postgres', config: { source: 'flagsmith_database' } }),
    writes: true,
    description: 'Self-hosted on PostgreSQL only: store experiment events in the Flagsmith database itself.',
  };
}

export function featureGetCommand(flag: string): FixCommand {
  return {
    command: `flagsmith feature get ${flag} --json --jq '.variants[] | {id, key, value}'`,
    writes: false,
    description: 'List the variations of the flag with their keys.',
  };
}

export function createExperimentHint(flag: string): FixCommand {
  return {
    command: `flagsmith api ${envPath('experiments/')} --input -`,
    input: JSON.stringify({
      feature: '<flag id>',
      name: `${flag} experiment`,
      hypothesis: '<what you expect to change>',
      metrics: [{ metric: '<metric id>', expected_direction: 'increase' }],
      experiment_rollout: {
        enabled: true,
        rollout_percentage: 100,
        feature_state_value: 'control',
        multivariate_feature_state_values: [{ multivariate_feature_option: '<variation id>', percentage_allocation: 50 }],
      },
    }),
    writes: true,
    description: 'Create the experiment (fill in the ids first). It starts in the "created" state.',
  };
}

/** Substitute the real environment key right before running. Never print the result. */
export function withEnvKey(command: string, envKey: string): string {
  return command.split(ENV_KEY_PLACEHOLDER).join(envKey);
}
