import { describe, expect, it } from 'vitest';
import { mapEnvironment, mapExperiment, mapFeatureGet, mapMetrics, mapResults, mapWarehouses, pickExperiment } from '../src/flagsmith/mappers';

// Shapes taken from Flagsmith/flagsmith api/experimentation/serializers.py
const experiments = {
  count: 3,
  results: [
    { id: 1, name: 'Old', status: 'completed', feature: { id: 7, name: 'checkout_button' }, created_at: '2026-10-01T00:00:00Z' },
    {
      id: 42,
      name: 'Checkout button',
      hypothesis: 'Green converts better',
      status: 'running',
      feature: {
        id: 7,
        name: 'checkout_button',
        type: 'MULTIVARIATE',
        initial_value: 'control',
        multivariate_options: [{ id: 11, uuid: 'u', type: 'unicode', string_value: 'green', integer_value: null, boolean_value: null, default_percentage_allocation: 50, key: null }],
      },
      metrics: [{ id: 5, metric: 3, metric_name: 'Purchases', aggregation: 'occurrence', direction: 'up', expected_direction: 'increase' }],
      started_at: '2026-11-20T10:00:00Z',
      ended_at: null,
      rollout_decision: null,
      created_at: '2026-11-19T00:00:00Z',
    },
    { id: 50, name: 'Other', status: 'created', feature: { id: 8, name: 'pricing' }, created_at: '2026-11-25T00:00:00Z' },
  ],
  status_counts: { created: 1, running: 1, paused: 0, completed: 1 },
};

describe('Flagsmith API mappers', () => {
  it('picks the running experiment of a flag', () => {
    expect(pickExperiment(experiments, { flag: 'checkout_button' })!.id).toBe(42);
    expect(pickExperiment(experiments, { experimentId: 50 })!.id).toBe(50);
    expect(pickExperiment(experiments, { flag: 'nope' })).toBeNull();
  });

  it('maps an experiment with rollout', () => {
    const e = mapExperiment({ ...experiments.results[1], experiment_rollout: { enabled: true, rollout_percentage: 25, feature_state_value: { type: 'unicode', value: 'control' } } })!;
    expect(e).toMatchObject({ id: 42, status: 'running', featureId: 7, featureName: 'checkout_button', metricIds: [3], rolloutDecision: null, rollout: { enabled: true, rolloutPercentage: 25 } });
  });

  it('maps variations from the nested feature and from `feature get --json`', () => {
    expect(mapFeatureGet(experiments.results[1]!.feature)!.variants).toEqual([{ id: 11, value: 'green', key: null, weight: 50 }]);
    expect(mapFeatureGet({ id: 7, name: 'checkout_button', type: 'MULTIVARIATE', default_value: 'control', enabled: true, variants: [{ id: 11, value: 'green', weight: 50, key: 'green' }] })).toEqual({
      id: 7,
      name: 'checkout_button',
      type: 'MULTIVARIATE',
      enabled: true,
      variants: [{ id: 11, value: 'green', key: 'green', weight: 50 }],
    });
  });

  it('maps metrics and warehouses', () => {
    expect(mapMetrics({ results: [{ id: 3, name: 'Purchases', aggregation: 'occurrence', direction: 'up', definition: { version: 1, event: 'purchase' } }] })).toEqual([
      { id: 3, name: 'Purchases', event: 'purchase', aggregation: 'occurrence', direction: 'up' },
    ]);
    expect(mapWarehouses([{ id: 1, warehouse_type: 'postgres', status: 'connected', status_detail: null, config: { source: 'flagsmith_database' }, total_events_received: 12, last_event_received_at: null }])).toEqual([
      { id: 1, type: 'postgres', status: 'connected', statusDetail: null, flagsmithDatabase: true, totalEventsReceived: 12, lastEventAt: null },
    ]);
  });

  it('maps results payloads, including null', () => {
    expect(mapResults({ results: null })).toBeNull();
    const r = mapResults(
      {
        results: {
          as_of: '2026-11-27T09:00:00Z',
          last_error_at: null,
          refresh_requested_at: null,
          is_final: false,
          payload: {
            srm_p_value: 0.41,
            metrics: [
              {
                metric_id: 3,
                variants: { control: { n: 310, sum: 31, sum_squares: 31 }, green: { n: 298, sum: 45, sum_squares: 45 } },
                inference: { control: null, green: { lift: 0.5, ci_low: 0.1, ci_high: 0.9, chance_to_win: 0.97 } },
                conversions_timeseries: null,
              },
            ],
            exposures_timeseries: { granularity: 'day', points: [] },
          },
        },
      },
      [{ id: 3, name: 'Purchases', event: 'purchase', aggregation: 'occurrence' }],
    )!;
    expect(r.srmPValue).toBe(0.41);
    expect(r.metrics[0]!.variants).toEqual([
      { variant: 'control', identities: 310, conversions: 31, chanceToWin: null },
      { variant: 'green', identities: 298, conversions: 45, chanceToWin: 0.97, lift: 0.5, ciLow: 0.1, ciHigh: 0.9 },
    ]);
  });

  it('masks the environment key and detects self-hosting', () => {
    expect(mapEnvironment({ name: 'Staging', api_key: 'aB3dE5fG7hJ9kL1mN3pQ5r' }, 'http://localhost:8000')).toEqual({ name: 'Staging', keyHint: 'aB3d…', apiUrl: 'http://localhost:8000', selfHosted: true });
  });
});
