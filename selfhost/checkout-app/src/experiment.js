import flagsmith from "@flagsmith/flagsmith";

/** Starts Flagsmith with the events pipeline on and identifies the shopper. */
export async function startExperiment(user) {
  await flagsmith.init({
    environmentID: import.meta.env.VITE_FLAGSMITH_ENVIRONMENT_ID,
    enableEvents: true,
  });
  await flagsmith.identify(user.id);
  window.addEventListener("pagehide", () => flagsmith.flushEvents());
}

/** Reads the experiment flag where the button is rendered: this records the exposure. */
export function checkoutButtonVariant() {
  return flagsmith.getExperimentFlag("checkout_button")?.value ?? "control";
}
