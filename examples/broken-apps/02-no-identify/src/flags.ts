import flagsmith from '@flagsmith/flagsmith';
import type { User } from './session';

export const CHECKOUT_FLAG = 'checkout_button';

export async function startFlags(user: User) {
  await flagsmith.init({
    environmentID: import.meta.env.VITE_FLAGSMITH_ENVIRONMENT_ID,
    enableEvents: true,
  });
  const flag = flagsmith.getExperimentFlag(CHECKOUT_FLAG);
  return flag?.value === 'green' ? 'green' : 'control';
}

export function flushOnExit() {
  window.addEventListener('pagehide', () => {
    void flagsmith.flushEvents();
  });
}
