import flagsmith from '@flagsmith/flagsmith';
import { currentUser } from './session';

export function renderButton(variant: 'green' | 'control') {
  const button = document.querySelector<HTMLButtonElement>('#buy')!;
  button.classList.toggle('btn-green', variant === 'green');
  button.addEventListener('click', onBuy);
}

async function onBuy() {
  const user = currentUser();
  await fetch('/api/orders', { method: 'POST', body: JSON.stringify({ userId: user.id }) });
  await flagsmith.identify(user.email);
  flagsmith.trackEvent('purchase');
}
