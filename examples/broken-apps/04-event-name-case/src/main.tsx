import flagsmith from '@flagsmith/flagsmith';
import { FlagsmithProvider } from '@flagsmith/flagsmith/react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getSession } from './session';

const session = getSession();

createRoot(document.getElementById('root')!).render(
  <FlagsmithProvider
    flagsmith={flagsmith}
    options={{
      environmentID: import.meta.env.VITE_FLAGSMITH_ENVIRONMENT_ID,
      enableEvents: true,
      identity: session.userId,
    }}
  >
    <App />
  </FlagsmithProvider>,
);

window.addEventListener('pagehide', () => {
  void flagsmith.flushEvents();
});
