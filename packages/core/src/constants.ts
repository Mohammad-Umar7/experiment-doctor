/** Facts from the Flagsmith docs and source that the rules depend on. */

export const TOOL_NAME = 'experiment-doctor' as const;
export const TOOL_VERSION = '0.2.0';

export const DOCS = {
  runExperiment: 'https://docs.flagsmith.com/experimentation/run-an-experiment',
  codingAgent: 'https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent',
  cli: 'https://docs.flagsmith.com/integrating-with-flagsmith/CLI',
} as const;

/** Below these per-variant floors Flagsmith shows "collecting data" instead of inference. */
export const RESULTS_MIN_IDENTITIES_PER_VARIANT = 50;
export const RESULTS_MIN_CONVERSIONS_PER_VARIANT = 5;
/** Below this p-value the traffic split does not match the configured weights. */
export const SRM_P_VALUE_THRESHOLD = 0.001;
export const SRM_MIN_TOTAL_IDENTITIES = 100;
export const RESULTS_REFRESH_MINUTES = 5;
/** SDKs buffer events and send them every 10 seconds by default. */
export const EVENTS_FLUSH_INTERVAL_SECONDS = 10;

export const CONTROL_VARIANT_KEY = 'control';
export const EXPOSURE_EVENT_NAME = '$flag_exposure';

export const DEFAULT_EVENTS_API_URL = 'https://events.api.flagsmith.com/';
export const DEFAULT_SDK_API_URL = 'https://edge.api.flagsmith.com/api/v1/';
export const CLOUD_HOSTS = [
  'api.flagsmith.com',
  'edge.api.flagsmith.com',
  'events.api.flagsmith.com',
  'app.flagsmith.com',
] as const;

export interface SdkRequirement {
  /** npm package name */
  name: string;
  kind: 'js' | 'node' | 'react-native';
  /** Minimum version that can send experiment events, or null when the package never can. */
  minVersion: string | null;
  /** Package to move to when this one cannot send events. */
  replacement?: string;
  /** Latest release we know of (Nov 2026), used when suggesting an upgrade. */
  recommended?: string;
  note: string;
}

export const SDK_REQUIREMENTS: SdkRequirement[] = [
  {
    name: '@flagsmith/flagsmith',
    kind: 'js',
    minVersion: '12.4.0',
    recommended: '12.6.0',
    note: 'JavaScript and React SDK. Experiment exposures need 12.4.0 or newer.',
  },
  {
    name: '@flagsmith/nodejs',
    kind: 'node',
    minVersion: '9.1.0',
    recommended: '9.5.0',
    note: 'Node.js SDK. Experiment events need 9.1.0 or newer.',
  },
  {
    name: 'flagsmith-nodejs',
    kind: 'node',
    minVersion: null,
    replacement: '@flagsmith/nodejs',
    note: 'The old Node.js package name (before 9.0.0). It cannot send experiment events.',
  },
  {
    name: 'flagsmith',
    kind: 'js',
    minVersion: null,
    replacement: '@flagsmith/flagsmith',
    note: 'The old unscoped JavaScript package (last release 10.x). It has no getExperimentFlag or trackEvent.',
  },
  {
    name: 'react-native-flagsmith',
    kind: 'react-native',
    minVersion: null,
    replacement: '@flagsmith/flagsmith',
    note: 'Not listed by Flagsmith as an SDK that can send experiment events.',
  },
];

/** Experiment statuses from api/experimentation/models.py. */
export const EXPERIMENT_STATUSES = ['created', 'running', 'paused', 'completed'] as const;
