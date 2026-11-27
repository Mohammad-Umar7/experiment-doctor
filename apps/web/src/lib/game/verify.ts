/**
 * Verifies a Human vs Doctor repair by statically simulating what the Flagsmith JS SDK
 * would do with the player's code, in source order:
 *
 *   init -> identify -> getExperimentFlag (exposure) -> trackEvent (conversion) -> flush
 *
 * It never executes the player's code. It parses it with acorn and walks the calls on
 * `flagsmith`, tracking the current identity the same way the SDK does. A repair passes
 * when the experiment would actually receive an exposure and a matching conversion for
 * the same identity, and the events would leave the page before it unloads.
 */
import { parse, type Node } from "acorn";

export type StageKey = "app" | "sdk" | "flagsmith" | "warehouse" | "results";

export type CheckId = "parse" | "events" | "identify" | "exposure" | "metric" | "identity" | "flush";

export type Check = {
  id: CheckId;
  label: string;
  ok: boolean;
  stage: StageKey;
  detail?: string;
};

export type VerifyResult = {
  ok: boolean;
  checks: Check[];
  /** First pipeline stage that is still broken, if any. */
  brokenStage: StageKey | null;
};

export type VerifyTarget = { flag: string; metric: string };

export const MAX_CODE_LENGTH = 6000;

type AnyNode = Node & Record<string, unknown>;

type SdkCall = {
  method: string;
  node: AnyNode;
  args: AnyNode[];
  start: number;
  /** Inside an unload-style event listener callback. */
  onUnload: boolean;
};

type Navigation = { start: number };

const UNLOAD_EVENTS = new Set(["pagehide", "beforeunload", "unload", "visibilitychange"]);
const READ_WITHOUT_EXPOSURE = new Set(["getValue", "hasFeature", "getAllFlags", "getFlag"]);

function isNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function memberName(node: AnyNode): { object: string | null; property: string | null } {
  if (node.type !== "MemberExpression") return { object: null, property: null };
  const obj = node.object as AnyNode;
  const prop = node.property as AnyNode;
  const property = prop.type === "Identifier" ? (prop.name as string) : prop.type === "Literal" ? String(prop.value) : null;
  let object: string | null = null;
  if (obj.type === "Identifier") object = obj.name as string;
  else if (obj.type === "MemberExpression") {
    const inner = memberName(obj);
    object = inner.object && inner.property ? `${inner.object}.${inner.property}` : inner.property;
  }
  return { object, property };
}

function stringValue(node: AnyNode | undefined): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0) {
    const quasi = (node.quasis as AnyNode[])[0];
    return (quasi.value as { cooked: string }).cooked;
  }
  return null;
}

function source(code: string, node: AnyNode): string {
  return code.slice(node.start, node.end).replace(/\s+/g, "");
}

/** Depth-first walk that records SDK calls and navigations in source order. */
function collect(code: string, root: AnyNode) {
  const calls: SdkCall[] = [];
  const navigations: Navigation[] = [];

  function walk(node: AnyNode, onUnload: boolean) {
    let childUnload = onUnload;

    if (node.type === "CallExpression") {
      const callee = node.callee as AnyNode;
      const { object, property } = memberName(callee);
      const args = node.arguments as AnyNode[];
      if (property && (object === "flagsmith" || object === "window.flagsmith")) {
        calls.push({ method: property, node, args, start: node.start, onUnload });
      }
      if (property && (property === "assign" || property === "replace" || property === "reload") && object && /(^|\.)location$/.test(object)) {
        navigations.push({ start: node.start });
      }
      if (property === "addEventListener") {
        const evt = stringValue(args[0]);
        if (evt && UNLOAD_EVENTS.has(evt)) childUnload = true;
      }
    }

    if (node.type === "AssignmentExpression") {
      const left = node.left as AnyNode;
      const { object, property } = memberName(left);
      if ((property === "href" && object && /(^|\.)location$/.test(object)) || (property === "location" && object === "window")) {
        navigations.push({ start: node.start });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) walk(item, childUnload);
      } else if (isNode(value)) {
        walk(value, childUnload);
      }
    }
  }

  walk(root, false);
  calls.sort((a, b) => a.start - b.start);
  navigations.sort((a, b) => a.start - b.start);
  return { calls, navigations };
}

function initEnablesEvents(call: SdkCall | undefined): boolean {
  if (!call) return false;
  const options = call.args[0];
  if (!options || options.type !== "ObjectExpression") return false;
  return (options.properties as AnyNode[]).some((p) => {
    if (p.type !== "Property") return false;
    const key = p.key as AnyNode;
    const name = key.type === "Identifier" ? key.name : key.type === "Literal" ? key.value : null;
    const value = p.value as AnyNode;
    return name === "enableEvents" && value.type === "Literal" && value.value === true;
  });
}

/** Identifier passed in an options object as `{ identifier: x }`, if any. */
function identifierOption(node: AnyNode | undefined, code: string): string | null {
  if (!node || node.type !== "ObjectExpression") return null;
  for (const p of node.properties as AnyNode[]) {
    if (p.type !== "Property") continue;
    const key = p.key as AnyNode;
    if ((key.type === "Identifier" && key.name === "identifier") || (key.type === "Literal" && key.value === "identifier")) {
      return source(code, p.value as AnyNode);
    }
  }
  return null;
}

const LABELS: Record<CheckId, { label: string; stage: StageKey }> = {
  parse: { label: "Code parses", stage: "app" },
  events: { label: "SDK initialised with events enabled", stage: "sdk" },
  flush: { label: "Events flushed before the page goes away", stage: "sdk" },
  identify: { label: "User identified before the experiment flag", stage: "flagsmith" },
  exposure: { label: "Exposure recorded for the experiment flag", stage: "flagsmith" },
  identity: { label: "Conversion sent by the same identity", stage: "warehouse" },
  metric: { label: "Conversion event matches the metric", stage: "results" },
};

const STAGE_ORDER: StageKey[] = ["app", "sdk", "flagsmith", "warehouse", "results"];

function check(id: CheckId, ok: boolean, detail?: string): Check {
  return { id, ok, detail, ...LABELS[id] };
}

export function verifyRepair(code: string, target: VerifyTarget): VerifyResult {
  if (code.length > MAX_CODE_LENGTH) {
    return finish([check("parse", false, `Keep the file under ${MAX_CODE_LENGTH} characters.`)]);
  }

  let ast: AnyNode;
  try {
    ast = parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
    }) as AnyNode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Syntax error";
    return finish([check("parse", false, message)]);
  }

  const { calls, navigations } = collect(code, ast);
  const checks: Check[] = [check("parse", true)];

  // init + enableEvents
  const init = calls.find((c) => c.method === "init");
  const eventsOn = initEnablesEvents(init);
  checks.push(
    check(
      "events",
      eventsOn,
      !init ? "flagsmith.init() is never called." : eventsOn ? undefined : "init() needs enableEvents: true.",
    ),
  );

  // Walk the calls like the SDK would.
  let identity: string | null = null;
  let identifiedBeforeFlag = false;
  let exposureIdentity: string | null = null;
  let exposureStart = -1;
  let readWithoutExposure = false;
  const conversions: Array<{ name: string | null; identity: string | null; start: number; onUnload: boolean }> = [];
  const flushes: SdkCall[] = [];

  for (const call of calls) {
    switch (call.method) {
      case "identify": {
        if (call.args[0]) identity = source(code, call.args[0]);
        break;
      }
      case "getExperimentFlag":
      case "trackExposureEvent": {
        if (stringValue(call.args[0]) !== target.flag) break;
        if (identity && exposureIdentity === null) identifiedBeforeFlag = true;
        const id = identifierOption(call.args[1], code) ?? identity;
        if (eventsOn && id && exposureIdentity === null) {
          exposureIdentity = id;
          exposureStart = call.start;
        }
        break;
      }
      case "trackEvent": {
        conversions.push({
          name: stringValue(call.args[0]),
          identity: identifierOption(call.args[1], code) ?? identity,
          start: call.start,
          onUnload: call.onUnload,
        });
        break;
      }
      case "flushEvents":
      case "close": {
        flushes.push(call);
        break;
      }
      default: {
        if (READ_WITHOUT_EXPOSURE.has(call.method) && stringValue(call.args[0]) === target.flag) readWithoutExposure = true;
      }
    }
  }

  const sawFlagCall = calls.some(
    (c) => (c.method === "getExperimentFlag" || c.method === "trackExposureEvent") && stringValue(c.args[0]) === target.flag,
  );

  const everIdentified = calls.some((c) => c.method === "identify" && c.args.length > 0);
  const identifyOk = sawFlagCall ? identifiedBeforeFlag || exposureIdentity !== null : everIdentified;
  checks.push(
    check(
      "identify",
      identifyOk,
      identifyOk
        ? undefined
        : sawFlagCall
          ? "identify() must run before the experiment flag is read."
          : "The user is never identified.",
    ),
  );

  checks.push(
    check(
      "exposure",
      exposureIdentity !== null,
      exposureIdentity
        ? undefined
        : readWithoutExposure
          ? `The flag is read without recording an exposure. Use getExperimentFlag("${target.flag}").`
          : !sawFlagCall
            ? `Nothing reads "${target.flag}" with getExperimentFlag.`
            : !eventsOn
              ? "Events are disabled, so the exposure is never sent."
              : "No identity at the moment of exposure.",
    ),
  );

  const afterExposure = conversions.filter((c) => c.start > exposureStart);
  const matching = afterExposure.filter((c) => c.name === target.metric);
  const caseOnly = afterExposure.find((c) => c.name && c.name !== target.metric && c.name.toLowerCase() === target.metric.toLowerCase());
  checks.push(
    check(
      "metric",
      matching.length > 0,
      matching.length > 0
        ? undefined
        : caseOnly
          ? `The metric expects "${target.metric}". The app sends "${caseOnly.name}".`
          : `No trackEvent("${target.metric}") after the exposure.`,
    ),
  );

  // Judge identity on the matching conversions when there are any; otherwise on whatever
  // conversion fires, so a name mismatch is not also reported as an identity mismatch.
  const pool = matching.length > 0 ? matching : afterExposure;
  const joined = pool.find((c) => c.identity !== null && c.identity === exposureIdentity);
  checks.push(
    check(
      "identity",
      Boolean(joined),
      joined
        ? undefined
        : exposureIdentity === null
          ? "No exposure to join the conversion to yet."
          : pool.length === 0
            ? "No conversion to join."
            : "The conversion is sent under a different identity than the exposure.",
    ),
  );

  // Flush: every conversion must be followed by a flush before any navigation,
  // or the page must flush on unload.
  const flushOnUnload = flushes.some((f) => f.onUnload);
  const lastConversion = matching.length ? matching[matching.length - 1].start : -1;
  const navAfter = navigations.find((n) => n.start > lastConversion);
  let flushed: boolean;
  if (lastConversion < 0) flushed = flushOnUnload || flushes.length > 0;
  else if (navAfter) flushed = flushes.some((f) => !f.onUnload && f.start > lastConversion && f.start < navAfter.start);
  else flushed = flushOnUnload || flushes.some((f) => f.start > lastConversion);
  checks.push(
    check(
      "flush",
      flushed,
      flushed
        ? undefined
        : navAfter
          ? "The page navigates away before the buffered events are sent."
          : "Nothing sends buffered events before the page unloads.",
    ),
  );

  return finish(checks);
}

function finish(checks: Check[]): VerifyResult {
  const failing = checks.filter((c) => !c.ok);
  const brokenStage = failing.length
    ? STAGE_ORDER.find((s) => failing.some((c) => c.stage === s)) ?? failing[0].stage
    : null;
  return { ok: failing.length === 0, checks, brokenStage };
}
