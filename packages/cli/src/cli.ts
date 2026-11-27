import { realIo } from './io';
import { main } from './main';

main(process.argv.slice(2), realIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 70;
  },
);
