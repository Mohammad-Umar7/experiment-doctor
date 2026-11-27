import { TOOL_VERSION } from '@experiment-doctor/core';
import { UsageError } from './args';
import { makePalette } from './color';
import { canaryCommand } from './commands/canary';
import { checkCommand } from './commands/check';
import { fixCommand } from './commands/fix';
import { verifyCommand } from './commands/verify';
import { FlagsmithError } from './flagsmith';
import type { Io } from './io';

export const HELP = `experiment-doctor ${TOOL_VERSION}
Find out why your Flagsmith experiment is flatlining, fix it with your approval, and prove it.

Usage: experiment-doctor <command> [options]

Commands
  check     passive, read-only diagnosis of Flagsmith config + your code
  fix       show the primary finding's patch or flagsmith command, apply after y/N
  verify    re-run check and compare with the last report (VERIFIED / FAILED / PENDING)
  canary    active probe: one exposure + one conversion for a doctor-canary identity
            in an environment you name, after you confirm

Run experiment-doctor <command> --help for options.
Agents: add --json for compact machine output.`;

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  const c = makePalette(io.env, io.stderr.isTTY);
  try {
    switch (command) {
      case 'check':
        return await checkCommand(io, rest);
      case 'fix':
        return await fixCommand(io, rest);
      case 'verify':
        return await verifyCommand(io, rest);
      case 'canary':
        return await canaryCommand(io, rest);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        io.stdout.write(`${HELP}\n`);
        return 0;
      case '--version':
      case '-v':
      case 'version':
        io.stdout.write(`${TOOL_VERSION}\n`);
        return 0;
      default:
        throw new UsageError(`Unknown command "${command}".\n\n${HELP}`);
    }
  } catch (err) {
    if (err instanceof UsageError || err instanceof FlagsmithError) {
      io.stderr.write(`${c.critical('error')} ${err.message}\n`);
      return 2;
    }
    io.stderr.write(`${c.critical('unexpected error')} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return 70;
  }
}
