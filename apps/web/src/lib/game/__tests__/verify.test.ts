import { describe, expect, it } from "vitest";
import { CASES } from "../cases";
import { verifyRepair } from "../verify";

const target = { flag: "checkout_button", metric: "purchase" };

/** Correct repairs, written the way a player would type them. */
const FIXES: Record<string, (code: string) => string> = {
  "001": (c) => c.replace('trackEvent("Purchase")', 'trackEvent("purchase")'),
  "002": (c) =>
    c
      .replace(
        `const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);

const user = await getCurrentUser();
await flagsmith.identify(user.id);`,
        `const user = await getCurrentUser();
await flagsmith.identify(user.id);

const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);`,
      ),
  "003": (c) =>
    c.replace(
      `flagsmith.trackEvent("purchase");
  window.location.assign("/thank-you");`,
      `flagsmith.trackEvent("purchase");
  await flagsmith.flushEvents();
  window.location.assign("/thank-you");`,
    ),
  "004": (c) => c.replace("await flagsmith.identify(user.email);", ""),
  "005": (c) =>
    c.replace("environmentID: process.env.FLAGSMITH_ENV_KEY,\n});", "environmentID: process.env.FLAGSMITH_ENV_KEY,\n  enableEvents: true,\n});"),
  "006": (c) =>
    c.replace(
      `const variant = flagsmith.getValue("checkout_button");
renderCheckoutButton(variant);`,
      `const flag = flagsmith.getExperimentFlag("checkout_button");
renderCheckoutButton(flag?.value);`,
    ),
};

describe("verifyRepair", () => {
  for (const c of CASES) {
    it(`case ${c.id} (${c.failureId}) is broken at ${c.brokenStage}`, () => {
      const result = verifyRepair(c.code, target);
      expect(result.ok).toBe(false);
      expect(result.brokenStage).toBe(c.brokenStage);
    });

    it(`case ${c.id} passes after the correct repair`, () => {
      const fixed = FIXES[c.id](c.code);
      expect(fixed).not.toBe(c.code);
      const result = verifyRepair(fixed, target);
      expect(result.checks.filter((k) => !k.ok)).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }

  it("rejects deleting the conversion", () => {
    const code = CASES[0].code.replace('flagsmith.trackEvent("Purchase");', "");
    expect(verifyRepair(code, target).ok).toBe(false);
  });

  it("rejects tracking the conversion before identify", () => {
    const code = `import flagsmith from "@flagsmith/flagsmith";
flagsmith.trackEvent("purchase");
await flagsmith.init({ environmentID: "x", enableEvents: true });
await flagsmith.identify(user.id);
const flag = flagsmith.getExperimentFlag("checkout_button");
window.addEventListener("pagehide", () => flagsmith.flushEvents());`;
    expect(verifyRepair(code, target).ok).toBe(false);
  });

  it("accepts an explicit identifier on the conversion", () => {
    const code = CASES[3].code.replace(
      'flagsmith.trackEvent("purchase");',
      'flagsmith.trackEvent("purchase", { identifier: user.id });',
    );
    expect(verifyRepair(code, target).ok).toBe(true);
  });

  it("reports syntax errors at the app stage", () => {
    const result = verifyRepair("await flagsmith.init({", target);
    expect(result.ok).toBe(false);
    expect(result.brokenStage).toBe("app");
  });
});
