/**
 * Human vs Doctor cases. Each one is a small, realistic checkout script with exactly one
 * Flagsmith Experimentation bug from the failure catalog. The verifier in ./verify.ts
 * decides whether a repair works; it does not compare against the solution text.
 */
import type { StageKey } from "./verify";

export type HintCheck = { label: string; ok: boolean; detail?: string };

export type GameCase = {
  id: string;
  title: string;
  failureId: string;
  /** What the person on call sees. */
  symptom: string;
  file: string;
  code: string;
  /** Line numbers (1-based) of the bug, used only to highlight the diff after the case ends. */
  bugLines: number[];
  solution: string;
  brokenStage: StageKey;
  vitals: { exposures: number; conversions: number };
  config: {
    flag: string;
    variants: string[];
    metric: string;
    sdk: string;
    warehouse: "connected";
    experiment: "running";
  };
  /** Variant A: the full diagnostic report. */
  fullReport: HintCheck[];
  /** Variant B: one prioritized repair. Same evidence, presented as a single fix. */
  oneFix: { instruction: string; before: string; after: string };
};

const CONFIG = {
  flag: "checkout_button",
  variants: ["control", "one_click"],
  metric: "purchase",
  sdk: "@flagsmith/flagsmith 12.6.0",
  warehouse: "connected" as const,
  experiment: "running" as const,
};

const HEADER = `import flagsmith from "@flagsmith/flagsmith";
import { getCurrentUser, renderCheckoutButton, onPurchaseComplete } from "./shop";
`;

export const CASES: GameCase[] = [
  {
    id: "001",
    title: "The missing conversions",
    failureId: "ED-004",
    symptom: "248 people saw the new checkout button. Purchases are happening. The experiment shows zero conversions.",
    file: "checkout.js",
    code: `${HEADER}
await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
  enableEvents: true,
});

const user = await getCurrentUser();
await flagsmith.identify(user.id);

// The user sees the checkout button variant here
const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);

onPurchaseComplete(() => {
  flagsmith.trackEvent("Purchase");
});

window.addEventListener("pagehide", () => flagsmith.flushEvents());
`,
    bugLines: [17],
    solution: `flagsmith.trackEvent("purchase");`,
    brokenStage: "results",
    vitals: { exposures: 248, conversions: 0 },
    config: CONFIG,
    fullReport: [
      { label: "SDK initialised with events enabled", ok: true },
      { label: "User identified before the experiment flag", ok: true },
      { label: "Exposure recorded for checkout_button", ok: true },
      { label: "Events flushed before the page goes away", ok: true },
      { label: "Conversion sent by the same identity", ok: true },
      {
        label: "Conversion event matches the metric",
        ok: false,
        detail: "The metric expects purchase. The app sends Purchase. Event names are case-sensitive.",
      },
    ],
    oneFix: {
      instruction: "Rename the conversion event to match the metric exactly.",
      before: `flagsmith.trackEvent("Purchase");`,
      after: `flagsmith.trackEvent("purchase");`,
    },
  },
  {
    id: "002",
    title: "The invisible users",
    failureId: "ED-002",
    symptom: "The checkout button variants are live and traffic is normal. The Exposures panel is completely empty.",
    file: "checkout.js",
    code: `${HEADER}
await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
  enableEvents: true,
});

// Render as early as possible so the page feels fast
const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);

const user = await getCurrentUser();
await flagsmith.identify(user.id);

onPurchaseComplete(() => {
  flagsmith.trackEvent("purchase");
});

window.addEventListener("pagehide", () => flagsmith.flushEvents());
`,
    bugLines: [10, 11, 13, 14],
    solution: `const user = await getCurrentUser();
await flagsmith.identify(user.id);

const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);`,
    brokenStage: "flagsmith",
    vitals: { exposures: 0, conversions: 0 },
    config: CONFIG,
    fullReport: [
      { label: "SDK initialised with events enabled", ok: true },
      {
        label: "User identified before the experiment flag",
        ok: false,
        detail: "getExperimentFlag runs before identify(). Exposures without an identity are skipped silently.",
      },
      { label: "Exposure recorded for checkout_button", ok: false, detail: "No identity at the moment of exposure." },
      { label: "Events flushed before the page goes away", ok: true },
      { label: "Conversion sent by the same identity", ok: true },
      { label: "Conversion event matches the metric", ok: true },
    ],
    oneFix: {
      instruction: "Identify the user before you read the experiment flag.",
      before: `const flag = flagsmith.getExperimentFlag("checkout_button");
...
await flagsmith.identify(user.id);`,
      after: `await flagsmith.identify(user.id);
const flag = flagsmith.getExperimentFlag("checkout_button");`,
    },
  },
  {
    id: "003",
    title: "The lost buffer",
    failureId: "ED-005",
    symptom: "Exposures look healthy. Purchases redirect to a thank-you page. Conversions arrive for almost nobody.",
    file: "checkout.js",
    code: `${HEADER}
await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
  enableEvents: true,
});

const user = await getCurrentUser();
await flagsmith.identify(user.id);

const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);

onPurchaseComplete(async () => {
  flagsmith.trackEvent("purchase");
  window.location.assign("/thank-you");
});
`,
    bugLines: [16, 17],
    solution: `flagsmith.trackEvent("purchase");
await flagsmith.flushEvents();
window.location.assign("/thank-you");`,
    brokenStage: "sdk",
    vitals: { exposures: 311, conversions: 2 },
    config: CONFIG,
    fullReport: [
      { label: "SDK initialised with events enabled", ok: true },
      { label: "User identified before the experiment flag", ok: true },
      { label: "Exposure recorded for checkout_button", ok: true },
      {
        label: "Events flushed before the page goes away",
        ok: false,
        detail: "The SDK buffers events for about 10 seconds. The redirect unloads the page before they are sent.",
      },
      { label: "Conversion sent by the same identity", ok: true },
      { label: "Conversion event matches the metric", ok: true },
    ],
    oneFix: {
      instruction: "Send the buffered events before you redirect.",
      before: `flagsmith.trackEvent("purchase");
window.location.assign("/thank-you");`,
      after: `flagsmith.trackEvent("purchase");
await flagsmith.flushEvents();
window.location.assign("/thank-you");`,
    },
  },
  {
    id: "004",
    title: "Two faces",
    failureId: "ED-003",
    symptom: "Exposures are fine and the purchase event fires every time. Flagsmith still attributes zero conversions.",
    file: "checkout.js",
    code: `${HEADER}
await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
  enableEvents: true,
});

const user = await getCurrentUser();
await flagsmith.identify(user.id);

const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);

onPurchaseComplete(async () => {
  // Billing keys customers by email
  await flagsmith.identify(user.email);
  flagsmith.trackEvent("purchase");
});

window.addEventListener("pagehide", () => flagsmith.flushEvents());
`,
    bugLines: [17, 18],
    solution: `onPurchaseComplete(() => {
  flagsmith.trackEvent("purchase");
});`,
    brokenStage: "warehouse",
    vitals: { exposures: 196, conversions: 0 },
    config: CONFIG,
    fullReport: [
      { label: "SDK initialised with events enabled", ok: true },
      { label: "User identified before the experiment flag", ok: true },
      { label: "Exposure recorded for checkout_button", ok: true },
      { label: "Events flushed before the page goes away", ok: true },
      {
        label: "Conversion sent by the same identity",
        ok: false,
        detail: "Exposure uses user.id, the purchase uses user.email. Flagsmith joins them per identity, so they never meet.",
      },
      { label: "Conversion event matches the metric", ok: true },
    ],
    oneFix: {
      instruction: "Keep the same identity for the exposure and the purchase.",
      before: `await flagsmith.identify(user.email);
flagsmith.trackEvent("purchase");`,
      after: `flagsmith.trackEvent("purchase");`,
    },
  },
  {
    id: "005",
    title: "Silence",
    failureId: "ED-009",
    symptom: "Flags work, users see both buttons. Not one exposure, not one event, and no errors anywhere.",
    file: "checkout.js",
    code: `${HEADER}
await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
});

const user = await getCurrentUser();
await flagsmith.identify(user.id);

const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);

onPurchaseComplete(() => {
  flagsmith.trackEvent("purchase");
});

window.addEventListener("pagehide", () => flagsmith.flushEvents());
`,
    bugLines: [5, 6],
    solution: `await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
  enableEvents: true,
});`,
    brokenStage: "sdk",
    vitals: { exposures: 0, conversions: 0 },
    config: CONFIG,
    fullReport: [
      {
        label: "SDK initialised with events enabled",
        ok: false,
        detail: "init() is missing enableEvents: true. Without it every event call is a silent no-op.",
      },
      { label: "User identified before the experiment flag", ok: true },
      { label: "Exposure recorded for checkout_button", ok: false, detail: "Events are disabled." },
      { label: "Events flushed before the page goes away", ok: true },
      { label: "Conversion sent by the same identity", ok: true },
      { label: "Conversion event matches the metric", ok: true },
    ],
    oneFix: {
      instruction: "Turn the events pipeline on when you initialise the SDK.",
      before: `await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
});`,
      after: `await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
  enableEvents: true,
});`,
    },
  },
  {
    id: "006",
    title: "Seen but not counted",
    failureId: "ED-011",
    symptom: "Half the users get the one-click button, you can see it in session replays. Nobody is enrolled.",
    file: "checkout.js",
    code: `${HEADER}
await flagsmith.init({
  environmentID: process.env.FLAGSMITH_ENV_KEY,
  enableEvents: true,
});

const user = await getCurrentUser();
await flagsmith.identify(user.id);

const variant = flagsmith.getValue("checkout_button");
renderCheckoutButton(variant);

onPurchaseComplete(() => {
  flagsmith.trackEvent("purchase");
});

window.addEventListener("pagehide", () => flagsmith.flushEvents());
`,
    bugLines: [12],
    solution: `const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);`,
    brokenStage: "flagsmith",
    vitals: { exposures: 0, conversions: 0 },
    config: CONFIG,
    fullReport: [
      { label: "SDK initialised with events enabled", ok: true },
      { label: "User identified before the experiment flag", ok: true },
      {
        label: "Exposure recorded for checkout_button",
        ok: false,
        detail: "getValue() reads the flag without recording an exposure, so nobody is enrolled.",
      },
      { label: "Events flushed before the page goes away", ok: true },
      { label: "Conversion sent by the same identity", ok: true },
      { label: "Conversion event matches the metric", ok: true },
    ],
    oneFix: {
      instruction: "Read the flag with getExperimentFlag so the exposure is recorded.",
      before: `const variant = flagsmith.getValue("checkout_button");
renderCheckoutButton(variant);`,
      after: `const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);`,
    },
  },
];

export function getCase(id: string): GameCase | undefined {
  return CASES.find((c) => c.id === id);
}
