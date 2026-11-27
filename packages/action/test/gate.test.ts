import { describe, expect, it } from "vitest";
import { diagnose, scanFiles, type Evidence } from "@experiment-doctor/core";
import { findRenames, runGate, summaryMarkdown } from "../src/gate";

const HEALTHY = `import flagsmith from "@flagsmith/flagsmith";

await flagsmith.init({ environmentID: "env", enableEvents: true });
const user = await getCurrentUser();
await flagsmith.identify(user.id);

const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);

onPurchaseComplete(() => {
  flagsmith.trackEvent("purchase");
});

window.addEventListener("pagehide", () => flagsmith.flushEvents());
`;

const PKG = JSON.stringify({ dependencies: { "@flagsmith/flagsmith": "^12.6.0" } });

const config: Evidence["config"] = {
  source: "file",
  flag: { name: "checkout_button", variants: [{ id: 1, value: "one_click", key: "one_click" }] },
  metrics: [{ id: 1, name: "purchase", event: "purchase", aggregation: "occurrence" }],
};

function analyse(code: string) {
  const evidence = scanFiles([
    { path: "src/checkout.js", content: code },
    { path: "package.json", content: PKG },
  ]);
  return { code: evidence, report: diagnose({ schemaVersion: 1, config, code: evidence }) };
}

const gateConfig = { metrics: ["purchase"], failOn: "critical" as const, minConfidence: 0.8 };

describe("CI gate", () => {
  it("passes when nothing changes", () => {
    const base = analyse(HEALTHY);
    const head = analyse(HEALTHY);
    const result = runGate(base.report, head.report, { base: base.code, head: head.code }, gateConfig);
    expect(result.introduced).toEqual([]);
    expect(result.failing).toBe(false);
  });

  it("blocks a PR that renames the conversion event a metric listens for", () => {
    const base = analyse(HEALTHY);
    const head = analyse(HEALTHY.replace('trackEvent("purchase")', 'trackEvent("Purchase")'));
    const result = runGate(base.report, head.report, { base: base.code, head: head.code }, gateConfig);
    expect(result.renames).toEqual([expect.objectContaining({ from: "purchase", to: "Purchase", breaksMetric: true })]);
    expect(result.failing).toBe(true);
    expect(result.annotations.some((a) => a.level === "error" && a.file === "src/checkout.js")).toBe(true);
  });

  it("blocks a PR that moves the experiment flag above identify()", () => {
    const base = analyse(HEALTHY);
    const broken = HEALTHY.replace(
      `const user = await getCurrentUser();
await flagsmith.identify(user.id);

const flag = flagsmith.getExperimentFlag("checkout_button");`,
      `const flag = flagsmith.getExperimentFlag("checkout_button");
const user = await getCurrentUser();
await flagsmith.identify(user.id);`,
    );
    const head = analyse(broken);
    const result = runGate(base.report, head.report, { base: base.code, head: head.code }, gateConfig);
    expect(result.introduced.map((f) => f.id)).toContain("ED-002");
  });

  it("reports a fix instead of blocking when the PR repairs a defect", () => {
    const base = analyse(HEALTHY.replace('trackEvent("purchase")', 'trackEvent("Purchase")'));
    const head = analyse(HEALTHY);
    const result = runGate(base.report, head.report, { base: base.code, head: head.code }, gateConfig);
    expect(result.failing).toBe(false);
    expect(result.fixed.length).toBeGreaterThan(0);
  });

  it("does not block on findings that already existed at base", () => {
    const broken = HEALTHY.replace('trackEvent("purchase")', 'trackEvent("Purchase")');
    const base = analyse(broken);
    const head = analyse(broken + "\n// unrelated change\n");
    const result = runGate(base.report, head.report, { base: base.code, head: head.code }, gateConfig);
    expect(result.introduced).toEqual([]);
    expect(result.failing).toBe(false);
  });

  it("ignores renames to unrelated event names", () => {
    const base = analyse(HEALTHY);
    const head = analyse(HEALTHY.replace('trackEvent("purchase")', 'trackEvent("checkout_completed")'));
    expect(findRenames(base.code, head.code, ["purchase"])).toEqual([]);
  });

  it("writes a readable summary", () => {
    const base = analyse(HEALTHY);
    const head = analyse(HEALTHY.replace('trackEvent("purchase")', 'trackEvent("Purchase")'));
    const result = runGate(base.report, head.report, { base: base.code, head: head.code }, gateConfig);
    const md = summaryMarkdown(result, head.report);
    expect(md).toContain("blocked");
    expect(md).toContain("`purchase`");
  });
});
