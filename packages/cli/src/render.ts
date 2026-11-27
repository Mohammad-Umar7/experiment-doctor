import { redactSecrets, type Comparison, type Finding, type LayerStatus, type Report, type Verdict } from '@experiment-doctor/core';
import { visibleLength, type Palette } from './color';
import { renderDiff } from './patch';

const WIDTH = 92;

export function wrap(text: string, indent: string, width = WIDTH): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && visibleLength(indent + line + ' ' + w) > width) {
      lines.push(indent + line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

const code = (s: string, c: Palette) => s.replace(/`([^`]+)`/g, (_m, x: string) => c.info(x));

export function verdictBadge(v: Verdict, c: Palette): string {
  switch (v) {
    case 'HEALTHY':
      return c.healthy(c.bold('✓ HEALTHY'));
    case 'REPAIR_REQUIRED':
      return c.critical(c.bold('✕ REPAIR REQUIRED'));
    case 'PENDING':
      return c.warning(c.bold('◔ PENDING'));
    case 'UNVERIFIABLE':
      return c.muted(c.bold('? UNVERIFIABLE'));
  }
}

const STATUS: Record<LayerStatus, { glyph: string; word: string }> = {
  ok: { glyph: '✓', word: 'ok' },
  broken: { glyph: '✕', word: 'broken' },
  unknown: { glyph: '?', word: 'unknown' },
};

function tint(s: LayerStatus, c: Palette, text: string) {
  return s === 'ok' ? c.healthy(text) : s === 'broken' ? c.critical(text) : c.muted(text);
}

export function renderPipeline(report: Report, c: Palette): string {
  const top: string[] = [];
  const bottom: string[] = [];
  report.pipeline.forEach((n, i) => {
    const s = STATUS[n.status];
    const status = `${s.glyph} ${s.word}`;
    const last = i === report.pipeline.length - 1;
    const width = Math.max(n.label.length + 6, status.length + 2);
    top.push(last ? c.bold(n.label) : `${c.bold(n.label)}${c.muted(` ${'─'.repeat(width - n.label.length - 2)} `)}`);
    bottom.push(tint(n.status, c, last ? status : status.padEnd(width)));
  });
  return `  ${top.join('')}
  ${bottom.join('')}`;
}

function evidenceLines(f: Finding, c: Palette): string[] {
  const out: string[] = [];
  for (const e of f.evidence.slice(0, 5)) {
    const where = e.location ? `${e.location.file}:${e.location.line}` : e.source;
    out.push(`    ${c.info(where.padEnd(24))} ${code(e.label, c)}${e.value ? c.muted(`: ${e.value}`) : ''}`);
    if (e.location?.snippet) out.push(`    ${' '.repeat(24)} ${c.muted(redactSecrets(e.location.snippet))}`);
  }
  return out;
}

export function renderFinding(f: Finding, c: Palette, full = true): string {
  const sev = f.severity === 'critical' ? c.critical(f.severity) : f.severity === 'warning' ? c.warning(f.severity) : c.info(f.severity);
  const lines = [
    `  ${c.bold(code(f.title, c))}`,
    `  ${c.muted(`${f.id} · `)}${sev}${c.muted(` · ${f.layer} · ${Math.round(f.confidence * 100)}% confidence${f.kind === 'pending' ? ' · pending, not a failure' : ''}`)}`,
    '',
    wrap(code(f.detail, c), '  '),
  ];
  if (!full) return lines.join('\n');
  if (f.evidence.length) lines.push('', `  ${c.secondary('What we saw')}`, ...evidenceLines(f, c));
  lines.push('', `  ${c.secondary('Fix')}`, wrap(code(f.fix.summary, c), '    '));
  for (const s of f.fix.steps ?? []) lines.push(wrap(code(`· ${s}`, c), '    '));
  if (f.fix.patch) lines.push('', renderDiff(f.fix.patch, c).replace(/^/gm, '    '));
  if (f.fix.command) {
    lines.push('', `    ${c.accent('$')} ${f.fix.command.command}`);
    if (f.fix.command.input) lines.push(`      ${c.muted(`stdin: ${f.fix.command.input}`)}`);
    lines.push(`      ${f.fix.command.writes ? c.warning('changes Flagsmith: needs your approval') : c.muted('read only')}`);
  }
  return lines.join('\n');
}

export function renderReport(report: Report, c: Palette, opts: { notes?: string[]; savedTo?: string } = {}): string {
  const t = report.target;
  const head = [t.flag, t.experimentName && `"${t.experimentName}"`, t.environment].filter(Boolean).join(c.muted(' · '));
  const out = ['', `  ${c.accent('◆')} ${c.bold('Experiment Doctor')}  ${head}`, '', renderPipeline(report, c), '', `  ${verdictBadge(report.verdict, c)}`, wrap(code(report.summary, c), '  ')];
  const p = report.primaryFinding;
  if (p) out.push('', renderFinding(p, c, true));
  const others = report.findings.slice(p ? 1 : 0); // primaryFinding is findings[0]
  if (others.length) {
    out.push('', `  ${c.secondary('Also found')}`);
    for (const f of others) {
      const mark = f.severity === 'critical' ? c.critical('✕') : f.severity === 'warning' ? c.warning('!') : c.info('i');
      out.push(`    ${mark} ${c.muted(f.id)}  ${code(f.title, c)}`);
    }
  }
  if (report.upstream.length) {
    out.push('', `  ${c.secondary('Possibly related Flagsmith issues')} ${c.muted('(confirm the operation and error first; no patch)')}`);
    for (const u of report.upstream) {
      out.push(`    ${c.muted(`#${u.issue}`)} ${u.title} ${c.muted(`(${u.state} as of ${u.checkedOn}, ${Math.round(u.confidence * 100)}% match)`)}`);
      out.push(wrap(c.muted(u.workaround ? `Workaround: ${u.workaround}` : 'No workaround is documented.'), '      '));
      out.push(`      ${c.info(u.url)}`);
    }
  }
  if (opts.notes?.length) {
    out.push('', `  ${c.secondary('Notes')}`);
    for (const n of opts.notes) out.push(n.split('\n').map((l, i) => (i === 0 ? `    ${c.warning('!')} ${l}` : `      ${c.muted(l)}`)).join('\n'));
  }
  const count = (s: string) => report.checks.filter((x) => x.status === s).length;
  const tally = [`${count('pass')} pass`, `${count('fail')} fail`, `${count('skip')} skipped`, ...(count('pending') ? [`${count('pending')} pending`] : [])].join(' · ');
  out.push('', `  ${c.muted(`Checks: ${tally}`)}${opts.savedTo ? c.muted(`   Saved: ${opts.savedTo}`) : ''}`);
  const next = nextHint(report);
  if (next) out.push(`  ${c.accent('Next:')} ${next}`);
  out.push('');
  return out.join('\n');
}

function nextHint(report: Report): string {
  const p = report.primaryFinding;
  if (report.verdict === 'REPAIR_REQUIRED') return p?.fix.patch || p?.fix.command?.writes ? 'experiment-doctor fix   (shows the change and asks before writing)' : 'apply the fix above, then experiment-doctor verify';
  if (report.verdict === 'PENDING') return 'let traffic accumulate, then experiment-doctor verify';
  if (report.verdict === 'UNVERIFIABLE') return report.coverage.config ? 'experiment-doctor canary --environment <test env>  (optional active probe)' : 'log in to the Flagsmith CLI so the config can be checked: flagsmith login';
  return '';
}

export function renderComparison(cmp: Comparison, c: Palette): string {
  const badge = cmp.status === 'VERIFIED' ? c.healthy(c.bold('✓ VERIFIED')) : cmp.status === 'FAILED' ? c.critical(c.bold('✕ FAILED')) : c.warning(c.bold('◔ PENDING'));
  const lines = ['', `  ${badge}  ${code(cmp.message, c)}`, `  ${c.muted(`verdict: ${cmp.verdictBefore} → ${cmp.verdictAfter}`)}`];
  if (cmp.resolved.length) lines.push(`  ${c.healthy('resolved')}   ${cmp.resolved.join(', ')}`);
  if (cmp.remaining.length) lines.push(`  ${c.warning('remaining')}  ${cmp.remaining.join(', ')}`);
  if (cmp.introduced.length) lines.push(`  ${c.critical('new')}        ${cmp.introduced.join(', ')}`);
  lines.push('');
  return lines.join('\n');
}
