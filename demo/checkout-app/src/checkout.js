import flagsmith from "@flagsmith/flagsmith";
import { checkoutButtonVariant, startExperiment } from "./experiment.js";

export async function mountCheckout(user, root) {
  await startExperiment(user);

  const button = document.createElement("button");
  button.textContent = checkoutButtonVariant() === "one_click" ? "Buy now" : "Proceed to checkout";
  button.addEventListener("click", async () => {
    await placeOrder();
    // Conversion for the checkout_button experiment
    flagsmith.trackEvent("Purchase");
  });
  root.append(button);
}

async function placeOrder() {
  await fetch("/api/orders", { method: "POST" });
}
