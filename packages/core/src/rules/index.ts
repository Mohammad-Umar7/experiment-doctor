import { ed001 } from './ed001-variant-key';
import { ed002 } from './ed002-no-identify';
import { ed003 } from './ed003-identity-mismatch';
import { ed004 } from './ed004-metric-event-name';
import { ed005 } from './ed005-events-not-flushed';
import { ed006 } from './ed006-events-endpoint';
import { ed007 } from './ed007-no-warehouse';
import { ed008 } from './ed008-experiment-not-running';
import { ed009 } from './ed009-enable-events';
import { ed010 } from './ed010-sdk-too-old';
import { ed011 } from './ed011-no-exposure-call';
import { ed012 } from './ed012-results-collecting';
import { ed013 } from './ed013-no-metrics';
import { ed014 } from './ed014-sample-ratio';
import { ed015 } from './ed015-rollout-empty';
import { ed016 } from './ed016-no-events-received';
import type { Rule } from './types';

/**
 * Every rule, in priority order: environment and config blockers first, then
 * instrumentation, identity, transport, and finally results.
 */
export const ALL_RULES: Rule[] = [ed001, ed002, ed003, ed004, ed005, ed006, ed007, ed008, ed009, ed010, ed011, ed012, ed013, ed014, ed015, ed016].sort(
  (a, b) => a.rank - b.rank,
);

export { ed001, ed002, ed003, ed004, ed005, ed006, ed007, ed008, ed009, ed010, ed011, ed012, ed013, ed014, ed015, ed016 };
export type { Rule, RuleContext, RuleOutcome } from './types';
export { buildContext } from './context';
