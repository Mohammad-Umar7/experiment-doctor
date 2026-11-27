import type { CheckResult, Finding, LayerStatus, Patch, PipelineNode, Report, UpstreamMatch, Verdict } from '../types';
import { redactDeep } from '../util/redact';

/**
 * A single self-contained HTML report (no external requests), dark theme,
 * tokens from docs/design.md. Green only for verified, red only for evidenced
 * failures, gray for unknown; every status has an icon and a label.
 */

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const md = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const VERDICT: Record<Verdict, { label: string; icon: string; cls: string }> = {
  HEALTHY: { label: 'Healthy', icon: '✓', cls: 'ok' },
  REPAIR_REQUIRED: { label: 'Repair required', icon: '✕', cls: 'bad' },
  PENDING: { label: 'Pending data', icon: '◔', cls: 'wait' },
  UNVERIFIABLE: { label: 'Not verifiable', icon: '?', cls: 'unk' },
};

const NODE: Record<LayerStatus, { icon: string; label: string; cls: string }> = {
  ok: { icon: '✓', label: 'Verified', cls: 'ok' },
  broken: { icon: '✕', label: 'Broken', cls: 'bad' },
  unknown: { icon: '?', label: 'Not verified', cls: 'unk' },
};

const CHECK: Record<CheckResult['status'], { icon: string; cls: string }> = {
  pass: { icon: '✓', cls: 'ok' },
  fail: { icon: '✕', cls: 'bad' },
  skip: { icon: '–', cls: 'unk' },
  pending: { icon: '◔', cls: 'wait' },
};

const CSS = `
:root{--canvas:#090B0F;--surface:#11141B;--elevated:#181C25;--border:#272D38;--healthy:#22FF88;--critical:#FF5263;--accent:#6837FC;--warning:#F5B942;--info:#60A5FA;--text:#F1F4F8;--text2:#A0A8B8;--muted:#778195;
--sans:"Geist","Geist Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
*{box-sizing:border-box}html{background:var(--canvas)}body{margin:0;background:var(--canvas);color:var(--text);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
main{max-width:1040px;margin:0 auto;padding:48px 24px 96px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;color:var(--text2);font-size:13px;letter-spacing:.02em}
.brand b{color:var(--text);font-weight:600}.dot{width:10px;height:10px;border-radius:3px;background:var(--accent)}
h1{font-size:32px;font-weight:600;letter-spacing:-.03em;margin:16px 0 4px}h2{font-size:16px;font-weight:600;margin:0 0 12px}h3{font-size:15px;font-weight:600;margin:0}
.meta{color:var(--muted);font:13px/1.5 var(--mono)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;margin-top:24px;box-shadow:0 8px 32px rgba(0,0,0,.24)}
.verdict{display:inline-flex;align-items:center;gap:10px;padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--elevated);font-weight:600}
.verdict .i{font:600 14px var(--mono)}
.ok{color:var(--healthy)}.bad{color:var(--critical)}.wait{color:var(--warning)}.unk{color:var(--muted)}
.verdict.ok{box-shadow:0 0 24px rgba(34,255,136,.12)}.verdict.bad{box-shadow:0 0 20px rgba(255,82,99,.10)}
.summary{color:var(--text2);margin:12px 0 0;max-width:72ch}
.ecg{width:100%;height:56px;margin-top:20px}
.pipe{display:grid;grid-template-columns:repeat(5,1fr);gap:0;align-items:start;margin-top:8px}
.node{text-align:center;position:relative}
.node:not(:last-child)::after{content:"";position:absolute;top:22px;left:calc(50% + 26px);right:calc(-50% + 26px);height:2px;background:var(--border)}
.node.ok:not(:last-child)::after{background:linear-gradient(90deg,var(--healthy),var(--border))}
.ring{width:44px;height:44px;margin:0 auto;border-radius:50%;display:grid;place-items:center;border:2px solid currentColor;background:var(--elevated);font:600 16px var(--mono)}
.node .l{display:block;margin-top:8px;color:var(--text);font-weight:600;font-size:14px}.node .s{display:block;font-size:12px}
.tag{display:inline-block;font:12px/1 var(--mono);padding:4px 8px;border-radius:6px;border:1px solid var(--border);color:var(--text2);margin-right:6px}
.tag.critical{color:var(--critical);border-color:rgba(255,82,99,.4)}.tag.warning{color:var(--warning);border-color:rgba(245,185,66,.4)}.tag.info{color:var(--info);border-color:rgba(96,165,250,.4)}
.tag.approve{color:#fff;background:var(--accent);border-color:var(--accent)}
.finding h3{margin:10px 0 6px;font-size:18px;letter-spacing:-.01em}.detail{color:var(--text2);margin:0 0 16px}
ul.ev{list-style:none;padding:0;margin:0 0 16px}ul.ev li{padding:8px 0;border-top:1px solid var(--border);font-size:14px}
.loc{font:13px var(--mono);color:var(--info)}.snip{display:block;font:13px/1.5 var(--mono);color:var(--text2);white-space:pre-wrap;word-break:break-word}
code{font:13px var(--mono);background:var(--elevated);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.fix{background:var(--elevated);border:1px solid var(--border);border-radius:12px;padding:16px}
.fix p{margin:0 0 8px}.fix ol{margin:8px 0 0;padding-left:20px;color:var(--text2)}
pre{margin:12px 0 0;padding:12px 14px;background:var(--canvas);border:1px solid var(--border);border-radius:8px;overflow:auto;font:13px/1.55 var(--mono)}
.del{color:var(--critical);display:block}.add{color:var(--healthy);display:block}.hd{color:var(--muted);display:block}
details{border-top:1px solid var(--border);padding:12px 0}details summary{cursor:pointer;list-style:none;display:flex;gap:10px;align-items:center}details summary::-webkit-details-marker{display:none}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 10px;border-top:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
td.id{font:13px var(--mono);white-space:nowrap}td.note{color:var(--text2)}
a{color:var(--info)}footer{color:var(--muted);font-size:13px;margin-top:32px}
@media (max-width:640px){main{padding:32px 16px 64px}h1{font-size:26px}.pipe{grid-template-columns:repeat(5,minmax(0,1fr))}.ring{width:36px;height:36px}.node:not(:last-child)::after{top:18px;left:calc(50% + 20px);right:calc(-50% + 20px)}.node .s{display:none}}
`;

function ecg(verdict: Verdict): string {
  const flat = 'M0 28 H1000';
  const beat = 'M0 28 H170 l10 -6 l10 6 h20 l8 10 l12 -34 l12 40 l8 -16 h40 H470 l10 -6 l10 6 h20 l8 10 l12 -34 l12 40 l8 -16 h40 H770 l10 -6 l10 6 h20 l8 10 l12 -34 l12 40 l8 -16 h40 H1000';
  const colour = verdict === 'HEALTHY' ? 'var(--healthy)' : verdict === 'REPAIR_REQUIRED' ? 'var(--critical)' : 'var(--muted)';
  const d = verdict === 'HEALTHY' ? beat : flat;
  return `<svg class="ecg" viewBox="0 0 1000 56" preserveAspectRatio="none" role="img" aria-label="${verdict === 'HEALTHY' ? 'Heartbeat: healthy' : 'Flatline: no verified signal'}"><path d="${d}" fill="none" stroke="${colour}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function pipeline(nodes: PipelineNode[]): string {
  return `<div class="pipe" role="list" aria-label="Pipeline">${nodes
    .map((n) => {
      const s = NODE[n.status];
      return `<div class="node ${s.cls}" role="listitem"><span class="ring" aria-hidden="true">${s.icon}</span><span class="l">${esc(n.label)}</span><span class="s ${s.cls}">${s.label}${n.findingIds.length ? ` · ${esc(n.findingIds.join(', '))}` : ''}</span></div>`;
    })
    .join('')}</div>`;
}

function diff(p: Patch): string {
  const lines = [`<span class="hd">${esc(p.file)}:${p.line}${p.placeholder ? '  (contains a placeholder: edit before applying)' : ''}</span>`];
  for (const l of p.before.split('\n')) lines.push(`<span class="del">- ${esc(l)}</span>`);
  for (const l of p.after.split('\n')) lines.push(`<span class="add">+ ${esc(l)}</span>`);
  return `<pre aria-label="Proposed patch">${lines.join('')}</pre>`;
}

function finding(f: Finding, primary: boolean): string {
  const evidence = f.evidence
    .map(
      (e) =>
        `<li>${md(e.label)}${e.value ? ` <code>${esc(e.value)}</code>` : ''}${e.location ? `<br><span class="loc">${esc(e.location.file)}:${e.location.line}</span>${e.location.snippet ? `<span class="snip">${esc(e.location.snippet)}</span>` : ''}` : ''}</li>`,
    )
    .join('');
  const cmd = f.fix.command
    ? `<pre aria-label="Command">${esc(f.fix.command.command)}${f.fix.command.input ? `\n<span class="hd"># stdin</span>${esc(f.fix.command.input)}` : ''}</pre><p style="margin-top:8px">${f.fix.command.writes ? '<span class="tag approve">Needs approval</span>' : '<span class="tag">Read only</span>'}${md(f.fix.command.description)}</p>`
    : '';
  const body = `<div class="tags"><span class="tag ${f.severity}">${f.severity}</span><span class="tag">${esc(f.id)}</span><span class="tag">${f.layer}</span><span class="tag">${Math.round(f.confidence * 100)}% confidence</span>${f.kind === 'pending' ? '<span class="tag">pending, not a failure</span>' : ''}</div>
<h3>${md(f.title)}</h3><p class="detail">${md(f.detail)}</p>
${evidence ? `<h2>What we saw</h2><ul class="ev">${evidence}</ul>` : ''}
<div class="fix"><h2>Fix</h2><p>${md(f.fix.summary)}</p>${f.fix.steps?.length ? `<ol>${f.fix.steps.map((s) => `<li>${md(s)}</li>`).join('')}</ol>` : ''}${f.fix.patch ? diff(f.fix.patch) : ''}${cmd}${f.fix.docs ? `<p style="margin-top:12px"><a href="${esc(f.fix.docs)}">Flagsmith docs</a></p>` : ''}</div>`;
  if (primary) return `<section class="card finding" aria-labelledby="primary"><h2 id="primary">Primary finding</h2>${body}</section>`;
  return `<details><summary><span class="tag ${f.severity}">${f.severity}</span><span class="tag">${esc(f.id)}</span>${md(f.title)}</summary><div style="padding-top:12px">${body}</div></details>`;
}

function upstream(u: UpstreamMatch[]): string {
  if (!u.length) return '';
  return `<section class="card"><h2>Possible upstream bugs</h2><p class="detail">These match known Flagsmith issues. They are not caused by your code, so the Doctor proposes no patch.</p>${u
    .map(
      (m) =>
        `<details><summary><span class="tag">#${m.issue}</span><span class="tag">${m.state}</span>${esc(m.title)}</summary><div style="padding-top:8px"><p class="detail">Matched: ${esc(m.matched.join('; '))}</p><p>${m.workaround ? `Workaround${m.workaroundSource ? ` (from the ${m.workaroundSource})` : ''}: ${md(m.workaround)}` : 'No workaround is documented.'}</p><p><a href="${esc(m.url)}">${esc(m.url)}</a></p></div></details>`,
    )
    .join('')}</section>`;
}

function checks(list: CheckResult[]): string {
  return `<section class="card"><h2>Checks</h2><table><thead><tr><th>Check</th><th>Status</th><th>Notes</th></tr></thead><tbody>${list
    .map((c) => {
      const s = CHECK[c.status];
      return `<tr><td class="id">${esc(c.id)}</td><td><span class="${s.cls}" aria-hidden="true">${s.icon}</span> ${esc(c.title)} <span class="${s.cls}">(${c.status})</span></td><td class="note">${md(c.note ?? '')}</td></tr>`;
    })
    .join('')}</tbody></table></section>`;
}

export function renderHtmlReport(input: Report, opts: { knownSecrets?: string[] } = {}): string {
  const report = redactDeep(input, opts.knownSecrets ?? []);
  const v = VERDICT[report.verdict];
  const t = report.target;
  const title = [t.flag, t.experimentName && `“${t.experimentName}”`, t.environment && `in ${t.environment}`].filter(Boolean).join(' ');
  // primaryFinding is always findings[0]
  const others = report.findings.slice(report.primaryFinding ? 1 : 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">
<title>Experiment Doctor report${t.flag ? ` · ${esc(t.flag)}` : ''}</title><style>${CSS}</style></head>
<body><main>
<header><div><div class="brand"><span class="dot" aria-hidden="true"></span><b>Experiment Doctor</b> · Flagsmith Experimentation</div>
<h1>${esc(title || 'Experiment report')}</h1><div class="meta">${esc(report.generatedAt)} · ${esc(report.tool.name)} ${esc(report.tool.version)}${report.target.experimentId !== undefined ? ` · experiment #${report.target.experimentId}` : ''}</div></div>
<div class="verdict ${v.cls}" role="status"><span class="i" aria-hidden="true">${v.icon}</span>${v.label}</div></header>
<section class="card" aria-label="Pipeline status"><p class="summary" style="margin-top:0">${md(report.summary)}</p>${ecg(report.verdict)}${pipeline(report.pipeline)}
<p class="meta" style="margin:16px 0 0">Evidence: ${report.coverage.config ? 'Flagsmith config' : 'no Flagsmith config'} · ${report.coverage.code ? 'code scan' : 'no code scan'}${report.coverage.probe ? ' · canary probe' : ''}. Gray means not verified.</p></section>
${report.primaryFinding ? finding(report.primaryFinding, true) : ''}
${others.length ? `<section class="card"><h2>Other findings (${others.length})</h2>${others.map((f) => finding(f, false)).join('')}</section>` : ''}
${upstream(report.upstream)}
${checks(report.checks)}
<footer>Generated by Experiment Doctor. Read-only diagnosis: nothing was changed in Flagsmith or your code. Keys are redacted.</footer>
</main></body></html>
`;
}
