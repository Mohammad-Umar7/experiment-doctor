/**
 * First-visit onboarding state. Everything lives in localStorage on the visitor's device;
 * nothing about onboarding is sent to the server or to Flagsmith.
 */
export const WELCOME_KEY = "ed:welcome:v1";
export const PLAY_TOUR_KEY = "ed:tour:play:v1";

/** Fired by the nav's Guide button. Pages with a tour listen for it; others open the welcome. */
export const OPEN_GUIDE_EVENT = "ed:open-guide";

export function seen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Storage blocked (private mode, embedded frame): treat as seen so nothing nags on every page.
    return true;
  }
}

export function markSeen(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

export function openGuide() {
  window.dispatchEvent(new Event(OPEN_GUIDE_EVENT));
}
