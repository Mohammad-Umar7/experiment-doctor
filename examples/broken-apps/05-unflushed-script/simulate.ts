import Flagsmith from '@flagsmith/nodejs';
import { visitor } from './users';

const flagsmith = new Flagsmith({
  environmentKey: process.env.FLAGSMITH_ENVIRONMENT_KEY!,
  enableEvents: true,
});

async function main() {
  const visitors = Number(process.argv[2] ?? 200);
  for (let i = 0; i < visitors; i++) {
    const user = visitor(i);
    const flag = await flagsmith.getExperimentFlag('checkout_button', user.id);
    const rate = flag.value === 'green' ? 0.14 : 0.1;
    if (Math.random() < rate) {
      flagsmith.trackEvent('purchase', { identifier: user.id });
    }
  }
  console.log(`simulated ${visitors} visitors`);
  process.exit(0);
}

main();
