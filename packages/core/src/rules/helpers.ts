import type { EvidenceItem, Finding, Fix, Patch, SourceLocation } from '../types';
import type { Rule, RuleOutcome } from './types';

type FindingInput = Omit<Finding, 'id' | 'layer' | 'node' | 'kind'> & Partial<Pick<Finding, 'kind' | 'layer' | 'node'>>;

export function makeFinding(rule: Pick<Rule, 'id' | 'layer' | 'node'>, input: FindingInput): Finding {
  return {
    id: rule.id,
    layer: input.layer ?? rule.layer,
    node: input.node ?? rule.node,
    kind: input.kind ?? 'defect',
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    evidence: input.evidence,
    fix: input.fix,
    confidence: Math.max(0, Math.min(1, Math.round(input.confidence * 100) / 100)),
  };
}

export const pass = (note?: string): RuleOutcome => (note ? { status: 'pass', note } : { status: 'pass' });
export const skip = (note: string): RuleOutcome => ({ status: 'skip', note });
export const fail = (findings: Finding[], note?: string): RuleOutcome => (note ? { status: 'fail', findings, note } : { status: 'fail', findings });

export function codeItem(label: string, loc: SourceLocation, value?: string): EvidenceItem {
  const item: EvidenceItem = { label, source: 'code', location: { file: loc.file, line: loc.line, ...(loc.snippet ? { snippet: loc.snippet } : {}) } };
  if (value !== undefined) item.value = value;
  return item;
}

export function configItem(label: string, value?: string): EvidenceItem {
  return value === undefined ? { label, source: 'config' } : { label, source: 'config', value };
}

export function where(loc: SourceLocation): string {
  return `${loc.file}:${loc.line}`;
}

const indentOf = (text: string) => /^\s*/.exec(text)?.[0] ?? '';

/** Replace the first `from` on the line with `to`. Null when the line text is unknown or lacks `from`. */
export function replaceInLine(loc: SourceLocation, from: string, to: string): Patch | null {
  if (loc.text === undefined || !loc.text.includes(from) || from === to) return null;
  return { file: loc.file, line: loc.line, before: loc.text, after: loc.text.replace(from, to) };
}

/** Insert a new line before `loc`, using the same indentation. */
export function insertBefore(loc: SourceLocation, line: string, placeholder = false): Patch | null {
  if (loc.text === undefined) return null;
  const p: Patch = { file: loc.file, line: loc.line, before: loc.text, after: `${indentOf(loc.text)}${line}\n${loc.text}` };
  if (placeholder) p.placeholder = true;
  return p;
}

/** Insert new lines after `loc`, with the given indentation. */
export function insertAfter(loc: SourceLocation, lines: string[], indent: string, placeholder = false): Patch | null {
  if (loc.text === undefined) return null;
  const p: Patch = { file: loc.file, line: loc.line, before: loc.text, after: [loc.text, ...lines.map((l) => `${indent}${l}`)].join('\n') };
  if (placeholder) p.placeholder = true;
  return p;
}

/**
 * Rewrites `<recv>.method(args)` on one line into `<recv>.newMethod(args)<suffix>`.
 * Only works when the whole call sits on the line.
 */
export function rewriteCall(loc: SourceLocation, method: string, newMethod: string, suffix = ''): Patch | null {
  const text = loc.text;
  if (text === undefined) return null;
  const at = text.search(new RegExp(`\\.\\s*${method}\\s*\\(`));
  if (at < 0) return null;
  const open = text.indexOf('(', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;
  const call = text.slice(at, close + 1).replace(new RegExp(`^\\.\\s*${method}`), `.${newMethod}`);
  const after = `${text.slice(0, at)}${call}${suffix}${text.slice(close + 1)}`;
  return { file: loc.file, line: loc.line, before: text, after };
}

export function withPatch(fix: Fix, patch: Patch | null): Fix {
  return patch ? { ...fix, patch } : fix;
}

export function quoteLike(raw: string, value: string): string {
  const q = /^\s*(['"`])/.exec(raw)?.[1] ?? "'";
  return `${q}${value}${q}`;
}
