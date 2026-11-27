import { useExperiment, useFlagsmith } from '@flagsmith/flagsmith/react';

export function App() {
  const flag = useExperiment('checkout_button');
  const flagsmith = useFlagsmith();
  const green = flag?.value === 'green';

  async function buy() {
    await fetch('/api/orders', { method: 'POST' });
    flagsmith.trackEvent('Purchase');
  }

  return (
    <button className={green ? 'btn btn-green' : 'btn'} onClick={buy}>
      Buy now
    </button>
  );
}
