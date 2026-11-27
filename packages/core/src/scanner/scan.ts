import type {
  CodeEvidence,
  ExitEvidence,
  ExperimentFlagCallEvidence,
  ExposureCallEvidence,
  FileRuntime,
  FileSummary,
  FlushEvidence,
  IdentifyEvidence,
  InitEvidence,
  PlainFlagReadEvidence,
  SdkPackageEvidence,
  SourceLocation,
  TrackEventEvidence,
} from '../types';
import { redactSecrets } from '../util/redact';
import { normaliseExpr } from '../util/strings';
import { stringLiteral } from '../util/urls';
import { lex, LineIndex } from './lexer';
import { isInstalledManifest, readInstalled, readManifest } from './packages';
import { findClose, lastIdent, parseObject, readCallArgs, receiverBefore, skipSpace, type Prop, type Span } from './syntax';

export interface SourceFile {
  /** Path relative to the scanned root. Backslashes are normalised. */
  path: string;
  content: string;
}

export interface ScanOptions {
  root?: string;
}

type Sdk = 'js' | 'node';

const CODE_EXT = /\.(?:[mc]?[jt]sx?)$/i;
const IGNORED = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.git|\.turbo|\.vercel|\.experiment-doctor)\//;
const MCP_FILES = /(^|\/)(\.mcp\.json|mcp\.json|claude_desktop_config\.json|\.cursor\/mcp\.json|\.vscode\/mcp\.json)$/;
const MAX_FILE_BYTES = 750_000;

const JS_PACKAGES = ['@flagsmith/flagsmith', 'flagsmith', 'react-native-flagsmith'];
const NODE_PACKAGES = ['@flagsmith/nodejs', 'flagsmith-nodejs'];

function sdkOfSpecifier(spec: string): Sdk | null {
  const base = spec.replace(/\/(react|isomorphic|next-middleware|src.*)$/, '');
  if (JS_PACKAGES.includes(base)) return 'js';
  if (NODE_PACKAGES.includes(base)) return 'node';
  return null;
}

interface ImportInfo {
  spec: string;
  sdk: Sdk | null;
  defaultName?: string;
  named: { imported: string; local: string }[];
}

interface FileCtx {
  path: string;
  code: string;
  skel: string;
  lines: LineIndex;
  imports: ImportInfo[];
  sdkHint: Sdk | null;
  clients: Map<string, Sdk>;
  nodeClasses: Set<string>;
  factories: Set<string>;
  flagsObjects: Set<string>;
  boundFns: Map<string, Sdk>;
  consts: Map<string, string>;
  exportedClients: Map<string, Sdk>;
  defaultExportClient: Sdk | null;
  handlerRanges: { start: number; end: number; kind: 'unload-handler' | 'signal-handler' }[];
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function makeLoc(ctx: FileCtx, offset: number): SourceLocation {
  const line = ctx.lines.lineOf(offset);
  const text = ctx.lines.lineText(line);
  const red = redactSecrets(text);
  const loc: SourceLocation = { file: ctx.path, line, snippet: truncate(red.trim(), 160) };
  if (red === text) loc.text = text;
  return loc;
}

const spanText = (ctx: FileCtx, s: Span | undefined) => (s ? ctx.code.slice(s.start, s.end).trim() : '');

function stripAsConst(text: string): string {
  return text.replace(/\s+as\s+const\s*$/, '').replace(/\s+as\s+[\w.<>[\]|' ]+$/, '').trim();
}

// ---------------------------------------------------------------------------
// pass 1: imports, bindings, constants
// ---------------------------------------------------------------------------

function parseImports(code: string): ImportInfo[] {
  const out: ImportInfo[] = [];
  const esm = /\bimport\s+(?:type\s+)?([A-Za-z_$][\w$]*)?\s*,?\s*(\{[^}]*\}|\*\s*as\s+[A-Za-z_$][\w$]*)?\s*from\s*(['"])([^'"\n]+)\3/g;
  for (const m of code.matchAll(esm)) {
    const spec = m[4]!;
    const info: ImportInfo = { spec, sdk: sdkOfSpecifier(spec), named: [] };
    if (m[1]) info.defaultName = m[1];
    const braces = m[2];
    if (braces?.startsWith('{')) info.named = parseNamed(braces.slice(1, -1), 'as');
    else if (braces) info.defaultName = info.defaultName ?? /as\s+([\w$]+)/.exec(braces)?.[1];
    out.push(info);
  }
  const cjs = /\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"\n]+)\2\s*\)(\.default|\.Flagsmith)?/g;
  for (const m of code.matchAll(cjs)) {
    const spec = m[3]!;
    const info: ImportInfo = { spec, sdk: sdkOfSpecifier(spec), named: [] };
    const lhs = m[1]!;
    if (lhs.startsWith('{')) info.named = parseNamed(lhs.slice(1, -1), ':');
    else if (m[4] === '.Flagsmith') info.named = [{ imported: 'Flagsmith', local: lhs }];
    else info.defaultName = lhs;
    out.push(info);
  }
  return out;
}

function parseNamed(inner: string, sep: 'as' | ':'): { imported: string; local: string }[] {
  return inner
    .split(',')
    .map((p) => p.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((p) => {
      const parts = sep === 'as' ? p.split(/\s+as\s+/) : p.split(/\s*:\s*/);
      return { imported: parts[0]!.trim(), local: (parts[1] ?? parts[0]!).trim() };
    });
}

function collectConsts(ctx: FileCtx): void {
  const { code, skel } = ctx;
  const simple = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+?)?=\s*(['"`])([^'"`$\n]*)\2/g;
  for (const m of code.matchAll(simple)) ctx.consts.set(m[1]!, m[3]!);
  const objects = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+?)?=\s*\{/g;
  for (const m of skel.matchAll(objects)) {
    const open = m.index! + m[0].length - 1;
    const obj = parseObject(code, skel, open);
    if (!obj) continue;
    for (const p of obj.props) {
      const v = stringLiteral(stripAsConst(p.value));
      if (v !== null) ctx.consts.set(`${m[1]}.${p.key}`, v);
    }
  }
  const enums = /\benum\s+([A-Za-z_$][\w$]*)\s*\{/g;
  for (const m of skel.matchAll(enums)) {
    const open = m.index! + m[0].length - 1;
    const close = findClose(skel, open);
    if (close < 0) continue;
    for (const member of code.slice(open + 1, close).split(',')) {
      const mm = /^\s*([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2/.exec(member);
      if (mm) ctx.consts.set(`${m[1]}.${mm[1]}`, mm[3]!);
    }
  }
}

function collectBindings(ctx: FileCtx): void {
  for (const imp of ctx.imports) {
    if (imp.sdk === 'js') {
      if (imp.defaultName && !/^(Flagsmith)?Provider$/.test(imp.defaultName)) ctx.clients.set(imp.defaultName, 'js');
      for (const n of imp.named) {
        if (n.imported === 'createFlagsmithInstance') ctx.factories.add(n.local);
        if (n.imported === 'default') ctx.clients.set(n.local, 'js');
      }
    } else if (imp.sdk === 'node') {
      if (imp.defaultName) ctx.nodeClasses.add(imp.defaultName);
      for (const n of imp.named) if (/^(Flagsmith|default)$/.test(n.imported)) ctx.nodeClasses.add(n.local);
    }
  }
  const { skel } = ctx;
  for (const m of skel.matchAll(/(?:\b(?:const|let|var)\s+|\bthis\.|\b)([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>.[\]| ]+)?=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const cls = m[2]!;
    if (ctx.nodeClasses.has(cls) || (cls === 'Flagsmith' && ctx.sdkHint !== 'js')) ctx.clients.set(m[1]!, 'node');
  }
  for (const m of skel.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    const fn = m[2]!;
    if (ctx.factories.has(fn) || fn === 'createFlagsmithInstance' || fn === 'useFlagsmith') ctx.clients.set(m[1]!, 'js');
  }
  // const { trackEvent, getExperimentFlag } = useFlagsmith()  /  = flagsmith
  for (const m of ctx.code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(useFlagsmith\s*\(\s*\)|[A-Za-z_$][\w$]*)/g)) {
    const rhs = m[2]!;
    const sdk = rhs.startsWith('useFlagsmith') ? 'js' : ctx.clients.get(rhs);
    if (!sdk) continue;
    for (const n of parseNamed(m[1]!, ':')) ctx.boundFns.set(n.local, sdk);
  }
  // flags objects from getIdentityFlags / getEnvironmentFlags
  for (const m of skel.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$.]+\.\s*get(?:Identity|Environment)Flags\s*\(/g)) {
    ctx.flagsObjects.add(m[1]!);
  }
  // exports
  for (const m of skel.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    const sdk = ctx.clients.get(m[1]!);
    if (sdk) ctx.exportedClients.set(m[1]!, sdk);
  }
  for (const m of skel.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const n of parseNamed(m[1]!, 'as')) {
      const sdk = ctx.clients.get(n.imported);
      if (sdk) ctx.exportedClients.set(n.local, sdk);
    }
  }
  const def = /\bexport\s+default\s+(new\s+([A-Za-z_$][\w$]*)|[A-Za-z_$][\w$]*)/.exec(skel);
  if (def) {
    if (def[2] && (ctx.nodeClasses.has(def[2]) || def[2] === 'Flagsmith')) ctx.defaultExportClient = 'node';
    else if (!def[2] && ctx.clients.has(def[1]!)) ctx.defaultExportClient = ctx.clients.get(def[1]!)!;
  }
}

function collectHandlers(ctx: FileCtx): void {
  const { skel, code } = ctx;
  const add = (callOpen: number, kind: 'unload-handler' | 'signal-handler') => {
    const close = findClose(skel, callOpen);
    if (close > 0) ctx.handlerRanges.push({ start: callOpen, end: close, kind });
  };
  for (const m of code.matchAll(/addEventListener\s*\(\s*(['"])(pagehide|visibilitychange|beforeunload|unload)\1/g)) {
    add(m.index! + m[0].indexOf('('), 'unload-handler');
  }
  for (const m of code.matchAll(/process\.(?:on|once)\s*\(\s*(['"])(SIGTERM|SIGINT|beforeExit|exit)\1/g)) {
    add(m.index! + m[0].indexOf('('), 'signal-handler');
  }
  for (const m of skel.matchAll(/\b(?:window\.)?on(?:beforeunload|pagehide)\s*=\s*/g)) {
    const start = m.index!;
    const brace = skel.indexOf('{', start);
    if (brace > 0 && brace - start < 80) {
      const close = findClose(skel, brace);
      if (close > 0) ctx.handlerRanges.push({ start, end: close, kind: 'unload-handler' });
    }
  }
}

// ---------------------------------------------------------------------------
// pass 2: calls
// ---------------------------------------------------------------------------

const METHODS =
  'getExperimentFlag|trackEvent|trackExposureEvent|flushEvents|close|identify|getValue|hasFeature|getAllFlags|getIdentityFlags|getEnvironmentFlags|getFeatureValue|isFeatureEnabled|getFlag|init';

const DISTINCTIVE = new Set(['getExperimentFlag', 'trackExposureEvent', 'getIdentityFlags', 'getEnvironmentFlags', 'flushEvents']);

interface Collected {
  inits: InitEvidence[];
  identifies: IdentifyEvidence[];
  experimentFlags: ExperimentFlagCallEvidence[];
  plainFlagReads: PlainFlagReadEvidence[];
  trackEvents: TrackEventEvidence[];
  exposures: ExposureCallEvidence[];
  flushes: FlushEvidence[];
  exits: ExitEvidence[];
}

function isAwaited(ctx: FileCtx, receiverStart: number, close: number): boolean {
  const before = ctx.skel.slice(Math.max(0, receiverStart - 24), receiverStart);
  if (/\b(await|return|yield)\s*\(?\s*$/.test(before)) return true;
  const after = ctx.skel.slice(close + 1, close + 40);
  return /^\s*\)?\s*\.\s*(then|finally)\s*\(/.test(after);
}

function objectProps(ctx: FileCtx, argText: string, argStart: number): Map<string, Prop> | null {
  const map = new Map<string, Prop>();
  let open = -1;
  if (argText.startsWith('{')) open = skipSpace(ctx.code, argStart);
  else if (/^[A-Za-z_$][\w$]*$/.test(argText)) {
    const re = new RegExp(`\\b(?:const|let|var)\\s+${argText.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\{`);
    const m = re.exec(ctx.skel);
    if (m) open = m.index + m[0].length - 1;
  }
  if (open < 0) return null;
  const obj = parseObject(ctx.code, ctx.skel, open);
  if (!obj) return null;
  for (const p of obj.props) map.set(p.key, p);
  return map;
}

function resolveName(ctx: FileCtx, global: Map<string, string>, raw: string): string | null {
  const text = stripAsConst(raw);
  const lit = stringLiteral(text);
  if (lit !== null) return lit;
  const id = text.replace(/\s+/g, '').replace(/\?\./g, '.');
  return ctx.consts.get(id) ?? global.get(id) ?? null;
}

function initFromObject(ctx: FileCtx, open: number, sdk: Sdk, style: InitEvidence['style'], callOffset: number, client?: string): InitEvidence | null {
  const obj = parseObject(ctx.code, ctx.skel, open);
  if (!obj) return null;
  const get = (k: string) => obj.props.find((p) => p.key === k);
  const looksLikeFlagsmith = obj.props.some((p) => /^(environmentID|environmentKey|enableEvents|eventProcessorConfig|api|apiUrl|identity)$/.test(p.key));
  if (!looksLikeFlagsmith && style === 'init') return null;
  const api = sdk === 'node' ? get('apiUrl') ?? get('api') : get('api') ?? get('apiUrl');
  const epc = get('eventProcessorConfig');
  let eventsApiUrl: string | null = null;
  let eventsApiUrlLoc: SourceLocation | undefined;
  if (epc && epc.value.startsWith('{')) {
    const inner = parseObject(ctx.code, ctx.skel, epc.valueOffset);
    const ev = inner?.props.find((p) => p.key === 'eventsApiUrl');
    if (ev) {
      eventsApiUrl = ev.value;
      eventsApiUrlLoc = makeLoc(ctx, ev.keyOffset);
    }
  }
  const openLine = ctx.lines.lineOf(open);
  const closeLine = ctx.lines.lineOf(obj.close);
  const first = obj.props[0];
  let propIndent = `${/^\s*/.exec(ctx.lines.lineText(openLine))?.[0] ?? ''}  `;
  if (first && ctx.lines.lineOf(first.keyOffset) !== openLine) {
    propIndent = /^\s*/.exec(ctx.lines.lineText(ctx.lines.lineOf(first.keyOffset)))?.[0] ?? propIndent;
  }
  const init: InitEvidence = {
    loc: makeLoc(ctx, callOffset),
    sdk,
    style,
    enableEvents: get('enableEvents')?.value ?? null,
    apiUrl: api?.value ?? null,
    eventsApiUrl,
    hasEventProcessorConfig: !!epc,
    propIndent,
  };
  const enable = get('enableEvents');
  if (enable) init.enableEventsLoc = makeLoc(ctx, enable.keyOffset);
  if (api) init.apiUrlLoc = makeLoc(ctx, api.keyOffset);
  if (eventsApiUrlLoc) init.eventsApiUrlLoc = eventsApiUrlLoc;
  const analytics = get('enableAnalytics');
  if (analytics) init.enableAnalytics = analytics.value;
  const identity = get('identity');
  if (identity) init.identityExpr = normaliseExpr(identity.value);
  if (openLine !== closeLine) init.insertAfter = makeLoc(ctx, open);
  if (client) init.client = client;
  return init;
}

function collectCalls(ctx: FileCtx, global: Map<string, string>, out: Collected, globalClients: Map<string, Sdk>): void {
  const { code, skel } = ctx;
  const callRe = new RegExp(`\\.\\s*(${METHODS})\\s*(?:<[^>()]*>)?\\s*\\(`, 'g');

  const sdkFor = (clientName: string, fallback?: Sdk): Sdk =>
    ctx.clients.get(clientName) ?? globalClients.get(clientName) ?? ctx.sdkHint ?? fallback ?? 'js';

  const handle = (method: string, recv: string, recvStart: number, open: number, bare: boolean) => {
    const call = readCallArgs(skel, open);
    if (!call) return;
    const args = call.args;
    const a0 = spanText(ctx, args[0]);
    const a1 = spanText(ctx, args[1]);
    const name = bare ? recv : lastIdent(recv);
    const known = bare || ctx.clients.has(name) || globalClients.has(name);
    const flagsmithish = known || /flagsmith/i.test(recv);
    const at = makeLoc(ctx, recvStart);
    const client = bare ? undefined : name || undefined;

    if (!DISTINCTIVE.has(method)) {
      if (['getFeatureValue', 'isFeatureEnabled', 'getFlag'].includes(method)) {
        if (!(ctx.flagsObjects.has(name) || /flags/i.test(name) || ctx.sdkHint === 'node')) return;
      } else if (!flagsmithish) return;
    }

    switch (method) {
      case 'getExperimentFlag': {
        const sdk = args.length >= 2 ? 'node' : sdkFor(name, 'js');
        const ev: ExperimentFlagCallEvidence = { loc: at, flag: resolveName(ctx, global, a0), method: 'getExperimentFlag', sdk };
        if (client) ev.client = client;
        if (sdk === 'node') {
          ev.identifierExpr = args[1] ? normaliseExpr(a1) : null;
          if (args[1]) out.identifies.push({ loc: at, expr: normaliseExpr(a1), raw: a1, via: 'getExperimentFlag', awaited: true, sdk });
        }
        out.experimentFlags.push(ev);
        return;
      }
      case 'trackEvent': {
        const sdk = sdkFor(name);
        const opts = args[1] ? objectProps(ctx, a1, args[1].start) : null;
        const idProp = opts?.get('identifier');
        const ev: TrackEventEvidence = {
          loc: at,
          event: resolveName(ctx, global, a0),
          raw: a0,
          identifierExpr: idProp ? normaliseExpr(idProp.value) : null,
          sdk,
        };
        if (idProp) ev.identifierRaw = idProp.value;
        if (client) ev.client = client;
        out.trackEvents.push(ev);
        return;
      }
      case 'trackExposureEvent': {
        const opts = args[1] ? objectProps(ctx, a1, args[1].start) : null;
        const idProp = opts?.get('identifier');
        const expr = idProp ? normaliseExpr(idProp.value) : null;
        out.exposures.push({ loc: at, flag: resolveName(ctx, global, a0), identifierExpr: expr });
        if (expr && idProp) out.identifies.push({ loc: at, expr, raw: idProp.value, via: 'trackExposureEvent', awaited: true, sdk: sdkFor(name) });
        return;
      }
      case 'flushEvents':
      case 'close': {
        if (method === 'close' && !known && !/flagsmith/i.test(recv)) return;
        const inExit = ctx.handlerRanges.some((r) => recvStart >= r.start && recvStart <= r.end);
        const ev: FlushEvidence = { loc: at, method, inExitHandler: inExit };
        if (client) ev.client = client;
        out.flushes.push(ev);
        return;
      }
      case 'identify': {
        if (!args[0]) return;
        out.identifies.push({ loc: at, expr: normaliseExpr(a0), raw: a0, via: 'identify', awaited: isAwaited(ctx, recvStart, call.close), sdk: sdkFor(name, 'js') });
        return;
      }
      case 'getIdentityFlags': {
        if (!args[0]) return;
        out.identifies.push({ loc: at, expr: normaliseExpr(a0), raw: a0, via: 'getIdentityFlags', awaited: true, sdk: 'node' });
        return;
      }
      case 'getEnvironmentFlags':
        return;
      case 'getValue':
      case 'hasFeature':
      case 'getFeatureValue':
      case 'isFeatureEnabled':
      case 'getFlag':
      case 'getAllFlags': {
        const ev: PlainFlagReadEvidence = { loc: at, flag: method === 'getAllFlags' ? null : resolveName(ctx, global, a0), method };
        if (client) ev.client = client;
        out.plainFlagReads.push(ev);
        return;
      }
      case 'init': {
        if (!args[0]) return;
        const objOpen = a0.startsWith('{') ? skipSpace(code, args[0].start) : -1;
        let open = objOpen;
        if (open < 0 && /^[A-Za-z_$][\w$]*$/.test(a0)) {
          const m = new RegExp(`\\b(?:const|let|var)\\s+${a0.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\{`).exec(skel);
          if (m) open = m.index + m[0].length - 1;
        }
        if (open < 0) return;
        const init = initFromObject(ctx, open, sdkFor(name, 'js'), 'init', recvStart, client);
        if (init) {
          out.inits.push(init);
          if (init.identityExpr) out.identifies.push({ loc: init.loc, expr: init.identityExpr, raw: init.identityExpr, via: 'init-identity', awaited: true, sdk: init.sdk });
        }
        return;
      }
    }
  };

  for (const m of skel.matchAll(callRe)) {
    const dot = m.index!;
    const method = m[1]!;
    const open = dot + m[0].length - 1;
    const recv = receiverBefore(skel, dot);
    handle(method, recv.text, recv.start, open, false);
  }

  // destructured functions: const { trackEvent } = useFlagsmith(); trackEvent('x')
  for (const [fn, sdk] of ctx.boundFns) {
    if (!METHODS.split('|').includes(fn)) continue;
    const re = new RegExp(`(?<![\\w$.])${fn}\\s*\\(`, 'g');
    for (const m of skel.matchAll(re)) {
      const open = m.index! + m[0].length - 1;
      ctx.clients.set(fn, sdk);
      handle(fn, fn, m.index!, open, true);
    }
  }

  // React hooks
  for (const m of skel.matchAll(/(?<![\w$.])(useExperiment|useFlags)\s*(?:<[^>()]*>)?\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const call = readCallArgs(skel, open);
    if (!call) continue;
    const a0 = spanText(ctx, call.args[0]);
    const at = makeLoc(ctx, m.index!);
    if (m[1] === 'useExperiment') {
      out.experimentFlags.push({ loc: at, flag: resolveName(ctx, global, a0), method: 'useExperiment', sdk: 'js' });
    } else {
      const names = a0.startsWith('[') ? a0.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : [];
      if (!names.length) out.plainFlagReads.push({ loc: at, flag: null, method: 'useFlags' });
      for (const n of names) out.plainFlagReads.push({ loc: at, flag: resolveName(ctx, global, n), method: 'useFlags' });
    }
  }

  // new Flagsmith({...}) for the Node SDK
  for (const m of skel.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const cls = m[1]!;
    if (!(ctx.nodeClasses.has(cls) || (cls === 'Flagsmith' && ctx.sdkHint !== 'js'))) continue;
    const open = m.index! + m[0].length - 1;
    const call = readCallArgs(skel, open);
    if (!call?.args[0]) continue;
    const a0 = spanText(ctx, call.args[0]);
    let objOpen = a0.startsWith('{') ? skipSpace(code, call.args[0].start) : -1;
    if (objOpen < 0 && /^[A-Za-z_$][\w$]*$/.test(a0)) {
      const mm = new RegExp(`\\b(?:const|let|var)\\s+${a0.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\{`).exec(skel);
      if (mm) objOpen = mm.index + mm[0].length - 1;
    }
    if (objOpen < 0) continue;
    const lhs = /([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>.[\]| ]+)?=\s*$/.exec(skel.slice(Math.max(0, m.index! - 80), m.index!));
    const init = initFromObject(ctx, objOpen, 'node', 'constructor', m.index!, lhs?.[1]);
    if (init) out.inits.push(init);
  }

  // <FlagsmithProvider options={{...}} />
  for (const m of skel.matchAll(/<FlagsmithProvider\b/g)) {
    const region = skel.slice(m.index!, m.index! + 3000);
    const opt = /\boptions\s*=\s*\{/.exec(region);
    if (!opt) continue;
    const exprOpen = m.index! + opt.index + opt[0].length - 1;
    const inner = skipSpace(skel, exprOpen + 1);
    let objOpen = skel[inner] === '{' ? inner : -1;
    if (objOpen < 0) {
      const id = /^([A-Za-z_$][\w$]*)/.exec(code.slice(inner))?.[1];
      if (id) {
        const mm = new RegExp(`\\b(?:const|let|var)\\s+${id.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\{`).exec(skel);
        if (mm) objOpen = mm.index + mm[0].length - 1;
      }
    }
    if (objOpen < 0) continue;
    const init = initFromObject(ctx, objOpen, 'js', 'provider', m.index!);
    if (init) {
      out.inits.push(init);
      if (init.identityExpr) out.identifies.push({ loc: init.loc, expr: init.identityExpr, raw: init.identityExpr, via: 'init-identity', awaited: true, sdk: 'js' });
    }
  }

  // exits
  for (const m of skel.matchAll(/\bprocess\.exit\s*\(/g)) out.exits.push({ loc: makeLoc(ctx, m.index!), kind: 'process.exit' });
  for (const r of ctx.handlerRanges) out.exits.push({ loc: makeLoc(ctx, r.start), kind: r.kind });
}

function classify(ctx: FileCtx, usesFlagsmith: boolean): FileRuntime {
  const { skel, path } = ctx;
  if (
    /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|\bexport\s+(?:const|let)\s+(GET|POST|handler)\s*=|\bexport\s+default\s+(?:async\s+)?function\s+handler\b|\bexports\.handler\s*=/.test(skel) ||
    /(^|\/)(pages\/api|app\/api|netlify\/functions|api)\/.+\.(?:[mc]?[jt]s)$/.test(path)
  ) {
    return 'serverless';
  }
  if (/\.listen\s*\(|\bcreateServer\s*\(|\bfastify\s*\(|\bnew\s+Hono\s*\(|\bBun\.serve\s*\(/.test(skel)) return 'node-server';
  const nodeSdk = ctx.sdkHint === 'node';
  const scripty = /\bprocess\.exit\s*\(|\bprocess\.argv\b|^\s*#!|^\s*(?:await\s+)?main\s*\(|\bmain\s*\(\s*\)\s*\.(then|catch)\s*\(/m.test(ctx.code);
  if (scripty && (nodeSdk || /\bprocess\./.test(skel))) return 'node-script';
  if (ctx.imports.some((i) => i.sdk === 'js' && /\/react$/.test(i.spec)) || /\b(useExperiment|useFlags|useFlagsmith)\s*\(|<FlagsmithProvider\b/.test(skel)) return 'react';
  if (ctx.sdkHint === 'js' || (usesFlagsmith && /\b(window|document)\s*\./.test(skel))) return 'browser';
  return 'unknown';
}

/**
 * Extracts Flagsmith SDK usage from source files. Pure: give it file contents,
 * get evidence back, so the CLI, tests and the browser can all use it.
 */
export function scanFiles(input: SourceFile[], options: ScanOptions = {}): CodeEvidence {
  const files = input.map((f) => ({ path: f.path.replace(/\\/g, '/').replace(/^\.\//, ''), content: f.content }));
  const packages: SdkPackageEvidence[] = [];
  const installed: { name: string; version: string; root: string }[] = [];
  let usesFlagsmithMcp = false;

  for (const f of files) {
    if (isInstalledManifest(f.path)) {
      const inst = readInstalled(f.path, f.content);
      if (inst) installed.push(inst);
      continue;
    }
    if (IGNORED.test(f.path)) continue;
    if (/(^|\/)package\.json$/.test(f.path)) packages.push(...readManifest(f.path, f.content));
    if (MCP_FILES.test(f.path) && /flagsmith/i.test(f.content)) usesFlagsmithMcp = true;
  }
  for (const p of packages) {
    const root = p.manifest.file.replace(/package\.json$/, '');
    const inst = installed.filter((i) => i.name === p.name).sort((a, b) => b.root.length - a.root.length).find((i) => root.startsWith(i.root) || i.root.startsWith(root));
    p.installed = inst ? inst.version : null;
  }

  const ctxs: FileCtx[] = [];
  for (const f of files) {
    if (!CODE_EXT.test(f.path) || IGNORED.test(f.path) || /\.d\.ts$/.test(f.path)) continue;
    if (f.content.length > MAX_FILE_BYTES) continue;
    const { code, skeleton } = lex(f.content);
    const ctx: FileCtx = {
      path: f.path,
      code,
      skel: skeleton,
      lines: new LineIndex(f.content),
      imports: parseImports(code),
      sdkHint: null,
      clients: new Map(),
      nodeClasses: new Set(),
      factories: new Set(),
      flagsObjects: new Set(),
      boundFns: new Map(),
      consts: new Map(),
      exportedClients: new Map(),
      defaultExportClient: null,
      handlerRanges: [],
    };
    const sdks = new Set(ctx.imports.map((i) => i.sdk).filter((s): s is Sdk => !!s));
    if (sdks.size === 1) ctx.sdkHint = [...sdks][0]!;
    collectConsts(ctx);
    collectBindings(ctx);
    collectHandlers(ctx);
    ctxs.push(ctx);
  }

  // Cross-file: exported clients and constants, matched by import name.
  const globalConsts = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const c of ctxs) {
    for (const [k, v] of c.consts) {
      if (globalConsts.has(k) && globalConsts.get(k) !== v) ambiguous.add(k);
      else globalConsts.set(k, v);
    }
  }
  for (const k of ambiguous) globalConsts.delete(k);
  const exported = new Map<string, Sdk>();
  const defaultByModule = new Map<string, Sdk>();
  for (const c of ctxs) {
    for (const [k, v] of c.exportedClients) exported.set(k, v);
    if (c.defaultExportClient) defaultByModule.set(c.path.replace(/\.[^./]+$/, '').split('/').pop()!, c.defaultExportClient);
  }
  for (const c of ctxs) {
    for (const imp of c.imports) {
      if (imp.sdk || !imp.spec.startsWith('.') && !imp.spec.startsWith('@/') && !imp.spec.startsWith('~/')) continue;
      for (const n of imp.named) {
        const sdk = exported.get(n.imported);
        if (sdk) c.clients.set(n.local, sdk);
      }
      if (imp.defaultName) {
        const base = imp.spec.split('/').pop()!.replace(/\.[^.]+$/, '');
        const sdk = defaultByModule.get(base) ?? (base === 'index' ? undefined : defaultByModule.get(base));
        if (sdk) c.clients.set(imp.defaultName, sdk);
      }
      if (!c.sdkHint) {
        const viaImport = [...c.clients.values()];
        if (viaImport.length) c.sdkHint = viaImport[0]!;
      }
    }
  }
  const globalClients = new Map<string, Sdk>();
  for (const c of ctxs) for (const [k, v] of c.clients) if (!globalClients.has(k)) globalClients.set(k, v);

  const out: Collected = { inits: [], identifies: [], experimentFlags: [], plainFlagReads: [], trackEvents: [], exposures: [], flushes: [], exits: [] };
  const summaries: FileSummary[] = [];
  for (const c of ctxs) {
    const before = countAll(out);
    collectCalls(c, globalConsts, out, globalClients);
    const used = countAll(out) > before || c.imports.some((i) => i.sdk) || c.clients.size > 0;
    if (used) {
      // exits found in files that never touch Flagsmith are noise
      summaries.push({ file: c.path, runtime: classify(c, used), usesFlagsmith: true });
    } else {
      out.exits = out.exits.filter((e) => e.loc.file !== c.path);
    }
  }

  const byLoc = <T extends { loc: SourceLocation }>(a: T, b: T) => a.loc.file.localeCompare(b.loc.file) || a.loc.line - b.loc.line;
  const evidence: CodeEvidence = {
    scannedFiles: ctxs.length,
    files: summaries.sort((a, b) => a.file.localeCompare(b.file)),
    packages: packages.sort((a, b) => a.manifest.file.localeCompare(b.manifest.file) || a.name.localeCompare(b.name)),
    inits: out.inits.sort(byLoc),
    identifies: dedupe(out.identifies.sort(byLoc)),
    experimentFlags: out.experimentFlags.sort(byLoc),
    plainFlagReads: out.plainFlagReads.sort(byLoc),
    trackEvents: out.trackEvents.sort(byLoc),
    exposures: out.exposures.sort(byLoc),
    flushes: out.flushes.sort(byLoc),
    exits: out.exits.sort(byLoc),
  };
  if (options.root) evidence.root = options.root;
  if (usesFlagsmithMcp) evidence.usesFlagsmithMcp = true;
  return evidence;
}

function countAll(c: Collected): number {
  return c.inits.length + c.identifies.length + c.experimentFlags.length + c.plainFlagReads.length + c.trackEvents.length + c.exposures.length + c.flushes.length;
}

function dedupe(ids: IdentifyEvidence[]): IdentifyEvidence[] {
  const seen = new Set<string>();
  return ids.filter((i) => {
    const k = `${i.loc.file}:${i.loc.line}:${i.via}:${i.expr}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
