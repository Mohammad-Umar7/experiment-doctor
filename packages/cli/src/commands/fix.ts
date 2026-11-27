import { redactDeep, withEnvKey, type Finding, type RuleId } from '@experiment-doctor/core';
import { experimentId, parse, TARGET_OPTIONS, UsageError } from '../args';
import { makePalette } from '../color';
import { FlagsmithCli } from '../flagsmith';
import type { Io } from '../io';
import { applyPatch, renderDiff } from '../patch';
import { renderFinding } from '../render';
import { authorizeMutation, loadPolicy, POLICY_FILE, splitCommand } from '../safety';
import { loadState, saveState, STATE_DIR, type SavedReport } from '../state';
import { performCheck, stateRoot } from './check';

export const FIX_HELP = `experiment-doctor fix: apply the primary finding's fix, with your approval

Usage: experiment-doctor fix [options]

  --finding <ED-xxx>      fix this finding instead of the primary one
  --yes                   apply exactly the change the last check showed, without the y/N
                          prompt (refused if a fresh diagnosis would apply anything else)
  --dry-run               show the change and stop
  --allow-env <key|name>  allowlist an environment for Flagsmith changes (repeatable);
                          or list it under "allowMutations" in ${POLICY_FILE}
  (plus --flag, --experiment, --dir, --evidence, --environment, --json as in check)

Code changes are shown as a diff; Flagsmith changes are shown as the exact
flagsmith command. Nothing is written without y. Flagsmith changes are refused
unless the environment is allowlisted (--yes never skips that). API keys are
never printed.`;

interface FixOutcome {
  finding: RuleId | null;
  action: 'patched' | 'ran-command' | 'declined' | 'dry-run' | 'manual' | 'nothing' | 'refused' | 'failed';
  file?: string;
  command?: string;
  message: string;
}

export async function fixCommand(io: Io, argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    ...TARGET_OPTIONS,
    finding: { type: 'string' },
    yes: { type: 'boolean', short: 'y', default: false },
    'dry-run': { type: 'boolean', default: false },
    'allow-env': { type: 'string', multiple: true },
  });
  if (values.help) {
    io.stdout.write(`${FIX_HELP}\n`);
    return 0;
  }
  const c = makePalette(io.env, io.stdout.isTTY);
  const out = (s: string) => {
    if (!values.json) io.stdout.write(`${s}\n`);
  };
  // --yes means "apply what the last check showed": keep that report as the baseline and bind to it.
  const baseline = values.yes ? loadState<SavedReport>(stateRoot(io, { dir: values.dir, evidence: values.evidence }), 'last-report.json') : null;
  const run = await performCheck(io, {
    flag: values.flag,
    experiment: experimentId(values.experiment),
    dir: values.dir,
    evidence: values.evidence,
    environment: values.environment,
    save: !values.yes,
  });
  const secrets = run.envKey ? [run.envKey] : [];
  const finish = (o: FixOutcome, code: number) => {
    if (o.action === 'patched' || o.action === 'ran-command') saveState(run.root, 'last-fix.json', { at: io.now().toISOString(), ...o }, secrets);
    if (values.json) io.stdout.write(`${JSON.stringify(redactDeep(o, secrets))}\n`);
    else out(`\n  ${o.action === 'patched' || o.action === 'ran-command' ? c.healthy('✓') : o.action === 'failed' || o.action === 'refused' ? c.critical('✕') : c.muted('·')} ${o.message}\n`);
    return code;
  };

  let finding: Finding | undefined;
  if (values.finding) {
    const id = values.finding.toUpperCase();
    finding = run.report.findings.find((f) => f.id === id);
    if (!finding) throw new UsageError(`${id} is not among the current findings (${run.report.findings.map((f) => f.id).join(', ') || 'none'}).`);
  } else {
    finding = run.report.primaryFinding ?? undefined;
  }
  if (!finding || finding.kind === 'pending') {
    return finish({ finding: finding?.id ?? null, action: 'nothing', message: finding ? `${finding.id} is pending data, not a defect: nothing to fix. Run experiment-doctor verify later.` : `Nothing to fix: ${run.report.summary}` }, 0);
  }

  if (values.yes) {
    const refusal = bindingRefusal(baseline, finding, values.finding, secrets);
    if (refusal) return finish({ finding: finding.id, action: 'refused', message: refusal }, 3);
  }

  out(`\n${renderFinding(redactDeep(finding, secrets), c, false)}\n`);
  const { patch, command } = finding.fix;
  const ask = async (question: string, expect: (a: string) => boolean): Promise<boolean> => {
    if (values.yes) return true;
    const answer = (await io.prompt(question)).trim();
    return expect(answer);
  };

  if (patch) {
    out(renderDiff(patch, c).replace(/^/gm, '  '));
    if (values['dry-run']) return finish({ finding: finding.id, action: 'dry-run', file: patch.file, message: 'Dry run: nothing written.' }, 0);
    const ok = await ask(`\n  Apply this change to ${patch.file}? [y/N] `, (a) => /^y(es)?$/i.test(a));
    if (!ok) return finish({ finding: finding.id, action: 'declined', file: patch.file, message: 'Not applied. Nothing was written.' }, 0);
    const res = applyPatch(run.root, patch);
    if (!res.ok) return finish({ finding: finding.id, action: 'failed', file: patch.file, message: res.reason }, 1);
    return finish({ finding: finding.id, action: 'patched', file: patch.file, message: `Patched ${patch.file}:${patch.line}${patch.placeholder ? ' (edit the placeholder)' : ''}. Next: experiment-doctor verify` }, 0);
  }

  if (command?.writes) {
    const envName = run.evidence.config?.environment?.name;
    out(`\n  ${c.accent('$')} ${command.command}${command.input ? `\n    ${c.muted(`stdin: ${command.input}`)}` : ''}\n  ${c.muted(command.description)}`);
    // Fail closed: only an explicitly allowlisted environment may be changed.
    const auth = authorizeMutation(loadPolicy(run.root, values['allow-env'] ?? []), { name: envName, key: run.envKey });
    if (values['dry-run']) {
      return finish({ finding: finding.id, action: 'dry-run', command: command.command, message: `Dry run: nothing changed in Flagsmith. ${auth.ok ? 'This environment is allowlisted.' : auth.reason}` }, 0);
    }
    if (!auth.ok) return finish({ finding: finding.id, action: 'refused', command: command.command, message: auth.reason }, 3);
    if (auth.warning) out(`  ${c.warning('!')} ${auth.warning}`);
    if (!run.envKey) {
      return finish({ finding: finding.id, action: 'manual', command: command.command, message: 'No live Flagsmith session (evidence file mode). Run the command above yourself.' }, 0);
    }
    const ok = await ask(`\n  Run this against environment "${envName ?? 'unknown'}"? [y/N] `, (a) => /^y(es)?$/i.test(a));
    if (!ok) return finish({ finding: finding.id, action: 'declined', command: command.command, message: 'Not run. Nothing changed in Flagsmith.' }, 0);
    const cli = new FlagsmithCli(io);
    cli.addSecret(run.envKey);
    for (const part of command.command.split(' && ')) {
      const argv2 = splitCommand(withEnvKey(part, run.envKey));
      if (argv2[0] !== 'flagsmith') return finish({ finding: finding.id, action: 'refused', command: part, message: 'Only flagsmith commands are run automatically.' }, 3);
      const res = await cli.run(argv2.slice(1), command.input);
      if (res.code !== 0) return finish({ finding: finding.id, action: 'failed', command: part, message: `flagsmith exited with ${res.code}: ${cli.clean(res.stderr || res.stdout)}` }, 1);
    }
    return finish({ finding: finding.id, action: 'ran-command', command: command.command, message: 'Done. Next: experiment-doctor verify' }, 0);
  }

  out(`\n  ${c.secondary('Fix')}\n  ${finding.fix.summary}${(finding.fix.steps ?? []).map((s) => `\n  · ${s}`).join('')}${command ? `\n  ${c.accent('$')} ${command.command}` : ''}`);
  return finish({ finding: finding.id, action: 'manual', message: 'No automatic change for this finding. Apply it by hand, then run experiment-doctor verify.' }, 0);
}

/**
 * `fix --yes` may only apply the change the human saw in the last check: same
 * finding, same patch (file, line, before, after) or same flagsmith command.
 * Returns why it refuses, or null when the fresh diagnosis matches.
 */
export function bindingRefusal(baseline: SavedReport | null, finding: Finding, requested: string | undefined, secrets: string[]): string | null {
  const rerun = 'Nothing was written. Run experiment-doctor check, review the change, then fix --yes (or drop --yes to review it here).';
  if (!baseline?.report) return `--yes only applies the change shown by the last check, and there is no ${STATE_DIR}/last-report.json. ${rerun}`;
  const saved = requested ? baseline.report.findings.find((f) => f.id === requested.toUpperCase()) : baseline.report.primaryFinding;
  if (!saved || saved.id !== finding.id) {
    return `The finding to fix changed since the last check (${saved?.id ?? 'none'} then, ${finding.id} now). ${rerun}`;
  }
  // The saved report is redacted; compare like with like.
  const fresh = redactDeep({ patch: finding.fix.patch ?? null, command: finding.fix.command ? { command: finding.fix.command.command, input: finding.fix.command.input ?? null } : null }, secrets);
  const shown = { patch: saved.fix.patch ?? null, command: saved.fix.command ? { command: saved.fix.command.command, input: saved.fix.command.input ?? null } : null };
  if (JSON.stringify(fresh.patch) !== JSON.stringify(shown.patch)) {
    const where = fresh.patch ? `${fresh.patch.file}:${fresh.patch.line}` : 'no patch';
    return `The patch fix would apply (${where}) differs from the one the last check showed (${shown.patch ? `${shown.patch.file}:${shown.patch.line}` : 'no patch'}). ${rerun}`;
  }
  if (JSON.stringify(fresh.command) !== JSON.stringify(shown.command)) {
    return `The flagsmith command fix would run differs from the one the last check showed. ${rerun}`;
  }
  return null;
}
