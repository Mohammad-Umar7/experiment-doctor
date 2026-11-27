import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The executable was not found. */
  notFound?: boolean;
}

export interface Writer {
  write(s: string): unknown;
  isTTY?: boolean;
}

/** Everything the CLI touches outside the file system, so tests can fake it. */
export interface Io {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: Writer;
  stderr: Writer;
  /** Ask one question; resolves to '' when there is no input. */
  prompt(question: string): Promise<string>;
  fetch: typeof fetch;
  /** Runs the official `flagsmith` CLI. */
  runFlagsmith(args: string[], input?: string): Promise<RunResult>;
  /** Runs any other program (no shell), e.g. docker or psql for --event-store. */
  runProcess(cmd: string, args: string[], input?: string): Promise<RunResult>;
  now(): Date;
  randomHex(bytes: number): string;
  sleep(ms: number): Promise<void>;
}

function run(cmd: string, args: string[], input: string | undefined, env: NodeJS.ProcessEnv, shell = false): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      // A shell is only used for the Windows .cmd shim; quote every argument for cmd.exe.
      const argv = shell ? args.map((a) => (/^[\w./:@=-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)) : args;
      child = spawn(cmd, argv, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell });
    } catch {
      resolve({ code: 127, stdout: '', stderr: '', notFound: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err: NodeJS.ErrnoException) => {
      resolve({ code: 127, stdout, stderr: stderr || err.message, notFound: err.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      const missing = shell && code !== 0 && /is not recognized as an internal or external command/i.test(stderr);
      resolve(missing ? { code: 127, stdout, stderr, notFound: true } : { code: code ?? 1, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function realIo(): Io {
  const bin = process.env.FLAGSMITH_CLI_BIN || 'flagsmith';
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    async prompt(question) {
      const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: !!process.stdin.isTTY });
      try {
        return await new Promise<string>((resolve) => {
          rl.on('close', () => resolve(''));
          rl.question(question).then(resolve, () => resolve(''));
        });
      } finally {
        rl.close();
      }
    },
    fetch: (...args) => fetch(...args),
    async runFlagsmith(args, input) {
      const first = await run(bin, args, input, process.env);
      // npm installs a .cmd shim on Windows, which spawn cannot start without a shell.
      if (first.notFound && process.platform === 'win32' && !bin.endsWith('.cmd')) {
        const viaCmd = await run(`${bin}.cmd`, args, input, process.env, true);
        if (!viaCmd.notFound) return viaCmd;
      }
      return first;
    },
    runProcess: (cmd, args, input) => run(cmd, args, input, process.env),
    now: () => new Date(),
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
