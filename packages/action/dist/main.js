// src/main.ts
import { execFileSync } from "child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

// ../core/src/constants.ts
var TOOL_NAME = "experiment-doctor";
var TOOL_VERSION = "0.2.0";
var DOCS = {
  runExperiment: "https://docs.flagsmith.com/experimentation/run-an-experiment",
  codingAgent: "https://docs.flagsmith.com/experimentation/set-up-with-a-coding-agent",
  cli: "https://docs.flagsmith.com/integrating-with-flagsmith/CLI"
};
var RESULTS_MIN_IDENTITIES_PER_VARIANT = 50;
var RESULTS_MIN_CONVERSIONS_PER_VARIANT = 5;
var SRM_P_VALUE_THRESHOLD = 1e-3;
var SRM_MIN_TOTAL_IDENTITIES = 100;
var RESULTS_REFRESH_MINUTES = 5;
var EVENTS_FLUSH_INTERVAL_SECONDS = 10;
var DEFAULT_EVENTS_API_URL = "https://events.api.flagsmith.com/";
var CLOUD_HOSTS = [
  "api.flagsmith.com",
  "edge.api.flagsmith.com",
  "events.api.flagsmith.com",
  "app.flagsmith.com"
];
var SDK_REQUIREMENTS = [
  {
    name: "@flagsmith/flagsmith",
    kind: "js",
    minVersion: "12.4.0",
    recommended: "12.6.0",
    note: "JavaScript and React SDK. Experiment exposures need 12.4.0 or newer."
  },
  {
    name: "@flagsmith/nodejs",
    kind: "node",
    minVersion: "9.1.0",
    recommended: "9.5.0",
    note: "Node.js SDK. Experiment events need 9.1.0 or newer."
  },
  {
    name: "flagsmith-nodejs",
    kind: "node",
    minVersion: null,
    replacement: "@flagsmith/nodejs",
    note: "The old Node.js package name (before 9.0.0). It cannot send experiment events."
  },
  {
    name: "flagsmith",
    kind: "js",
    minVersion: null,
    replacement: "@flagsmith/flagsmith",
    note: "The old unscoped JavaScript package (last release 10.x). It has no getExperimentFlag or trackEvent."
  },
  {
    name: "react-native-flagsmith",
    kind: "react-native",
    minVersion: null,
    replacement: "@flagsmith/flagsmith",
    note: "Not listed by Flagsmith as an SDK that can send experiment events."
  }
];

// ../core/src/pipeline.ts
var PIPELINE = [
  { id: "app", label: "App" },
  { id: "sdk", label: "SDK" },
  { id: "flagsmith", label: "Flagsmith" },
  { id: "warehouse", label: "Warehouse" },
  { id: "results", label: "Results" }
];
var LAYERS = ["config", "instrumentation", "identity", "transport", "ingestion", "results"];
var blocking = (f) => f.kind === "defect" && f.severity !== "info";
function statusOf(checks, findings, optional) {
  if (findings.some(blocking)) return "broken";
  const required = checks.filter((c) => !(optional.has(c.id) && c.status === "skip"));
  if (required.length === 0) return "unknown";
  return required.every((c) => c.status === "pass") ? "ok" : "unknown";
}
function buildPipeline(checks, findings, rules) {
  const optional = new Set(rules.filter((r) => r.optional).map((r) => r.id));
  return PIPELINE.map(({ id, label }) => {
    const nodeFindings = findings.filter((f) => f.node === id);
    return {
      id,
      label,
      status: statusOf(
        checks.filter((c) => c.node === id),
        nodeFindings,
        optional
      ),
      findingIds: [...new Set(nodeFindings.map((f) => f.id))]
    };
  });
}
function buildLayers(checks, findings, rules) {
  const optional = new Set(rules.filter((r) => r.optional).map((r) => r.id));
  const out = {};
  for (const layer of LAYERS) {
    out[layer] = statusOf(
      checks.filter((c) => c.layer === layer),
      findings.filter((f) => f.layer === layer),
      optional
    );
  }
  return out;
}

// ../core/src/registry/known-bugs.ts
var gh = (n) => `https://github.com/Flagsmith/flagsmith/issues/${n}`;
var CHECKED_ON = "2026-11-27";
var KNOWN_BUGS = [
  {
    issue: 9120,
    title: "After an experiment is completed, its rollout override keeps splitting identities",
    url: gh(9120),
    state: "closed",
    checkedOn: CHECKED_ON,
    seenIn: "self-hosted 2.291.0; since 2.295.2 Complete can choose the rollout, and the docs were updated",
    symptoms: ["You completed the experiment and changed the flag default, but users still get their old variation."],
    requiredEvidence: ["experiment status is completed", "no rollout decision was recorded when completing", "flag edits after completion do not reach enrolled identities (confirm by hand)"],
    workaround: "On 2.295.2 or newer, choose the rollout when completing (POST .../complete/ with a rollout_decision). On older versions: pause, set the default to the winner, set the rollout to 0% with the winner's weights, then complete.",
    workaroundSource: "issue",
    match(ev) {
      const exp = ev.config?.experiment;
      if (!exp || exp.status !== "completed" || exp.rolloutDecision) return null;
      return { confidence: 0.3, matched: ["experiment is completed", "no rollout_decision recorded"] };
    }
  },
  {
    issue: 9129,
    title: "Completing an experiment does not compute final results",
    url: gh(9129),
    state: "closed",
    checkedOn: CHECKED_ON,
    seenIn: "self-hosted 2.295.2",
    symptoms: ["The experiment is completed but results still show is_final: false with the old as_of."],
    requiredEvidence: ["experiment status is completed", "results.is_final is false"],
    workaround: "Once the 5-minute refresh limit has passed, POST results/refresh/ one more time; the results then read is_final: true.",
    workaroundSource: "issue",
    match(ev) {
      const exp = ev.config?.experiment;
      const res = ev.config?.results;
      if (!exp || exp.status !== "completed" || !res || res.isFinal !== false) return null;
      return { confidence: 0.6, matched: ["experiment is completed", "results are not final"] };
    }
  },
  {
    issue: 9132,
    title: "Self-hosted: Postgres JIT makes the environment lookup take ~3 s, so SDK events time out",
    url: gh(9132),
    state: "open",
    checkedOn: CHECKED_ON,
    seenIn: "self-hosted 2.295.2 with postgres:15.5-alpine",
    symptoms: ["A few conversions go missing on a correctly wired experiment.", 'SDK logs show "Read timed out (read timeout=3)" and retries.'],
    requiredEvidence: ["self-hosted Flagsmith on PostgreSQL", "an SDK request slower than 2.5 s (canary latency)"],
    workaround: 'Turn Postgres JIT off: in docker-compose set the postgres service command to ["postgres", "-c", "jit=off"].',
    workaroundSource: "issue",
    match(ev) {
      const env = ev.config?.environment;
      const pg = ev.config?.warehouses?.some((w) => w.flagsmithDatabase || w.type === "postgres");
      const slow = (ev.probe?.maxLatencyMs ?? 0) >= 2500;
      if (!env?.selfHosted || !slow) return null;
      return { confidence: pg ? 0.6 : 0.35, matched: ["self-hosted Flagsmith", `canary request took ${ev.probe.maxLatencyMs} ms`, ...pg ? ["PostgreSQL warehouse"] : []] };
    }
  },
  {
    issue: 9133,
    title: "Results banner declares a winner at any probability, docs say 95% / 5%",
    url: gh(9133),
    state: "open",
    checkedOn: CHECKED_ON,
    seenIn: "Flagsmith Cloud v2.294.0",
    symptoms: ['The results page says "Winner Probability Confirmed" or "Control is the winner" while the chance to win is between 5% and 95%.'],
    requiredEvidence: ["computed results with a variation whose chance to beat control is between 5% and 95%"],
    workaround: "Treat any chance to win between 5% and 95% as inconclusive, whatever the banner says: read the chance to win and the credible interval, and keep the experiment running.",
    workaroundSource: "docs",
    match(ev) {
      const res = ev.config?.results;
      if (!res) return null;
      const hits = [];
      for (const m of res.metrics) {
        for (const v of m.variants) {
          if (v.variant === "control" || v.chanceToWin === null || v.chanceToWin === void 0) continue;
          if (v.chanceToWin > 0.05 && v.chanceToWin < 0.95) hits.push(`${v.variant}: ${Math.round(v.chanceToWin * 100)}% chance to beat control`);
        }
      }
      return hits.length ? { confidence: 0.7, matched: hits } : null;
    }
  },
  {
    issue: 9136,
    title: "MCP: update_experiment sends PUT, which the experiments endpoint always rejects",
    url: gh(9136),
    state: "open",
    checkedOn: CHECKED_ON,
    seenIn: "self-hosted v2.295.2 and main",
    symptoms: ['Renaming an experiment or editing its hypothesis through the MCP update_experiment tool (a PUT) fails with HTTP 400 on "feature".'],
    requiredEvidence: ["an experiment update through update_experiment or a PUT to .../experiments/<id>/", 'the 400 error {"feature": [...]} (confirm by hand)'],
    workaround: 'Use PATCH instead: flagsmith api api/v1/environments/<env-key>/experiments/<id>/ -X PATCH --input - with {"hypothesis": "..."}.',
    workaroundSource: "issue",
    match(ev) {
      const ops = ev.code?.experimentUpdates ?? [];
      if (ops.length) {
        return { confidence: 0.55, matched: ops.slice(0, 3).map((o) => `${o.via === "http-put" ? "PUT to experiments" : "update_experiment"} at ${o.loc.file}:${o.loc.line}`) };
      }
      if (ev.code?.usesFlagsmithMcp) return { confidence: 0.15, matched: ["an MCP config mentions Flagsmith (no update_experiment or PUT call seen)"] };
      return null;
    }
  }
];
function upstreamNote(issue, state, checkedOn) {
  return `Symptoms may be consistent with Flagsmith issue #${issue} (${state} as of ${checkedOn}). Confirm the affected operation and error before applying the workaround.${state === "closed" ? " The issue is closed upstream: upgrading Flagsmith may already resolve it." : ""}`;
}
function matchKnownBugs(evidence, findings = [], bugs = KNOWN_BUGS) {
  const out = [];
  for (const bug of bugs) {
    const m = bug.match(evidence, findings);
    if (!m) continue;
    out.push({
      issue: bug.issue,
      title: bug.title,
      url: bug.url,
      state: bug.state,
      checkedOn: bug.checkedOn,
      confidence: m.confidence,
      matched: m.matched,
      workaround: bug.workaround,
      workaroundSource: bug.workaroundSource,
      note: `${upstreamNote(bug.issue, bug.state, bug.checkedOn)}${bug.workaround ? "" : " No workaround is documented."}`
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

// ../core/src/flagsmith/commands.ts
var ENV_KEY_PLACEHOLDER = "<env-key>";
var envPath = (rest) => `api/v1/environments/${ENV_KEY_PLACEHOLDER}/${rest}`;
function startExperimentCommand(experimentId, resume = false) {
  return {
    command: `flagsmith api ${envPath(`experiments/${experimentId}/start/`)} -X POST`,
    writes: true,
    description: resume ? `Resume experiment ${experimentId}. This turns the rollout back on.` : `Start experiment ${experimentId}. This locks the flag and turns on the rollout.`
  };
}
function refreshResultsCommand(experimentId) {
  return {
    command: `flagsmith api ${envPath(`experiments/${experimentId}/results/refresh/`)} -X POST`,
    writes: false,
    description: "Ask Flagsmith to recompute results (allowed once every 5 minutes)."
  };
}
function variantKeyCommand(flag, variants) {
  return {
    command: variants.map((v) => `flagsmith feature variant update ${flag} ${v.id} --key ${v.key}`).join(" && "),
    writes: true,
    description: `Give ${variants.length === 1 ? "the variation a key" : "each variation a key"} so exposures are counted.`
  };
}
function listWarehousesCommand() {
  return {
    command: `flagsmith api ${envPath("warehouse-connections/")} --json --jq '.[] | {warehouse_type, status, status_detail}'`,
    writes: false,
    description: "Check the warehouse connection for this environment."
  };
}
function connectFlagsmithDatabaseCommand() {
  return {
    command: `flagsmith api ${envPath("warehouse-connections/")} --input -`,
    input: JSON.stringify({ warehouse_type: "postgres", config: { source: "flagsmith_database" } }),
    writes: true,
    description: "Self-hosted on PostgreSQL only: store experiment events in the Flagsmith database itself."
  };
}
function createExperimentHint(flag) {
  return {
    command: `flagsmith api ${envPath("experiments/")} --input -`,
    input: JSON.stringify({
      feature: "<flag id>",
      name: `${flag} experiment`,
      hypothesis: "<what you expect to change>",
      metrics: [{ metric: "<metric id>", expected_direction: "increase" }],
      experiment_rollout: {
        enabled: true,
        rollout_percentage: 100,
        feature_state_value: "control",
        multivariate_feature_state_values: [{ multivariate_feature_option: "<variation id>", percentage_allocation: 50 }]
      }
    }),
    writes: true,
    description: 'Create the experiment (fill in the ids first). It starts in the "created" state.'
  };
}

// ../core/src/util/strings.ts
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}
function foldName(name) {
  return name.toLowerCase().replace(/[\s_\-.:/]+/g, "");
}
function compareNames(expected, candidate) {
  if (expected === candidate) return "exact";
  if (expected.toLowerCase() === candidate.toLowerCase()) return "case";
  if (foldName(expected) === foldName(candidate)) return "format";
  const a = foldName(expected);
  const b = foldName(candidate);
  const limit = Math.max(1, Math.floor(Math.min(a.length, b.length) / 5));
  if (levenshtein(a, b) <= Math.min(2, limit)) return "typo";
  return "none";
}
function slugify(value) {
  const s = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s || s === "control") return s === "control" ? "control_variant" : "variant";
  return s.slice(0, 50);
}
function normaliseExpr(expr) {
  let e = expr.trim();
  const str = /^String\((.*)\)$/s.exec(e);
  if (str?.[1]) e = str[1];
  const tpl = /^`\$\{([^}]*)\}`$/.exec(e);
  if (tpl?.[1]) e = tpl[1];
  e = e.replace(/\.toString\(\)$/, "");
  e = e.replace(/\s+/g, "").replace(/\?\./g, ".").replace(/!/g, "");
  e = e.replace(/^this\./, "");
  return e;
}
function exprTail(expr) {
  const n = normaliseExpr(expr);
  const m = /([A-Za-z_$][\w$]*)\s*(?:\[\s*['"]([^'"]+)['"]\s*\])?$/.exec(n);
  if (!m) return n;
  return (m[2] ?? m[1] ?? n).toLowerCase();
}
var ID_WORDS = /* @__PURE__ */ new Set(["id", "userid", "uid", "user_id", "uuid", "sub", "accountid", "customerid", "identifier", "identity"]);
var EMAIL_WORDS = /* @__PURE__ */ new Set(["email", "emailaddress", "mail", "useremail"]);
var NAME_WORDS = /* @__PURE__ */ new Set(["name", "username", "login", "handle", "displayname"]);
function identityKind(expr) {
  const t = exprTail(expr).replace(/[^a-z_]/g, "");
  if (ID_WORDS.has(t) || /(^|_)id$/.test(t) || /id$/.test(t)) return "id";
  if (EMAIL_WORDS.has(t) || t.includes("email")) return "email";
  if (NAME_WORDS.has(t)) return "name";
  if (t.includes("session") || t.includes("anon") || t.includes("device")) return "session";
  return "other";
}
function sameIdentity(a, b) {
  const na = normaliseExpr(a);
  const nb = normaliseExpr(b);
  if (na === nb) return true;
  const ka = identityKind(na);
  const kb = identityKind(nb);
  if (ka !== "other" && ka === kb) return true;
  return exprTail(na) === exprTail(nb);
}
function retargetExpr(expr, like) {
  const raw = expr.trim();
  const tail = /^(.*[.\]])\s*([A-Za-z_$][\w$]*)$/.exec(raw.replace(/\?\./g, "?."));
  const likeTail = /([A-Za-z_$][\w$]*)$/.exec(normaliseExpr(like));
  if (tail?.[1] && likeTail?.[1]) return `${tail[1]}${likeTail[1]}`;
  return like.trim();
}

// ../core/src/rules/helpers.ts
function makeFinding(rule, input2) {
  return {
    id: rule.id,
    layer: input2.layer ?? rule.layer,
    node: input2.node ?? rule.node,
    kind: input2.kind ?? "defect",
    severity: input2.severity,
    title: input2.title,
    detail: input2.detail,
    evidence: input2.evidence,
    fix: input2.fix,
    confidence: Math.max(0, Math.min(1, Math.round(input2.confidence * 100) / 100))
  };
}
var pass = (note) => note ? { status: "pass", note } : { status: "pass" };
var skip = (note) => ({ status: "skip", note });
var fail = (findings, note) => note ? { status: "fail", findings, note } : { status: "fail", findings };
function codeItem(label, loc, value) {
  const item = { label, source: "code", location: { file: loc.file, line: loc.line, ...loc.snippet ? { snippet: loc.snippet } : {} } };
  if (value !== void 0) item.value = value;
  return item;
}
function configItem(label, value) {
  return value === void 0 ? { label, source: "config" } : { label, source: "config", value };
}
function where(loc) {
  return `${loc.file}:${loc.line}`;
}
var indentOf = (text) => /^\s*/.exec(text)?.[0] ?? "";
function replaceInLine(loc, from, to) {
  if (loc.text === void 0 || !loc.text.includes(from) || from === to) return null;
  return { file: loc.file, line: loc.line, before: loc.text, after: loc.text.replace(from, to) };
}
function insertBefore(loc, line, placeholder = false) {
  if (loc.text === void 0) return null;
  const p = { file: loc.file, line: loc.line, before: loc.text, after: `${indentOf(loc.text)}${line}
${loc.text}` };
  if (placeholder) p.placeholder = true;
  return p;
}
function insertAfter(loc, lines, indent, placeholder = false) {
  if (loc.text === void 0) return null;
  const p = { file: loc.file, line: loc.line, before: loc.text, after: [loc.text, ...lines.map((l) => `${indent}${l}`)].join("\n") };
  if (placeholder) p.placeholder = true;
  return p;
}
function rewriteCall(loc, method, newMethod, suffix = "") {
  const text = loc.text;
  if (text === void 0) return null;
  const at = text.search(new RegExp(`\\.\\s*${method}\\s*\\(`));
  if (at < 0) return null;
  const open = text.indexOf("(", at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
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
function withPatch(fix, patch) {
  return patch ? { ...fix, patch } : fix;
}
function quoteLike(raw, value) {
  const q = /^\s*(['"`])/.exec(raw)?.[1] ?? "'";
  return `${q}${value}${q}`;
}

// ../core/src/rules/ed001-variant-key.ts
var ed001 = {
  id: "ED-001",
  title: "Every variation has a key",
  layer: "config",
  node: "flagsmith",
  rank: 15,
  run(ctx) {
    const flag = ctx.config?.flag;
    if (flag === void 0) return skip("Flag variations were not collected.");
    if (flag === null) return skip("The flag was not found in Flagsmith.");
    if (flag.variants.length === 0) return skip(`Flag "${flag.name}" has no variations.`);
    const missing = flag.variants.filter((v) => !v.key || !v.key.trim());
    if (missing.length === 0) return pass(`All ${flag.variants.length} variations of "${flag.name}" have keys.`);
    const used = new Set(flag.variants.map((v) => v.key).filter(Boolean));
    const keys = missing.map((v) => {
      let key = slugify(v.value);
      let n = 2;
      while (used.has(key)) key = `${slugify(v.value)}_${n++}`;
      used.add(key);
      return { id: v.id, key, value: v.value };
    });
    const running = ctx.experiment?.status === "running";
    const steps = [
      ...keys.map((k) => `Give variation ${k.id} (value ${JSON.stringify(k.value)}) the key "${k.key}".`),
      "Re-run `experiment-doctor verify` to confirm."
    ];
    if (running) {
      steps.unshift("The flag is locked while the experiment runs: complete this experiment, add the keys, then create and start a new one.");
    }
    return fail([
      makeFinding(this, {
        severity: "critical",
        title: missing.length === 1 ? "A variation has no key, so its exposures are not counted" : `${missing.length} variations have no key, so their exposures are not counted`,
        detail: "Flagsmith joins exposures to a variation by its key. Variations created through the API without a `key` are unlabelled, and their exposures are dropped from the results, so that arm looks empty no matter how much traffic it gets.",
        evidence: missing.map((v) => configItem(`Variation ${v.id} of "${flag.name}" has no key`, JSON.stringify(v.value))),
        fix: {
          summary: `Add a key to ${missing.length === 1 ? "the variation" : "each unlabelled variation"} of "${flag.name}".`,
          steps,
          command: variantKeyCommand(flag.name, keys),
          docs: DOCS.runExperiment
        },
        confidence: 0.97
      })
    ]);
  }
};

// ../core/src/rules/ed002-no-identify.ts
var PLACEHOLDER_ID = "user.id";
var ed002 = {
  id: "ED-002",
  title: "The user is identified before the experiment flag is read",
  layer: "identity",
  node: "app",
  rank: 90,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    let calls = code.experimentFlags;
    if (ctx.flagKey) {
      const forFlag = calls.filter((c) => c.flag === ctx.flagKey || c.flag === null);
      if (forFlag.length) calls = forFlag;
    }
    if (!calls.length) return skip("No getExperimentFlag or useExperiment call was found.");
    const findings = [];
    let unknownIdentity = null;
    for (const c of calls.filter((x) => x.sdk === "node" && !x.identifierExpr)) {
      findings.push(
        makeFinding(this, {
          severity: "critical",
          title: "getExperimentFlag is called without an identifier",
          detail: "The Node SDK needs the identity as the second argument: `getExperimentFlag(flag, identifier)`. Without it there is no identity to enrol, so no exposure is recorded.",
          evidence: [codeItem("Experiment flag read with no identifier", c.loc)],
          fix: { summary: "Pass the user id as the second argument.", steps: [`At ${where(c.loc)}, call getExperimentFlag('${c.flag ?? "flag"}', user.id).`], docs: DOCS.runExperiment },
          confidence: 0.9
        })
      );
    }
    const jsCalls = calls.filter((c) => c.sdk === "js");
    if (jsCalls.length) {
      const ids = code.identifies.filter((i) => i.sdk === "js" && (i.via === "identify" || i.via === "init-identity"));
      const opaque = code.inits.find((i) => i.sdk === "js" && i.opaque);
      if (ids.length === 0 && opaque) {
        unknownIdentity = `The SDK options at ${where(opaque.loc)} are built elsewhere, so an identity may be set there: unknown, not missing.`;
      } else if (ids.length === 0) {
        findings.push(neverIdentifies(this, jsCalls[0], code.inits.find((i) => i.style === "provider" && i.insertAfter)));
      } else {
        const ordering = orderingProblem(this, jsCalls, ids);
        if (ordering) findings.push(ordering);
      }
    }
    if (findings.length) return fail(findings);
    if (unknownIdentity) return skip(unknownIdentity);
    return pass(`${calls.length === 1 ? "The experiment flag is" : "Experiment flags are"} read after the user is identified (static check).`);
  }
};
function neverIdentifies(rule, call, provider) {
  const isHook = call.method === "useExperiment";
  const client = call.client ?? "flagsmith";
  let patch = null;
  if (isHook && provider?.insertAfter) patch = insertAfter(provider.insertAfter, [`identity: ${PLACEHOLDER_ID},`], provider.propIndent ?? "  ", true);
  else if (!isHook) patch = insertBefore(call.loc, `await ${client}.identify(${PLACEHOLDER_ID});`, true);
  return makeFinding(rule, {
    severity: "critical",
    title: "The app never identifies the user, so no exposure is recorded",
    detail: `${isHook ? "useExperiment" : "getExperimentFlag"} only records an exposure for an identified user who is enrolled in the experiment. This app never calls identify() and sets no identity option, so every read is anonymous and the Exposures panel stays empty.`,
    evidence: [codeItem(`${isHook ? "useExperiment" : "getExperimentFlag"}('${call.flag ?? "?"}') with no identify() anywhere in the scanned code`, call.loc)],
    fix: withPatch(
      {
        summary: isHook ? "Pass the signed-in user as the `identity` option of FlagsmithProvider." : `Call \`await ${client}.identify(<user id>)\` before reading the experiment flag.`,
        steps: [
          `Replace ${PLACEHOLDER_ID} with the stable id of the signed-in user. Use the same id later for trackEvent.`,
          "Identify before the flag is read, and await it so the identity's flags (with experiment enrolment) are loaded."
        ],
        docs: DOCS.runExperiment
      },
      patch
    ),
    confidence: 0.92
  });
}
function orderingProblem(rule, calls, ids) {
  for (const call of calls) {
    if (call.method !== "getExperimentFlag") continue;
    const sameFile = ids.filter((i) => i.loc.file === call.loc.file);
    const otherFiles = ids.filter((i) => i.loc.file !== call.loc.file);
    const before = sameFile.filter((i) => i.loc.line <= call.loc.line);
    const after = sameFile.filter((i) => i.loc.line > call.loc.line);
    if (!before.length && after.length && !otherFiles.length) {
      const late = after[0];
      const patch = late.loc.text !== void 0 ? insertBefore(call.loc, `await ${call.client ?? "flagsmith"}.identify(${late.raw});`) : null;
      return makeFinding(rule, {
        severity: "critical",
        title: "identify() runs after getExperimentFlag, so the first read is anonymous",
        detail: "getExperimentFlag records the exposure at the moment it is called. Here the user is identified only afterwards, so that read has no identity and no exposure is recorded.",
        evidence: [codeItem("Experiment flag read", call.loc), codeItem("identify() comes later", late.loc)],
        fix: withPatch({ summary: "Identify the user before reading the experiment flag.", docs: DOCS.runExperiment }, patch),
        confidence: 0.8
      });
    }
    const nearest = before.filter((i) => i.via === "identify").sort((a, b) => b.loc.line - a.loc.line)[0];
    if (nearest && !nearest.awaited && call.loc.line - nearest.loc.line <= 12) {
      const client = call.client ?? "flagsmith";
      const patch = replaceInLine(nearest.loc, `${client}.identify(`, `await ${client}.identify(`);
      return makeFinding(rule, {
        severity: "warning",
        title: "identify() is not awaited before getExperimentFlag",
        detail: "identify() fetches the identity's flags, including whether the user is enrolled in the experiment. Reading the flag before that request finishes evaluates the anonymous environment flags, so getExperimentFlag skips the exposure.",
        evidence: [codeItem("identify() without await", nearest.loc), codeItem("Experiment flag read right after", call.loc)],
        fix: withPatch({ summary: "Await identify() before reading the experiment flag.", docs: DOCS.runExperiment }, patch),
        confidence: 0.7
      });
    }
  }
  return null;
}

// ../core/src/rules/ed003-identity-mismatch.ts
var EXPOSURE_VIA = /* @__PURE__ */ new Set(["getExperimentFlag", "trackExposureEvent", "identify", "init-identity", "getIdentityFlags"]);
var ed003 = {
  id: "ED-003",
  title: "Exposures and conversions use the same identity",
  layer: "identity",
  node: "app",
  rank: 100,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    const conversions = code.trackEvents;
    if (!conversions.length) return skip("No trackEvent call was found.");
    const exposureIds = code.identifies.filter((i) => EXPOSURE_VIA.has(i.via));
    if (!exposureIds.length) return skip("No identity is set for exposures (see ED-002).");
    const ref = pickReference(exposureIds, code.experimentFlags.map((c) => c.loc.file));
    const findings = [];
    const anonymous = conversions.filter((t) => t.sdk === "node" && !t.identifierExpr);
    if (anonymous.length) {
      const t = anonymous[0];
      const patch = t.raw ? replaceInLine(t.loc, `trackEvent(${t.raw})`, `trackEvent(${t.raw}, { identifier: ${ref.raw} })`) : null;
      findings.push(
        makeFinding(this, {
          severity: "critical",
          title: "Conversion events are sent without an identifier",
          detail: "In the Node SDK, trackEvent does not know who the user is unless you pass `{ identifier }`. These conversions are stored with no identity, so they can never be joined to an exposure and the metric stays at zero.",
          evidence: [...anonymous.slice(0, 3).map((a) => codeItem(`trackEvent(${a.raw}) with no identifier`, a.loc)), codeItem(`Exposure identity: ${ref.expr}`, ref.loc)],
          fix: withPatch({ summary: `Pass the same identifier used for the flag: \`{ identifier: ${ref.raw} }\`.`, docs: DOCS.runExperiment }, patch),
          confidence: 0.93
        })
      );
    }
    const mismatched = conversions.filter((t) => t.identifierExpr && !exposureIds.some((e) => sameIdentity(e.expr, t.identifierExpr)));
    if (mismatched.length) {
      const t = mismatched[0];
      findings.push(mismatchFinding(this, t, ref));
    }
    if (!findings.length) {
      const jsIds = exposureIds.filter((i) => i.sdk === "js" && (i.via === "identify" || i.via === "init-identity"));
      const other = jsIds.find((i) => !sameIdentity(i.expr, ref.expr));
      if (other) {
        const jsConversions = conversions.filter((t) => t.sdk === "js" && !t.identifierExpr);
        const target = retargetExpr(other.raw, ref.raw);
        const patch = replaceInLine(other.loc, `identify(${other.raw}`, `identify(${target}`);
        findings.push(
          makeFinding(this, {
            severity: "critical",
            title: `The user is identified as ${describe(ref.expr)} for the flag and as ${describe(other.expr)} later`,
            detail: `Flagsmith joins exposures and conversions per identity. The experiment flag is read for \`${ref.expr}\`, but the app later calls identify(${other.raw}), so conversions${jsConversions.length ? " tracked after that" : ""} belong to a different identity that was never exposed. They are not counted.`,
            evidence: [codeItem(`Identity used for the experiment flag: ${ref.expr}`, ref.loc), codeItem(`Different identity: ${other.expr}`, other.loc), ...jsConversions.slice(0, 2).map((c) => codeItem(`Conversion trackEvent(${c.raw})`, c.loc))],
            fix: withPatch(
              {
                summary: `Identify with the same id everywhere: use \`${target}\` instead of \`${other.raw}\`.`,
                steps: ["If you need the email too, send it as a trait, not as the identity."],
                docs: DOCS.codingAgent
              },
              patch
            ),
            confidence: 0.85
          })
        );
      }
    }
    if (findings.length) return fail(findings);
    return pass(`Exposures and conversions both use ${ref.expr}.`);
  }
};
function pickReference(ids, flagFiles) {
  const score = (i) => (i.via === "getExperimentFlag" ? 4 : 0) + (flagFiles.includes(i.loc.file) ? 2 : 0) + (i.via === "identify" || i.via === "init-identity" ? 1 : 0);
  return [...ids].sort((a, b) => score(b) - score(a) || a.loc.file.localeCompare(b.loc.file) || a.loc.line - b.loc.line)[0];
}
function describe(expr) {
  const kind = identityKind(expr);
  return kind === "other" ? `\`${expr}\`` : `${kind === "id" ? "an id" : `an ${kind}`} (\`${expr}\`)`;
}
function mismatchFinding(rule, t, ref) {
  const raw = t.identifierRaw ?? t.identifierExpr;
  const target = retargetExpr(raw, ref.raw);
  const patch = replaceInLine(t.loc, raw, target);
  return makeFinding(rule, {
    severity: "critical",
    title: `Exposures use ${describe(ref.expr)} but conversions use ${describe(t.identifierExpr)}`,
    detail: "Flagsmith counts a conversion only for an identity that was exposed first. The flag is read for one identifier and the conversion is sent for another, so every conversion lands on an identity with no exposure and the metric stays empty.",
    evidence: [codeItem(`Exposure identity: ${ref.expr}`, ref.loc), codeItem(`Conversion identity: ${t.identifierExpr}`, t.loc)],
    fix: withPatch(
      {
        summary: `Send the conversion for the same identity: \`identifier: ${target}\`.`,
        steps: [`At ${where(t.loc)}, use ${target} as the identifier.`, "Send other user details as traits."],
        docs: DOCS.codingAgent
      },
      patch
    ),
    confidence: 0.9
  });
}

// ../core/src/util/urls.ts
function stringLiteral(expr) {
  if (!expr) return null;
  const e = expr.trim();
  const m = /^(['"])((?:\\.|(?!\1).)*)\1$/s.exec(e);
  if (m) return (m[2] ?? "").replace(/\\(.)/g, "$1");
  const t = /^`([^`$]*)`$/s.exec(e);
  if (t) return t[1] ?? "";
  return null;
}
function hostOf(url) {
  const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url.trim());
  return m?.[1]?.toLowerCase() ?? null;
}
function originOf(url) {
  const m = /^([a-z]+:\/\/[^/?#]+)/i.exec(url.trim());
  return m?.[1] ?? null;
}
function isCloudUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return CLOUD_HOSTS.includes(host) || host.endsWith(".flagsmith.com");
}
function isDefaultEventsUrl(url) {
  const host = hostOf(url);
  return host === (hostOf(DEFAULT_EVENTS_API_URL) ?? "");
}
function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}
function selfHostedEventsUrl(apiUrl) {
  const origin = originOf(apiUrl);
  if (!origin) return null;
  const path = apiUrl.trim().slice(origin.length);
  const prefix = /^(.*?)\/api(?:\/v1)?\/?$/.exec(path)?.[1] ?? "";
  return `${origin}${prefix}/api/`;
}
function eventsEndpoint(eventsApiUrl) {
  return `${ensureTrailingSlash(eventsApiUrl || DEFAULT_EVENTS_API_URL)}v1/events`;
}

// ../core/src/rules/ed004-metric-event-name.ts
var ORDER = ["case", "format", "typo"];
var HOW = {
  case: "differs only in letter case",
  format: "uses a different word format",
  typo: "is misspelled"
};
var ed004 = {
  id: "ED-004",
  title: "Tracked event names match the experiment metrics",
  layer: "instrumentation",
  node: "app",
  rank: 80,
  run(ctx) {
    const metrics = ctx.metrics;
    if (metrics === void 0) return skip("Experiment metrics were not collected.");
    if (metrics.length === 0) return skip("The experiment has no metrics (see ED-013).");
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    const literal = code.trackEvents.filter((t) => t.event !== null);
    const dynamic = code.trackEvents.filter((t) => t.event === null);
    const findings = [];
    let unresolved = 0;
    for (const metric of metrics) {
      if (literal.some((t) => t.event === metric.event)) continue;
      const near = literal.map((t) => ({ t, how: compareNames(metric.event, t.event) })).filter((x) => x.how !== "none" && x.how !== "exact").sort((a, b) => ORDER.indexOf(a.how) - ORDER.indexOf(b.how));
      if (near.length) {
        findings.push(nearMiss(this, metric, near[0].t, near[0].how));
      } else if (dynamic.length) {
        unresolved++;
      } else {
        findings.push(neverSent(this, metric, literal));
      }
    }
    if (findings.length) return fail(findings);
    if (unresolved) {
      return skip(`${unresolved} metric event name(s) could not be matched: trackEvent is called with names computed at runtime (${dynamic.map((d) => where(d.loc)).join(", ")}).`);
    }
    return pass(`Every metric event (${metrics.map((m) => `"${m.event}"`).join(", ")}) is tracked with the exact name.`);
  }
};
function nearMiss(rule, metric, t, how) {
  const isLiteral = stringLiteral(t.raw) !== null;
  const patch = isLiteral ? replaceInLine(t.loc, t.raw, quoteLike(t.raw, metric.event)) : null;
  return makeFinding(rule, {
    severity: "critical",
    title: `The app sends "${t.event}" but the metric counts "${metric.event}"`,
    detail: `Event names are case-sensitive and must equal the metric's event name exactly. "${t.event}" ${HOW[how]}, so Flagsmith silently ignores every one of these conversions and "${metric.name}" stays at zero.`,
    evidence: [codeItem(`trackEvent sends "${t.event}"`, t.loc), configItem(`Metric "${metric.name}" counts the event`, metric.event)],
    fix: withPatch(
      {
        summary: `Track the exact event name "${metric.event}".`,
        steps: isLiteral ? [`At ${where(t.loc)}, change ${t.raw} to ${quoteLike(t.raw, metric.event)}.`] : [`${t.raw} resolves to "${t.event}". Change that constant to "${metric.event}".`],
        docs: DOCS.runExperiment
      },
      patch
    ),
    confidence: how === "case" ? 0.97 : how === "format" ? 0.9 : 0.8
  });
}
function neverSent(rule, metric, literal) {
  const sent = [...new Set(literal.map((t) => t.event))];
  return makeFinding(rule, {
    severity: "critical",
    title: `No code sends the metric event "${metric.event}"`,
    detail: sent.length ? `The metric "${metric.name}" counts "${metric.event}", but the scanned code only tracks ${sent.map((s) => `"${s}"`).join(", ")}. Unmatched events are ignored, so the metric stays at zero.` : `The metric "${metric.name}" counts "${metric.event}", but the scanned code never calls trackEvent. If conversions are sent from another service, scan that code too.`,
    evidence: [configItem(`Metric "${metric.name}" counts`, metric.event), ...literal.slice(0, 3).map((t) => codeItem(`trackEvent sends "${t.event}"`, t.loc))],
    fix: {
      summary: `Call trackEvent('${metric.event}') where the conversion happens.`,
      steps: ["Track it for the same identity that saw the flag.", "Or point the metric at an event you already send."],
      docs: DOCS.runExperiment
    },
    confidence: sent.length ? 0.75 : 0.65
  });
}

// ../core/src/rules/ed005-events-not-flushed.ts
var ed005 = {
  id: "ED-005",
  title: "Buffered events are flushed before exit",
  layer: "transport",
  node: "sdk",
  rank: 120,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    const producers = [
      ...code.trackEvents.map((t) => ({ loc: t.loc, sdk: t.sdk, client: t.client })),
      ...code.experimentFlags.map((c) => ({ loc: c.loc, sdk: c.sdk, client: c.client })),
      ...code.exposures.map((e) => ({ loc: e.loc, sdk: "node" }))
    ];
    if (!producers.length) return skip("No code sends experiment events.");
    const runtimeOf = (file) => code.files.find((f) => f.file === file)?.runtime ?? "unknown";
    const projectHasServer = code.files.some((f) => f.runtime === "node-server");
    const byFile = /* @__PURE__ */ new Map();
    for (const p of producers) byFile.set(p.loc.file, [...byFile.get(p.loc.file) ?? [], p]);
    const critical = [];
    const advisory = [];
    for (const [file, ps] of byFile) {
      const runtime = runtimeOf(file);
      const flushedHere = code.flushes.some((f) => f.loc.file === file);
      const client = ps.find((p) => p.client)?.client ?? code.inits.find((i) => i.loc.file === file)?.client ?? "flagsmith";
      const isNode = ps.some((p) => p.sdk === "node");
      if (runtime === "node-script" && !flushedHere) critical.push(scriptFinding(this, file, ps, code, client));
      else if (runtime === "serverless" && !flushedHere) critical.push(serverlessFinding(this, ps[0], client, isNode));
      else if ((runtime === "node-server" || isNode && projectHasServer) && !code.flushes.some((f) => f.inExitHandler)) {
        advisory.push(serverFinding(this, ps[0], client));
      } else if ((runtime === "browser" || runtime === "react") && code.flushes.length === 0) {
        advisory.push(browserFinding(this, ps[0], client));
      }
    }
    if (critical.length) return fail([...critical, ...advisory]);
    const warnings = advisory.filter((f) => f.severity !== "info");
    if (warnings.length) return fail(advisory);
    if (advisory.length) return { status: "pass", findings: advisory, note: "Events flush on the SDK timer; the last few seconds before a page closes can be lost." };
    return pass(code.flushes.length ? `Events are flushed (${code.flushes.map((f) => `${f.method}() at ${where(f.loc)}`).join(", ")}).` : "Long-lived app: the SDK flushes every 10 s.");
  }
};
function scriptFinding(rule, file, ps, code, client) {
  const exit = code.exits.find((e) => e.loc.file === file && e.kind === "process.exit");
  const isNode = ps.some((p) => p.sdk === "node");
  const call = isNode ? `await ${client}.close();` : `await ${client}.flushEvents();`;
  const patch = exit ? insertBefore(exit.loc, call) : null;
  return makeFinding(rule, {
    severity: "critical",
    title: "The script exits before buffered events are sent",
    detail: `The SDK buffers events and sends them every ${EVENTS_FLUSH_INTERVAL_SECONDS} seconds. This script ${exit ? "calls process.exit()" : "ends"} without ${isNode ? "close()" : "flushEvents()"}, so every exposure and conversion still in the buffer is dropped. Nothing reaches Flagsmith, and no error is shown.`,
    evidence: [codeItem("Events are produced here", ps[0].loc), ...exit ? [codeItem("The process exits here with no flush", exit.loc)] : []],
    fix: withPatch(
      {
        summary: `Call \`${call}\` before the script exits.`,
        steps: isNode ? ["close() sends the buffered events and stops the client (Node SDK)."] : ["flushEvents() sends the buffered events now."],
        docs: DOCS.codingAgent
      },
      patch
    ),
    confidence: exit ? 0.92 : 0.8
  });
}
function serverlessFinding(rule, p, client, isNode) {
  return makeFinding(rule, {
    severity: "critical",
    title: "The function returns before buffered events are sent",
    detail: "Serverless functions and route handlers can be frozen or stopped as soon as they respond. The SDK sends events on a timer (every 10 seconds unless flushInterval is set), so events tracked in the request are usually lost.",
    evidence: [codeItem("Events are produced in a request handler with no flush", p.loc)],
    fix: {
      summary: `Await \`${client}.flushEvents()\` before returning the response.`,
      steps: [`In ${p.loc.file}, add \`await ${client}.flushEvents();\` right before the handler returns.${isNode ? " (Node SDK: flushEvents() keeps the client usable; close() would stop it.)" : ""}`],
      docs: DOCS.runExperiment
    },
    confidence: 0.8
  });
}
function serverFinding(rule, p, client) {
  return makeFinding(rule, {
    severity: "warning",
    title: "Events buffered at shutdown are lost",
    detail: "A long-running server flushes on a timer (every 10 seconds unless flushInterval is set), but a deploy or restart drops whatever is still buffered. Close the client on SIGTERM so the last batch is sent.",
    evidence: [codeItem("Events are produced by a server process with no shutdown flush", p.loc)],
    fix: {
      summary: `Call \`await ${client}.close()\` in a SIGTERM handler.`,
      steps: [`process.on('SIGTERM', async () => { await ${client}.close(); process.exit(0); });`],
      docs: DOCS.runExperiment
    },
    confidence: 0.6
  });
}
function browserFinding(rule, p, client) {
  return makeFinding(rule, {
    severity: "info",
    title: "Events tracked just before the page closes can be lost",
    detail: "The browser SDK sends events on a timer (every 10 seconds unless flushInterval is set). A conversion tracked right before navigation (for example a redirect to a payment page) may never be sent. Flush on pagehide to keep it.",
    evidence: [codeItem("Events are produced in the browser; no flushEvents() found", p.loc)],
    fix: {
      summary: `Flush on pagehide: \`window.addEventListener('pagehide', () => ${client}.flushEvents())\`.`,
      docs: DOCS.runExperiment
    },
    confidence: 0.5
  });
}

// ../core/src/rules/ed006-events-endpoint.ts
var INGESTION_PLACEHOLDER = "https://<your-events-host>/";
var ed006 = {
  id: "ED-006",
  title: "Events go to the same Flagsmith as the flags",
  layer: "transport",
  node: "sdk",
  rank: 110,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    if (!code.inits.length) return skip("No SDK initialisation was found in the scanned code.");
    const findings = [];
    const notes = [];
    for (const init of code.inits) {
      const f = check(this, ctx, init, notes);
      if (f) findings.push(f);
    }
    if (findings.length) return fail(findings);
    if (notes.length) return skip(notes.join(" "));
    return pass("Flags and events point at the same Flagsmith.");
  }
};
function check(rule, ctx, init, notes) {
  const env = ctx.config?.environment;
  const warehouses = ctx.config?.warehouses;
  const usesFlagsmithDb = warehouses ? warehouses.some((w) => w.flagsmithDatabase) : void 0;
  const apiLit = stringLiteral(init.apiUrl);
  const eventsLit = stringLiteral(init.eventsApiUrl);
  const apiOpt = init.sdk === "node" ? "apiUrl" : "api";
  const indent = init.propIndent ?? "  ";
  if (init.opaque && (init.apiUrl === null || init.eventsApiUrl === null)) {
    notes.push(`The SDK options at ${init.loc.file}:${init.loc.line} are built elsewhere (a spread or a helper), so ${apiOpt} and eventsApiUrl cannot be checked statically.`);
    return null;
  }
  if (apiLit && !isCloudUrl(apiLit)) {
    const expected = usesFlagsmithDb === false ? null : selfHostedEventsUrl(apiLit);
    const target = expected ?? INGESTION_PLACEHOLDER;
    if (init.eventsApiUrl === null) {
      const patch = !init.hasEventProcessorConfig && init.apiUrlLoc ? insertAfter(init.apiUrlLoc, [`eventProcessorConfig: { eventsApiUrl: '${target}' },`], indent, !expected) : null;
      return makeFinding(rule, {
        severity: "critical",
        title: `Flags come from ${hostOf(apiLit)} but events go to Flagsmith Cloud`,
        detail: `The SDK reads flags from your self-hosted API, but no events URL is set, so exposures and conversions are posted to ${DEFAULT_EVENTS_API_URL}. Flagsmith Cloud does not know this environment key, so every event is dropped.`,
        evidence: [codeItem(`${apiOpt}: ${apiLit}`, init.apiUrlLoc ?? init.loc), codeItem("No eventProcessorConfig.eventsApiUrl", init.loc, eventsEndpoint(null))],
        fix: withPatch(
          {
            summary: `Set \`eventProcessorConfig.eventsApiUrl\` to ${expected ? `'${expected}'` : "your event ingestion URL"}.`,
            steps: expected ? ["With the Flagsmith database as the warehouse, the events URL is your API URL ending in /api/ (the SDK appends v1/events)."] : ["Your warehouse is not the Flagsmith database, so use the URL of your event ingestion service."],
            docs: DOCS.codingAgent
          },
          patch
        ),
        confidence: 0.92
      });
    }
    if (eventsLit && isDefaultEventsUrl(eventsLit)) {
      const patch = init.eventsApiUrlLoc ? replaceInLine(init.eventsApiUrlLoc, eventsLit, target) : null;
      return makeFinding(rule, {
        severity: "critical",
        title: `Flags come from ${hostOf(apiLit)} but events are sent to Flagsmith Cloud`,
        detail: "eventsApiUrl is the Cloud events host while flags come from your own Flagsmith. Cloud rejects events for environments it does not have.",
        evidence: [codeItem(`${apiOpt}: ${apiLit}`, init.apiUrlLoc ?? init.loc), codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc)],
        fix: withPatch({ summary: `Point eventsApiUrl at ${target}.`, docs: DOCS.codingAgent }, patch),
        confidence: 0.95
      });
    }
    if (eventsLit && /\/api\/v1\/?$/.test(eventsLit)) {
      const fixed = selfHostedEventsUrl(eventsLit) ?? target;
      const patch = init.eventsApiUrlLoc ? replaceInLine(init.eventsApiUrlLoc, eventsLit, fixed) : null;
      return makeFinding(rule, {
        severity: "critical",
        title: "eventsApiUrl ends in /api/v1/, so events go to /api/v1/v1/events",
        detail: `The SDK appends v1/events to eventsApiUrl, so this posts to ${eventsEndpoint(eventsLit)}, which does not exist. The events URL must end in /api/.`,
        evidence: [codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc, eventsEndpoint(eventsLit))],
        fix: withPatch({ summary: `Use '${fixed}' as eventsApiUrl.`, docs: DOCS.codingAgent }, patch),
        confidence: 0.95
      });
    }
    if (eventsLit && usesFlagsmithDb && originOf(eventsLit) !== originOf(apiLit)) {
      return makeFinding(rule, {
        severity: "warning",
        title: "Events go to a different host than the flags",
        detail: `This environment stores events in the Flagsmith database, so events must go to your Flagsmith API (${expected}), but eventsApiUrl points at ${hostOf(eventsLit)}.`,
        evidence: [codeItem(`${apiOpt}: ${apiLit}`, init.apiUrlLoc ?? init.loc), codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc)],
        fix: withPatch({ summary: `Use '${expected}' as eventsApiUrl.`, docs: DOCS.codingAgent }, init.eventsApiUrlLoc && expected ? replaceInLine(init.eventsApiUrlLoc, eventsLit, expected) : null),
        confidence: 0.75
      });
    }
    return null;
  }
  if (env?.selfHosted && env.apiUrl && init.apiUrl === null) {
    const origin = originOf(env.apiUrl) ?? env.apiUrl;
    const lines = [`${apiOpt}: '${origin}/api/v1/',`, `eventProcessorConfig: { eventsApiUrl: '${origin}/api/' },`];
    const patch = !init.hasEventProcessorConfig && init.insertAfter ? insertAfter(init.insertAfter, lines, indent) : null;
    return makeFinding(rule, {
      severity: "critical",
      title: `The experiment lives on ${hostOf(origin)} but the app talks to Flagsmith Cloud`,
      detail: `flagsmith.json points at a self-hosted Flagsmith (${origin}), but the SDK sets no ${apiOpt} and no events URL, so it reads flags from and sends events to Flagsmith Cloud.`,
      evidence: [configItem("Flagsmith CLI API URL", origin), codeItem(`No ${apiOpt} and no eventsApiUrl`, init.loc)],
      fix: withPatch({ summary: `Set ${apiOpt} and eventProcessorConfig.eventsApiUrl to your Flagsmith.`, docs: DOCS.codingAgent }, patch),
      confidence: 0.85
    });
  }
  if ((init.apiUrl === null || apiLit && isCloudUrl(apiLit)) && eventsLit && !isCloudUrl(eventsLit)) {
    return makeFinding(rule, {
      severity: "critical",
      title: `Flags come from Flagsmith Cloud but events go to ${hostOf(eventsLit)}`,
      detail: `No self-hosted ${apiOpt} is set, so flags come from Flagsmith Cloud, yet events are posted to ${eventsEndpoint(eventsLit)}. Exposures never reach the environment the flags came from.`,
      evidence: [codeItem(`eventsApiUrl: ${eventsLit}`, init.eventsApiUrlLoc ?? init.loc)],
      fix: {
        summary: env?.selfHosted === false || !env ? "On Flagsmith Cloud, remove eventsApiUrl (the SDK default is correct)." : `Set ${apiOpt} to your self-hosted API as well.`,
        steps: [`If you self-host, also set ${apiOpt} to your Flagsmith API URL.`],
        docs: DOCS.codingAgent
      },
      confidence: 0.7
    });
  }
  if (init.apiUrl !== null && apiLit === null) {
    if (init.eventsApiUrl === null && env?.selfHosted && env.apiUrl) {
      const expected = `${originOf(env.apiUrl) ?? env.apiUrl}/api/`;
      return makeFinding(rule, {
        severity: "warning",
        title: "The API URL is configurable but no events URL is set",
        detail: `${apiOpt} comes from runtime config and flagsmith.json points at a self-hosted Flagsmith, but no eventsApiUrl is set, so events still go to Flagsmith Cloud.`,
        evidence: [codeItem(`${apiOpt}: ${init.apiUrl}`, init.apiUrlLoc ?? init.loc), configItem("Flagsmith CLI API URL", env.apiUrl)],
        fix: withPatch(
          { summary: `Set eventProcessorConfig.eventsApiUrl to '${expected}' (or derive it from the same setting).`, docs: DOCS.codingAgent },
          !init.hasEventProcessorConfig && init.apiUrlLoc ? insertAfter(init.apiUrlLoc, [`eventProcessorConfig: { eventsApiUrl: '${expected}' },`], indent) : null
        ),
        confidence: 0.6
      });
    }
    notes.push(`${apiOpt} is set at runtime (${init.apiUrl}), so the endpoints cannot be checked statically.`);
  }
  return null;
}

// ../core/src/rules/ed007-no-warehouse.ts
var ed007 = {
  id: "ED-007",
  title: "The environment has a connected warehouse",
  layer: "ingestion",
  node: "warehouse",
  rank: 10,
  run(ctx) {
    const warehouses = ctx.config?.warehouses;
    if (warehouses === void 0) return skip("Warehouse connections were not collected.");
    const env = ctx.config?.environment?.name ?? "this environment";
    const selfHosted = ctx.config?.environment?.selfHosted === true;
    if (warehouses.length === 0) {
      return fail([
        makeFinding(this, {
          severity: "critical",
          title: `${env === "this environment" ? "This environment" : `"${env}"`} has no warehouse, so every event is rejected`,
          detail: "Experiment events are stored in a warehouse connected to the environment. With none connected, the ingestion service rejects exposures and conversions, so the experiment can never show data, however correct the code is.",
          evidence: [configItem(`GET warehouse-connections for ${env}`, "[] (none)")],
          fix: {
            summary: "Connect a warehouse to this environment, then re-run the check.",
            steps: selfHosted ? ["On self-hosted PostgreSQL you can store events in the Flagsmith database itself (command below).", "Otherwise connect Snowflake, ClickHouse, Databricks or PostgreSQL in the environment settings."] : ["Connect a warehouse in the environment settings of the Flagsmith dashboard (Experiments)."],
            command: selfHosted ? connectFlagsmithDatabaseCommand() : listWarehousesCommand(),
            docs: DOCS.runExperiment
          },
          confidence: 0.98
        })
      ]);
    }
    const connected = warehouses.filter((w2) => w2.status === "connected");
    if (connected.length) {
      const w2 = connected[0];
      return pass(`Warehouse "${w2.type}${w2.flagsmithDatabase ? " (Flagsmith database)" : ""}" is connected.`);
    }
    const w = warehouses[0];
    const errored = w.status === "errored";
    return fail([
      makeFinding(this, {
        severity: errored ? "critical" : "warning",
        title: errored ? `The ${w.type} warehouse connection is failing` : `The ${w.type} warehouse is not connected yet (status "${w.status}")`,
        detail: errored ? `Flagsmith cannot deliver events to the warehouse${w.statusDetail ? `: "${w.statusDetail}"` : ""}. Until it is fixed, events are not stored and results cannot be computed.` : "The connection exists but has not been verified as connected, so events may not be stored yet.",
        evidence: [configItem(`Warehouse ${w.id} (${w.type}) status`, w.statusDetail ? `${w.status}: ${w.statusDetail}` : w.status)],
        fix: {
          summary: errored ? "Fix the warehouse credentials or permissions, then test the connection again." : "Finish setting up the warehouse connection and test it.",
          steps: ['In the environment settings, open the warehouse connection and run "Test connection".'],
          command: listWarehousesCommand(),
          docs: DOCS.runExperiment
        },
        confidence: errored ? 0.95 : 0.6
      })
    ]);
  }
};

// ../core/src/rules/ed008-experiment-not-running.ts
var ed008 = {
  id: "ED-008",
  title: "The experiment is running",
  layer: "config",
  node: "flagsmith",
  rank: 20,
  run(ctx) {
    const exp = ctx.experiment;
    if (exp === void 0) return skip("The experiment was not collected.");
    if (exp === null) {
      const flag = ctx.flagKey ?? "<flag>";
      return fail([
        makeFinding(this, {
          severity: "critical",
          title: `There is no experiment for "${flag}" in this environment`,
          detail: "Exposures are only recorded for flags with a running experiment. Without one, getExperimentFlag behaves like a normal flag read.",
          evidence: [configItem("GET experiments/ returned no experiment for the flag", flag)],
          fix: { summary: "Create a metric and an experiment for the flag, then start it.", command: createExperimentHint(flag), docs: DOCS.codingAgent },
          confidence: 0.9
        })
      ]);
    }
    switch (exp.status) {
      case "running":
        return pass(`Experiment "${exp.name}" is running.`);
      case "created":
        return fail([
          makeFinding(this, {
            severity: "critical",
            title: `Experiment "${exp.name}" was created but never started`,
            detail: 'An experiment in the "created" state is a draft: no identity is enrolled, so the SDK sees no experiment on the flag and getExperimentFlag records no exposures.',
            evidence: [configItem(`Experiment ${exp.id} status`, "created")],
            fix: {
              summary: "Start the experiment. This locks the flag and turns on the rollout, so it needs your approval.",
              command: startExperimentCommand(exp.id),
              docs: DOCS.codingAgent
            },
            confidence: 0.98
          })
        ]);
      case "paused":
        return fail([
          makeFinding(this, {
            severity: "critical",
            title: `Experiment "${exp.name}" is paused`,
            detail: "While paused, the experiment is not attached to the flag, so the SDK does not enrol identities and getExperimentFlag records no new exposures.",
            evidence: [configItem(`Experiment ${exp.id} status`, "paused")],
            fix: { summary: "Resume the experiment when you are ready to collect data again.", command: startExperimentCommand(exp.id, true), docs: DOCS.codingAgent },
            confidence: 0.95
          })
        ]);
      case "completed":
        return fail([
          makeFinding(this, {
            severity: "critical",
            title: `Experiment "${exp.name}" is completed and no longer collects data`,
            detail: "A completed experiment is final. New exposures and conversions are not added to it.",
            evidence: [configItem(`Experiment ${exp.id} status`, `completed${exp.endedAt ? ` at ${exp.endedAt}` : ""}`)],
            fix: { summary: "To keep testing, create a new experiment on the flag and start it.", command: createExperimentHint(ctx.flagKey ?? exp.featureName ?? "<flag>"), docs: DOCS.codingAgent },
            confidence: 0.9
          })
        ]);
      default:
        return skip(`Unknown experiment status "${exp.status}".`);
    }
  }
};

// ../core/src/rules/ed009-enable-events.ts
var ed009 = {
  id: "ED-009",
  title: "The SDK is initialised with enableEvents: true",
  layer: "instrumentation",
  node: "sdk",
  rank: 60,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    if (!code.inits.length) {
      const usesEvents = code.experimentFlags.length + code.trackEvents.length > 0;
      return skip(usesEvents ? "The SDK is used, but its initialisation was not found in the scanned code." : "No SDK initialisation was found.");
    }
    const unknown = code.inits.filter((i) => i.opaque && i.enableEvents === null);
    const visible = code.inits.filter((i) => !unknown.includes(i));
    const off = visible.filter((i) => i.enableEvents === null || i.enableEvents === "false");
    const dynamic = visible.filter((i) => i.enableEvents !== null && i.enableEvents !== "true" && i.enableEvents !== "false");
    const expFiles = [...new Set([...code.experimentFlags, ...code.trackEvents, ...code.exposures].map((x) => x.loc.file))];
    const stem = (p) => p.replace(/\.(?:[mc]?[jt]sx?)$/i, "");
    const importedBy = (initFile, file) => (code.files.find((f) => f.file === file)?.imports ?? []).some((imp) => imp === stem(initFile) || `${imp}/index` === stem(initFile));
    const serves = (i) => expFiles.length === 0 || code.inits.length === 1 || expFiles.includes(i.loc.file) || expFiles.some((f) => importedBy(i.loc.file, f));
    const everyInitOff = unknown.length === 0 && off.length === visible.length;
    const blamed = off.filter((i) => everyInitOff || serves(i));
    const excused = off.filter((i) => !blamed.includes(i));
    if (blamed.length) {
      const init = blamed[0];
      return fail([
        makeFinding(this, {
          severity: "critical",
          title: init.enableEvents === "false" ? "Events are turned off: enableEvents is false" : "enableEvents is missing, so the SDK sends no events",
          detail: `${detailFor(init)}${init.enableAnalytics ? " Note: enableAnalytics is a different setting (flag usage analytics). It does not send experiment events." : ""}`,
          evidence: [codeItem(`${initName(init)} without enableEvents: true`, init.loc), ...init.enableAnalytics ? [codeItem(`enableAnalytics: ${init.enableAnalytics}`, init.loc)] : []],
          fix: withPatch({ summary: "Add `enableEvents: true` to the SDK options.", steps: [`In ${where(init.loc)}, add enableEvents: true next to the environment key.`], docs: DOCS.runExperiment }, patchFor(init)),
          confidence: 0.95
        })
      ]);
    }
    const notes = [];
    if (unknown.length) notes.push(`The SDK options at ${unknown.map((i) => where(i.loc)).join(", ")} are built elsewhere (a spread or a helper), so enableEvents cannot be read: unknown, not missing.`);
    if (dynamic.length) notes.push(`enableEvents is computed at runtime (\`${dynamic[0].enableEvents}\` at ${where(dynamic[0].enableEventsLoc ?? dynamic[0].loc)}); make sure it is true where the experiment runs.`);
    if (notes.length) return skip(notes.join(" "));
    const on = visible.filter((i) => i.enableEvents === "true");
    if (excused.length) {
      return pass(
        `enableEvents: true is set where the experiment runs (${on.map((i) => where(i.loc)).join(", ")}). ${excused.map((i) => where(i.loc)).join(", ")} has no enableEvents, but no experiment call uses that init, so it is not a defect.`
      );
    }
    return pass(`enableEvents: true is set (${code.inits.map((i) => where(i.loc)).join(", ")}).`);
  }
};
function initName(init) {
  if (init.style === "provider") return "<FlagsmithProvider options>";
  if (init.style === "constructor") return "new Flagsmith({...})";
  return "flagsmith.init({...})";
}
function detailFor(init) {
  return init.sdk === "node" ? 'The Node SDK only creates its event processor when enableEvents is true. Without it, getExperimentFlag and trackEvent throw "ValueError: enableEvents must be true".' : "The JavaScript SDK only starts its event pipeline when enableEvents is true. Without it, getExperimentFlag degrades to a plain flag read (no exposure) and trackEvent does nothing, silently.";
}
function patchFor(init) {
  if (init.enableEvents === "false" && init.enableEventsLoc) {
    return replaceInLine(init.enableEventsLoc, "false", "true");
  }
  if (init.insertAfter) return insertAfter(init.insertAfter, ["enableEvents: true,"], init.propIndent ?? "  ");
  return null;
}

// ../core/src/util/semver.ts
function parseVersion(text) {
  if (!text) return null;
  const m = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(text);
  if (!m) return null;
  const part = (s) => s === void 0 || s === "x" || s === "*" ? 0 : Number(s);
  return [Number(m[1]), part(m[2]), part(m[3])];
}
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
var gte = (a, b) => compareVersions(a, b) >= 0;
function parseRange(range) {
  if (range === null || range === void 0) return null;
  let r = range.trim();
  const alias = /^npm:(?:@[^/]+\/)?[^@]+@(.+)$/.exec(r);
  if (alias?.[1]) r = alias[1];
  if (r === "" || r === "*" || r === "x" || r === "latest" || r.startsWith("workspace:")) {
    return { min: [0, 0, 0], accepts: () => true, exact: false };
  }
  if (/^(file:|link:|git|https?:|github:)/.test(r)) return null;
  const first = r.split("||")[0].trim().split(/\s+/)[0];
  const op = /^(\^|~|>=|>|=|<=|<)?v?(.*)$/.exec(first);
  if (!op) return null;
  const operator = op[1] ?? "";
  const body = op[2] ?? "";
  const v = parseVersion(body);
  if (!v) return null;
  const parts = body.split(".");
  const wildcard = parts.length < 3 || parts.some((p) => p === "x" || p === "*");
  switch (operator) {
    case ">=":
    case ">":
      return { min: v, accepts: (t) => gte(t, v), exact: false };
    case "<":
    case "<=":
      return { min: [0, 0, 0], accepts: (t) => compareVersions(t, v) < (operator === "<=" ? 1 : 0), exact: false };
    case "^":
      if (v[0] > 0) return { min: v, accepts: (t) => t[0] === v[0] && gte(t, v), exact: false };
      return { min: v, accepts: (t) => t[0] === 0 && t[1] === v[1] && gte(t, v), exact: false };
    case "~":
      return { min: v, accepts: (t) => t[0] === v[0] && t[1] === v[1] && gte(t, v), exact: false };
    default:
      if (wildcard) {
        return {
          min: v,
          accepts: (t) => t[0] === v[0] && (parts.length < 2 || parts[1] === "x" || parts[1] === "*" || t[1] === v[1]),
          exact: false
        };
      }
      return { min: v, accepts: (t) => compareVersions(t, v) === 0, exact: true };
  }
}
function rangeCanSatisfy(range, target) {
  if (gte(range.min, target)) return true;
  if (range.exact) return false;
  const probes = [target, [target[0], target[1], target[2] + 1], [target[0], target[1] + 1, 0], [target[0], 99, 0]];
  return probes.some((p) => range.accepts(p));
}

// ../core/src/rules/ed010-sdk-too-old.ts
var ed010 = {
  id: "ED-010",
  title: "The SDK version can send experiment events",
  layer: "instrumentation",
  node: "sdk",
  rank: 50,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    if (!code.packages.length) return skip("No package.json in the scanned code declares a Flagsmith SDK.");
    const findings = [];
    const unsure = [];
    const ok = [];
    for (const pkg of code.packages) {
      const req = SDK_REQUIREMENTS.find((r) => r.name === pkg.name);
      if (req.minVersion === null) {
        findings.push(replacedPackage(this, pkg));
        continue;
      }
      const min = parseVersion(req.minVersion);
      const installed = parseVersion(pkg.installed);
      if (installed) {
        if (compareVersions(installed, min) < 0) findings.push(tooOld(this, pkg, `installed ${pkg.installed}`));
        else ok.push(`${pkg.name}@${pkg.installed}`);
        continue;
      }
      const range = parseRange(pkg.range);
      if (!range) {
        unsure.push(`${pkg.name} "${pkg.range}" cannot be read`);
        continue;
      }
      if (compareVersions(range.min, min) >= 0) ok.push(`${pkg.name}@${pkg.range}`);
      else if (!rangeCanSatisfy(range, min)) findings.push(tooOld(this, pkg, `"${pkg.range}" in package.json`));
      else unsure.push(`${pkg.name} "${pkg.range}" also allows versions below ${req.minVersion}; the installed version is unknown (run npm ls ${pkg.name})`);
    }
    if (findings.length) return fail(findings);
    if (unsure.length) return skip(unsure.join(". "));
    return pass(`SDK versions support experiments: ${ok.join(", ")}.`);
  }
};
function tooOld(rule, pkg, seen) {
  const req = SDK_REQUIREMENTS.find((r) => r.name === pkg.name);
  const target = `^${req.recommended ?? req.minVersion}`;
  const patch = pkg.range ? replaceInLine(pkg.manifest, `"${pkg.range}"`, `"${target}"`) : null;
  return makeFinding(rule, {
    severity: "critical",
    title: `${pkg.name} is too old to send experiment events (${seen})`,
    detail: `Experiments need ${pkg.name} ${req.minVersion} or newer. Older versions have no event pipeline, or record exposures without the experiment enrolment check, so the experiment gets no usable data.`,
    evidence: [codeItem(`${pkg.name} ${seen}`, pkg.manifest)],
    fix: withPatch(
      {
        summary: `Upgrade ${pkg.name} to ${target}, then reinstall.`,
        steps: [`npm install ${pkg.name}@${req.recommended ?? req.minVersion}`],
        docs: DOCS.codingAgent
      },
      patch
    ),
    confidence: pkg.installed ? 0.97 : 0.9
  });
}
function replacedPackage(rule, pkg) {
  const req = SDK_REQUIREMENTS.find((r) => r.name === pkg.name);
  const repl = SDK_REQUIREMENTS.find((r) => r.name === req.replacement);
  const version = repl?.recommended ?? repl?.minVersion ?? "latest";
  const patch = req.replacement && pkg.range ? replaceInLine(pkg.manifest, `"${pkg.name}": "${pkg.range}"`, `"${req.replacement}": "^${version}"`) : null;
  return makeFinding(rule, {
    severity: req.kind === "react-native" ? "warning" : "critical",
    title: `${pkg.name} cannot send experiment events`,
    detail: `${req.note}${req.replacement ? ` Move to ${req.replacement} ${repl?.minVersion ?? ""}+.` : ""}`,
    evidence: [codeItem(`${pkg.name} ${pkg.range ?? ""}`.trim(), pkg.manifest)],
    fix: withPatch(
      {
        summary: req.replacement ? `Replace ${pkg.name} with ${req.replacement}@^${version} and update the imports.` : `Use an SDK that supports experiments.`,
        steps: req.replacement ? [`npm uninstall ${pkg.name} && npm install ${req.replacement}@${version}`, `Change imports from '${pkg.name}' to '${req.replacement}'.`] : [],
        docs: DOCS.codingAgent
      },
      patch
    ),
    confidence: 0.95
  });
}

// ../core/src/rules/ed011-no-exposure-call.ts
var ed011 = {
  id: "ED-011",
  title: "The experiment flag is read with getExperimentFlag",
  layer: "instrumentation",
  node: "app",
  rank: 70,
  run(ctx) {
    const code = ctx.code;
    if (!code) return skip("Code was not scanned.");
    const key = ctx.flagKey;
    const exp = code.experimentFlags;
    const reads = code.plainFlagReads;
    if (key) {
      const viaExperiment = exp.filter((c) => c.flag === key);
      const viaExposure = code.exposures.filter((e) => e.flag === key);
      if (viaExperiment.length || viaExposure.length) {
        const first = viaExperiment[0]?.loc ?? viaExposure[0].loc;
        return pass(`"${key}" records exposures (${viaExperiment.length ? viaExperiment[0].method : "trackExposureEvent"} at ${where(first)}).`);
      }
      const plain = reads.filter((r) => r.flag === key);
      if (plain.length) return fail([plainRead(this, key, plain)]);
      if (exp.some((c) => c.flag === null)) return skip("getExperimentFlag is called with a flag name computed at runtime.");
      const bulk = reads.filter((r) => r.flag === null);
      if (bulk.length) {
        return fail([
          makeFinding(this, {
            severity: "warning",
            title: `"${key}" is only read through ${bulk[0].method}(), which records no exposure`,
            detail: "Reading all flags at once evaluates them but never records an exposure, so the experiment sees no enrolled users.",
            evidence: bulk.slice(0, 3).map((r) => codeItem(`${r.method}()`, r.loc)),
            fix: { summary: `Read the flag with getExperimentFlag('${key}') where the user sees the variation.`, docs: DOCS.runExperiment },
            confidence: 0.6
          })
        ]);
      }
      return fail([
        makeFinding(this, {
          severity: "warning",
          title: `The scanned code never reads "${key}"`,
          detail: "No call reads the experiment flag, so nothing records exposures. If the flag is read in another app or package, scan that directory instead.",
          evidence: [{ label: `No reference to "${key}" in ${code.scannedFiles} scanned files`, source: "code" }],
          fix: { summary: `Call getExperimentFlag('${key}') where the user sees the variation, or run the check on the right directory with --dir.`, docs: DOCS.runExperiment },
          confidence: 0.5
        })
      ]);
    }
    if (exp.length || code.exposures.length) return pass("Exposures are recorded with getExperimentFlag (flag key unknown).");
    if (reads.length && code.trackEvents.length) {
      return fail([
        makeFinding(this, {
          severity: "warning",
          title: "Conversions are tracked but no code records exposures",
          detail: "The app tracks events and reads flags, but never calls getExperimentFlag or trackExposureEvent, so no user is counted as exposed.",
          evidence: reads.slice(0, 3).map((r) => codeItem(`${r.method}(${r.flag ? `'${r.flag}'` : ""})`, r.loc)),
          fix: { summary: "Read the experiment flag with getExperimentFlag (useExperiment in React). Pass --flag to check a specific flag.", docs: DOCS.runExperiment },
          confidence: 0.6
        })
      ]);
    }
    return skip("No experiment flag key is known and no flag reads were found.");
  }
};
function plainRead(rule, key, plain) {
  const r = plain[0];
  let patch = null;
  let summary = `Read "${key}" with getExperimentFlag where the user sees it.`;
  if (r.method === "getValue") {
    patch = rewriteCall(r.loc, "getValue", "getExperimentFlag", "?.value");
    summary = `Replace getValue('${key}') with getExperimentFlag('${key}')?.value.`;
  } else if (r.method === "hasFeature") {
    patch = rewriteCall(r.loc, "hasFeature", "getExperimentFlag", "?.enabled");
    summary = `Replace hasFeature('${key}') with getExperimentFlag('${key}')?.enabled.`;
  } else if (r.method === "useFlags") {
    summary = `Use \`const flag = useExperiment('${key}')\` from flagsmith/react instead of useFlags(['${key}']).`;
  } else if (r.method === "getFeatureValue" || r.method === "isFeatureEnabled" || r.method === "getFlag") {
    summary = `Use \`await client.getExperimentFlag('${key}', identifier)\` instead of getIdentityFlags(...).${r.method}('${key}').`;
  }
  return makeFinding(rule, {
    severity: "critical",
    title: `"${key}" is read with ${r.method}(), which records no exposure`,
    detail: `Only getExperimentFlag (useExperiment in React) records the exposure that enrols a user in the experiment. ${r.method}() returns the same variation but tells Flagsmith nothing, so the experiment shows no exposures and conversions are never attributed.`,
    evidence: plain.slice(0, 3).map((p) => codeItem(`${p.method}('${key}')`, p.loc)),
    fix: withPatch(
      {
        summary,
        steps: ["If the flag is evaluated in one place and shown in another, keep the normal read and call trackExposureEvent at display time instead."],
        docs: DOCS.runExperiment
      },
      patch
    ),
    confidence: 0.93
  });
}

// ../core/src/rules/ed012-results-collecting.ts
var ed012 = {
  id: "ED-012",
  title: "Each variation has enough data for results",
  layer: "results",
  node: "results",
  rank: 150,
  run(ctx) {
    const exp = ctx.experiment;
    if (!exp) return skip("No experiment to read results for.");
    if (exp.status !== "running" && exp.status !== "completed") return skip(`The experiment is ${exp.status}.`);
    const results = ctx.config?.results;
    if (results === void 0) return skip("Results were not collected.");
    if (results === null) {
      return {
        status: "pending",
        findings: [
          makeFinding(this, {
            kind: "pending",
            severity: "info",
            title: "Results have not been computed yet",
            detail: `Flagsmith computes results on request. Refresh them (at most every ${RESULTS_REFRESH_MINUTES} minutes) and check again. This is not a failure.`,
            evidence: [{ label: "GET results/ returned null", source: "results" }],
            fix: { summary: "Refresh the results, wait a few minutes, then run verify.", command: refreshResultsCommand(exp.id), docs: DOCS.codingAgent },
            confidence: 0.9
          })
        ]
      };
    }
    const expected = /* @__PURE__ */ new Set(["control", ...(ctx.config?.flag?.variants ?? []).map((v) => v.key).filter((k) => !!k)]);
    const short = [];
    let worst = Infinity;
    for (const metric of results.metrics) {
      const name = ctx.metrics?.find((m) => m.id === metric.metricId)?.name ?? `metric ${metric.metricId}`;
      const occurrence = (metric.aggregation ?? ctx.metrics?.find((m) => m.id === metric.metricId)?.aggregation) === "occurrence";
      const seen = new Map(metric.variants.map((v) => [v.variant, v]));
      for (const key of /* @__PURE__ */ new Set([...expected, ...seen.keys()])) {
        const v = seen.get(key);
        const ids = v?.identities ?? 0;
        const conv = v?.conversions ?? 0;
        const lowIds = ids < RESULTS_MIN_IDENTITIES_PER_VARIANT;
        const lowConv = occurrence && conv < RESULTS_MIN_CONVERSIONS_PER_VARIANT;
        if (lowIds || lowConv) {
          worst = Math.min(worst, ids / RESULTS_MIN_IDENTITIES_PER_VARIANT);
          short.push({
            label: `${name}, ${key}: ${ids}/${RESULTS_MIN_IDENTITIES_PER_VARIANT} identities${occurrence ? `, ${conv}/${RESULTS_MIN_CONVERSIONS_PER_VARIANT} conversions` : ""}`,
            source: "results"
          });
        }
      }
    }
    if (!results.metrics.length) short.push({ label: "Results contain no metric yet", source: "results" });
    if (!short.length) return pass(`Every variation has at least ${RESULTS_MIN_IDENTITIES_PER_VARIANT} identities${results.asOf ? ` (as of ${results.asOf})` : ""}.`);
    return {
      status: "pending",
      findings: [
        makeFinding(this, {
          kind: "pending",
          severity: "info",
          title: "Still collecting data: not every variation has enough users yet",
          detail: `Flagsmith shows "collecting data" until each variation has ${RESULTS_MIN_IDENTITIES_PER_VARIANT} identities and, for occurrence metrics, ${RESULTS_MIN_CONVERSIONS_PER_VARIANT} conversions. The pipeline can be healthy and still be here. Keep the experiment running.`,
          evidence: short.slice(0, 8),
          fix: {
            summary: "Wait for more traffic, refresh the results, then run verify. Nothing to repair.",
            command: refreshResultsCommand(exp.id),
            docs: DOCS.codingAgent
          },
          confidence: Number.isFinite(worst) ? 0.9 : 0.8
        })
      ]
    };
  }
};

// ../core/src/rules/ed013-no-metrics.ts
var ed013 = {
  id: "ED-013",
  title: "The experiment has at least one metric",
  layer: "config",
  node: "flagsmith",
  rank: 35,
  run(ctx) {
    const exp = ctx.experiment;
    if (!exp) return skip("No experiment was collected.");
    if (exp.metricIds.length) return pass(`${exp.metricIds.length} metric(s) attached.`);
    return fail([
      makeFinding(this, {
        severity: "critical",
        title: `Experiment "${exp.name}" has no metric`,
        detail: "Results are computed per metric. With no metric attached, exposures are recorded but there is no conversion to compare, so the experiment can never show a result.",
        evidence: [configItem(`Experiment ${exp.id} metrics`, "[] (none)")],
        fix: {
          summary: "Create a metric for your conversion event and attach it to the experiment.",
          steps: [
            'flagsmith api api/v1/environments/<env-key>/experiment-metrics/ --input - with {"name": "...", "aggregation": "occurrence", "direction": "up", "definition": {"version": 1, "event": "<event name>"}}',
            "Metrics cannot be changed on an existing experiment through the API: attach it when you create the experiment."
          ],
          docs: DOCS.codingAgent
        },
        confidence: 0.95
      })
    ]);
  }
};

// ../core/src/rules/ed014-sample-ratio.ts
var ed014 = {
  id: "ED-014",
  title: "Traffic splits the way the experiment is configured",
  layer: "results",
  node: "results",
  rank: 140,
  optional: true,
  run(ctx) {
    const results = ctx.config?.results;
    if (!results) return skip("No computed results.");
    const p = results.srmPValue;
    const metric = results.metrics[0];
    const total = metric ? metric.variants.reduce((s, v) => s + v.identities, 0) : 0;
    if (p === null || p === void 0 || total < SRM_MIN_TOTAL_IDENTITIES) return skip("Not enough traffic to judge the split.");
    if (p >= SRM_P_VALUE_THRESHOLD) return pass(`Split looks as configured (p = ${p.toFixed(3)}).`);
    return fail([
      makeFinding(this, {
        severity: "warning",
        title: "The traffic split does not match the configured weights",
        detail: `The sample ratio check gives p = ${p.toExponential(1)} (below ${SRM_P_VALUE_THRESHOLD}). Random assignment almost never drifts this far, so some users of one variation are not being exposed or counted. Results cannot be trusted until this is explained.`,
        evidence: metric.variants.map((v) => ({ label: `${v.variant}: ${v.identities} identities`, source: "results" })),
        fix: {
          summary: "Check that every variation records exposures the same way (same code path, same identify, same flush).",
          steps: ["Look for a variation whose page crashes, redirects early or reads the flag with getValue.", "Do not change the rollout while the experiment runs."],
          docs: DOCS.runExperiment
        },
        confidence: 0.8
      })
    ]);
  }
};

// ../core/src/rules/ed015-rollout-empty.ts
var ed015 = {
  id: "ED-015",
  title: "The experiment rollout enrols identities",
  layer: "config",
  node: "flagsmith",
  rank: 40,
  optional: true,
  run(ctx) {
    const exp = ctx.experiment;
    if (!exp || exp.status !== "running") return skip("The experiment is not running.");
    const r = exp.rollout;
    if (r === void 0) return skip("The rollout was not collected.");
    if (r === null) return skip("The experiment has no rollout segment yet.");
    if (r.enabled && r.rolloutPercentage > 0) return pass(`${r.rolloutPercentage}% of identities are enrolled.`);
    return fail([
      makeFinding(this, {
        severity: "critical",
        title: r.enabled ? "The rollout is 0%, so nobody is enrolled" : "The experiment rollout is disabled",
        detail: "Only identities inside the rollout are enrolled. Users outside it record no exposure, so a 0% or disabled rollout keeps the experiment empty.",
        evidence: [configItem(`Experiment ${exp.id} rollout`, `enabled: ${r.enabled}, rollout_percentage: ${r.rolloutPercentage}`)],
        fix: {
          summary: "Set the rollout percentage above 0 in the experiment (this changes who sees the variations, so it needs approval).",
          steps: ["Editing the rollout mid-experiment can affect the statistical validity of results."],
          docs: DOCS.runExperiment
        },
        confidence: 0.9
      })
    ]);
  }
};

// ../core/src/rules/ed016-no-events-received.ts
var GRACE_MINUTES = 15;
var ed016 = {
  id: "ED-016",
  title: "The warehouse is receiving events",
  layer: "ingestion",
  node: "warehouse",
  rank: 130,
  optional: true,
  run(ctx) {
    const exp = ctx.experiment;
    const w = ctx.config?.warehouses?.find((x) => x.status === "connected");
    if (!exp || exp.status !== "running") return skip("The experiment is not running.");
    if (!w) return skip("No connected warehouse.");
    if (w.totalEventsReceived === void 0 || w.totalEventsReceived === null) return skip("This warehouse does not report event counts.");
    if (w.totalEventsReceived > 0) return pass(`${w.totalEventsReceived} events received${w.lastEventAt ? `, last at ${w.lastEventAt}` : ""}.`);
    const started = exp.startedAt ? new Date(exp.startedAt) : null;
    const minutes = started && ctx.now ? (ctx.now.getTime() - started.getTime()) / 6e4 : null;
    if (minutes !== null && minutes < GRACE_MINUTES) return skip(`The experiment started ${Math.round(minutes)} minutes ago; events may still be on their way.`);
    return {
      status: "pending",
      findings: [
        makeFinding(this, {
          kind: "pending",
          severity: "info",
          title: "No events have reached the warehouse yet",
          detail: `The warehouse reports 0 events received${minutes !== null ? ` ${Math.round(minutes / 60)} hours after the experiment started` : ""}. That can simply mean no traffic yet, or that something between the app and Flagsmith drops every event. Scan the app code (--dir) to check the wiring.`,
          evidence: [configItem(`Warehouse ${w.id} total_events_received`, "0")],
          fix: {
            summary: "Run `experiment-doctor check --dir <your app>` so the code checks can confirm the wiring, then send real or test traffic.",
            docs: DOCS.runExperiment
          },
          confidence: 0.5
        })
      ]
    };
  }
};

// ../core/src/scope.ts
function appOf(file, roots) {
  let best = "";
  for (const r of roots) {
    if (r && (file === r || file.startsWith(`${r}/`)) && r.length > best.length) best = r;
  }
  return best;
}
function scopeToApp(code, flagKey) {
  const roots = code.appRoots ?? [];
  if (roots.length <= 1) return { code, app: null, otherApps: [] };
  const of = (l) => appOf(l.loc.file, roots);
  const items = [...code.inits, ...code.identifies, ...code.experimentFlags, ...code.plainFlagReads, ...code.trackEvents, ...code.exposures, ...code.flushes];
  const weight = /* @__PURE__ */ new Map();
  for (const i of items) weight.set(of(i), (weight.get(of(i)) ?? 0) + 1);
  const active = [...weight.keys()].sort();
  if (active.length === 0) return { code, app: null, otherApps: [] };
  const pick = (apps) => [...apps].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a.localeCompare(b))[0];
  const withFlag = flagKey ? active.filter((a) => code.experimentFlags.some((c) => c.flag === flagKey && of(c) === a) || code.exposures.some((e) => e.flag === flagKey && of(e) === a)) : [];
  const readingFlag = flagKey ? active.filter((a) => code.plainFlagReads.some((r) => r.flag === flagKey && of(r) === a)) : [];
  const withExperiment = active.filter((a) => code.experimentFlags.some((c) => of(c) === a));
  let app;
  let reason;
  if (withFlag.length) {
    app = pick(withFlag);
    reason = `it reads the experiment flag "${flagKey}"`;
  } else if (readingFlag.length) {
    app = pick(readingFlag);
    reason = `it reads the flag "${flagKey}"`;
  } else if (withExperiment.length) {
    app = pick(withExperiment);
    reason = "it reads an experiment flag";
  } else {
    app = pick(active);
    reason = "it has the most Flagsmith code";
  }
  const inApp = (l) => of(l) === app;
  const manifestCounts = (file) => {
    const dir = file.replace(/(^|\/)package\.json$/, "");
    return dir === app || dir === "" || app.startsWith(`${dir}/`);
  };
  const scoped = {
    ...code,
    files: code.files.filter((f) => appOf(f.file, roots) === app),
    packages: code.packages.filter((p) => manifestCounts(p.manifest.file)),
    inits: code.inits.filter(inApp),
    identifies: code.identifies.filter(inApp),
    experimentFlags: code.experimentFlags.filter(inApp),
    plainFlagReads: code.plainFlagReads.filter(inApp),
    trackEvents: code.trackEvents.filter(inApp),
    exposures: code.exposures.filter(inApp),
    flushes: code.flushes.filter(inApp),
    exits: code.exits.filter(inApp)
  };
  if (code.experimentUpdates) scoped.experimentUpdates = code.experimentUpdates.filter(inApp);
  return { code: scoped, app, otherApps: active.filter((a) => a !== app), reason };
}

// ../core/src/rules/context.ts
function buildContext(evidence) {
  const config = evidence.config ?? null;
  const rawCode = evidence.code ?? null;
  const experiment = config ? config.experiment : void 0;
  const flagKey = config?.flag?.name ?? experiment?.featureName ?? evidence.target?.flag ?? null;
  let metrics = config?.metrics;
  if (metrics && experiment) {
    if (experiment.metricIds.length === 0) metrics = [];
    else {
      const attached = metrics.filter((m) => experiment.metricIds.includes(m.id));
      if (attached.length) metrics = attached;
    }
  }
  const scope = rawCode ? scopeToApp(rawCode, flagKey) : null;
  const code = scope ? scope.code : null;
  const now = evidence.collectedAt ? new Date(evidence.collectedAt) : null;
  const ctx = { evidence, config, code, flagKey, experiment, metrics, now: now && !Number.isNaN(now.getTime()) ? now : null };
  if (scope?.app !== null && scope?.app !== void 0) ctx.app = { path: scope.app, otherApps: scope.otherApps, reason: scope.reason ?? "" };
  return ctx;
}

// ../core/src/rules/index.ts
var ALL_RULES = [ed001, ed002, ed003, ed004, ed005, ed006, ed007, ed008, ed009, ed010, ed011, ed012, ed013, ed014, ed015, ed016].sort(
  (a, b) => a.rank - b.rank
);

// ../core/src/diagnose.ts
var SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
function compareFindings(rank) {
  return (a, b) => (a.kind === b.kind ? 0 : a.kind === "defect" ? -1 : 1) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || rank(a.id) - rank(b.id) || b.confidence - a.confidence;
}
function diagnose(evidence, options = {}) {
  const rules = options.rules ?? ALL_RULES;
  const ctx = buildContext(evidence);
  const checks = [];
  const findings = [];
  for (const rule of rules) {
    let out;
    try {
      out = rule.run(ctx);
    } catch (err) {
      out = { status: "skip", note: `Check could not run: ${err instanceof Error ? err.message : String(err)}` };
    }
    const check2 = { id: rule.id, title: rule.title, layer: rule.layer, node: rule.node, status: out.status };
    if (out.note) check2.note = out.note;
    checks.push(check2);
    findings.push(...out.findings ?? []);
  }
  const rankOf = new Map(rules.map((r) => [r.id, r.rank]));
  findings.sort(compareFindings((id) => rankOf.get(id) ?? 999));
  const pipeline = buildPipeline(checks, findings, rules);
  const layers = buildLayers(checks, findings, rules);
  const verdict = verdictOf(findings, checks, pipeline);
  const primaryFinding = findings[0] ?? null;
  const exp = evidence.config?.experiment ?? void 0;
  const target = {};
  if (ctx.flagKey) target.flag = ctx.flagKey;
  const expId = exp?.id ?? evidence.target?.experimentId;
  if (expId !== void 0) target.experimentId = expId;
  if (exp?.name) target.experimentName = exp.name;
  if (evidence.config?.environment?.name) target.environment = evidence.config.environment.name;
  if (ctx.app) {
    target.app = ctx.app.path || ".";
    if (ctx.app.otherApps.length) target.otherApps = ctx.app.otherApps.map((a) => a || ".");
  }
  return {
    schemaVersion: 1,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    generatedAt: evidence.collectedAt ?? options.now ?? (/* @__PURE__ */ new Date()).toISOString(),
    verdict,
    summary: summarize(verdict, findings, pipeline, checks),
    target,
    layers,
    pipeline,
    findings,
    primaryFinding,
    checks,
    upstream: matchKnownBugs(evidence, findings),
    coverage: { config: !!evidence.config, code: !!evidence.code, probe: !!evidence.probe }
  };
}
function verdictOf(findings, checks, pipeline) {
  if (findings.some((f) => f.kind === "defect" && f.severity !== "info")) return "REPAIR_REQUIRED";
  if (findings.some((f) => f.kind === "pending") || checks.some((c) => c.status === "pending")) return "PENDING";
  if (pipeline.every((n) => n.status === "ok")) return "HEALTHY";
  return "UNVERIFIABLE";
}
function summarize(verdict, findings, pipeline, checks) {
  const primary = findings[0];
  switch (verdict) {
    case "REPAIR_REQUIRED": {
      const others = findings.filter((f) => f !== primary && f.kind === "defect" && f.severity !== "info").length;
      return `Repair required: ${primary.title}.${others ? ` ${others} more issue${others === 1 ? "" : "s"} after that.` : ""}`;
    }
    case "PENDING":
      return `No defect found; waiting for data: ${primary ? primary.title.replace(/^./, (c) => c.toLowerCase()) : "results are not ready"}.`;
    case "HEALTHY":
      return "Healthy: every required check passed and the results show enough exposures and conversions in every variation.";
    case "UNVERIFIABLE": {
      const unknown = pipeline.filter((n) => n.status === "unknown").map((n) => n.label);
      const skipped = checks.filter((c) => c.status === "skip").length;
      return `No defect found in what was checked, but ${unknown.join(", ")} could not be verified (${skipped} check${skipped === 1 ? "" : "s"} lacked evidence).`;
    }
  }
}

// ../core/src/util/redact.ts
var SERVER_KEY = /\bser\.[A-Za-z0-9_-]{6,}/g;
var KEY_PROP = /\b(environmentID|environmentKey|environment_key|apiKey|api_key|FLAGSMITH_API_KEY|FLAGSMITH_ENVIRONMENT_KEY|X-Environment-Key|Authorization)(\s*[:=]\s*|["']\s*:\s*)(['"`])([^'"`\s]{4,})\3/g;
var BEARER = /\b(Bearer|Token|Api-Key)\s+[A-Za-z0-9._-]{12,}/g;
function redactSecrets(text) {
  return text.replace(SERVER_KEY, "ser.***").replace(KEY_PROP, (_m, name, sep, q) => `${name}${sep}${q}***${q}`).replace(BEARER, (_m, scheme) => `${scheme} ***`);
}

// ../core/src/scanner/lexer.ts
var REGEX_PRECEDERS = /* @__PURE__ */ new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^"]);
var REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|void|yield|await)\s*$/;
function lex(src) {
  const code = src.split("");
  const skel = src.split("");
  const n = src.length;
  const modes = ["code"];
  const tplBraces = [];
  let depth = 0;
  let last = "";
  let lastWordTail = "";
  const blank = (arr, i) => {
    if (arr[i] !== "\n" && arr[i] !== "\r") arr[i] = " ";
  };
  for (let i = 0; i < n; i++) {
    const c = src[i];
    const next = src[i + 1];
    const mode = modes[modes.length - 1];
    switch (mode) {
      case "line":
        if (c === "\n") modes.pop();
        else {
          blank(code, i);
          blank(skel, i);
        }
        continue;
      case "block":
        if (c === "*" && next === "/") {
          blank(code, i);
          blank(skel, i);
          blank(code, i + 1);
          blank(skel, i + 1);
          i++;
          modes.pop();
        } else {
          blank(code, i);
          blank(skel, i);
        }
        continue;
      case "sq":
      case "dq": {
        const q = mode === "sq" ? "'" : '"';
        if (c === "\\") {
          blank(skel, i);
          if (i + 1 < n) blank(skel, i + 1);
          i++;
        } else if (c === q) {
          modes.pop();
          last = q;
        } else if (c === "\n") {
          modes.pop();
        } else blank(skel, i);
        continue;
      }
      case "regex":
        if (c === "\\") {
          blank(skel, i);
          if (i + 1 < n) blank(skel, i + 1);
          i++;
        } else if (c === "[") {
          blank(skel, i);
          let j = i + 1;
          while (j < n && src[j] !== "]" && src[j] !== "\n") {
            if (src[j] === "\\") {
              blank(skel, j);
              j++;
            }
            blank(skel, j);
            j++;
          }
          i = j;
        } else if (c === "/" || c === "\n") {
          modes.pop();
          last = "/";
        } else blank(skel, i);
        continue;
      case "tpl":
        if (c === "\\") {
          blank(skel, i);
          if (i + 1 < n) blank(skel, i + 1);
          i++;
        } else if (c === "`") {
          modes.pop();
          last = "`";
        } else if (c === "$" && next === "{") {
          tplBraces.push(depth);
          depth++;
          modes.push("code");
          i++;
          last = "{";
        } else blank(skel, i);
        continue;
      case "code":
      default:
        break;
    }
    if (c === "/" && next === "/") {
      modes.push("line");
      blank(code, i);
      blank(skel, i);
      continue;
    }
    if (c === "/" && next === "*") {
      modes.push("block");
      blank(code, i);
      blank(skel, i);
      continue;
    }
    if (c === "'") {
      modes.push("sq");
      continue;
    }
    if (c === '"') {
      modes.push("dq");
      continue;
    }
    if (c === "`") {
      modes.push("tpl");
      continue;
    }
    if (c === "/") {
      if (REGEX_PRECEDERS.has(last) || REGEX_KEYWORDS.test(lastWordTail)) {
        modes.push("regex");
        continue;
      }
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (tplBraces.length && tplBraces[tplBraces.length - 1] === depth) {
        tplBraces.pop();
        modes.pop();
        continue;
      }
    }
    if (!/\s/.test(c)) {
      last = /[\w$]/.test(c) ? "w" : c;
      lastWordTail = (lastWordTail + c).slice(-12);
    } else {
      lastWordTail += " ";
      lastWordTail = lastWordTail.slice(-12);
    }
  }
  return { code: code.join(""), skeleton: skel.join("") };
}
var LineIndex = class {
  constructor(text) {
    this.text = text;
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.starts.push(i + 1);
  }
  text;
  starts = [0];
  lineOf(offset) {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  /** Exact text of a 1-based line, without the line break. */
  lineText(line) {
    const start = this.starts[line - 1];
    if (start === void 0) return "";
    const end = this.starts[line] ?? this.text.length + 1;
    return this.text.slice(start, end - 1).replace(/\r$/, "");
  }
  get lineCount() {
    return this.starts.length;
  }
};

// ../core/src/scanner/packages.ts
var SDK_PACKAGE_NAMES = SDK_REQUIREMENTS.map((r) => r.name);
var INSTALLED_RE = new RegExp(
  `(^|/)node_modules/(${SDK_PACKAGE_NAMES.map((n) => n.replace(/[/.]/g, "\\$&")).join("|")})/package\\.json$`
);
function isInstalledManifest(path) {
  return INSTALLED_RE.test(path);
}
function readManifest(path, content) {
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const out = [];
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = json[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, range] of Object.entries(deps)) {
      const req = SDK_REQUIREMENTS.find((r) => r.name === name);
      if (!req) continue;
      if (out.some((p) => p.name === name)) continue;
      const idx = lines.findIndex((l) => l.includes(`"${name}"`));
      out.push({
        name,
        kind: req.kind,
        range: typeof range === "string" ? range : null,
        manifest: idx >= 0 ? { file: path, line: idx + 1, snippet: lines[idx].trim(), text: lines[idx] } : { file: path, line: 1 }
      });
    }
  }
  return out;
}
function readInstalled(path, content) {
  const m = INSTALLED_RE.exec(path);
  if (!m) return null;
  try {
    const json = JSON.parse(content);
    if (!json.version) return null;
    const root = path.slice(0, m.index + (m[1] ? 1 : 0));
    return { name: m[2], version: json.version, root };
  } catch {
    return null;
  }
}

// ../core/src/scanner/syntax.ts
var OPEN = { "(": ")", "[": "]", "{": "}" };
function findClose(skel, open) {
  const stack = [];
  for (let i = open; i < skel.length; i++) {
    const c = skel[i];
    if (c in OPEN) stack.push(OPEN[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}
function splitTopLevel(skel, start, end) {
  const parts = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i++) {
    const c = skel[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "<" && /[A-Za-z]/.test(skel[i + 1] ?? "") && depth === 0) {
    } else if (c === "," && depth === 0) {
      parts.push({ start: from, end: i });
      from = i + 1;
    }
  }
  parts.push({ start: from, end });
  return parts.filter((p) => skel.slice(p.start, p.end).trim().length > 0);
}
function readCallArgs(skel, open) {
  const close = findClose(skel, open);
  if (close < 0) return null;
  return { open, close, args: splitTopLevel(skel, open + 1, close) };
}
function parseObject(code, skel, open) {
  if (skel[open] !== "{") return null;
  const close = findClose(skel, open);
  if (close < 0) return null;
  const props = [];
  const spreads = [];
  let index = -1;
  for (const part of splitTopLevel(skel, open + 1, close)) {
    index++;
    const text = code.slice(part.start, part.end);
    const lead = text.length - text.trimStart().length;
    const body = text.trim();
    if (body.startsWith("...")) {
      spreads.push(index);
      continue;
    }
    const m = /^(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*(:)?/.exec(body);
    if (!m) continue;
    const key = m[2] ?? m[3];
    if (m[4]) {
      const after = m[0].length;
      const rawValue = body.slice(after);
      const valueLead = rawValue.length - rawValue.trimStart().length;
      props.push({
        key,
        value: rawValue.trim(),
        keyOffset: part.start + lead,
        valueOffset: part.start + lead + after + valueLead,
        valueEnd: part.end,
        shorthand: false,
        index
      });
    } else if (/^[A-Za-z_$][\w$]*$/.test(body)) {
      props.push({ key, value: key, keyOffset: part.start + lead, valueOffset: part.start + lead, valueEnd: part.end, shorthand: true, index });
    }
  }
  return { props, spreads, close };
}
function skipSpace(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}
function receiverBefore(skel, dot) {
  let i = dot - 1;
  if (skel[i] === "?") i--;
  while (i >= 0 && /\s/.test(skel[i])) i--;
  const end = i + 1;
  while (i >= 0) {
    const c = skel[i];
    if (/[\w$]/.test(c) || c === ".") {
      i--;
      continue;
    }
    if (c === "?" && skel[i + 1] === ".") {
      i--;
      continue;
    }
    break;
  }
  const start = i + 1;
  const text = skel.slice(start, end).replace(/\?\./g, ".").replace(/^\.+/, "");
  return { text, start: text ? start : dot };
}
function lastIdent(receiver) {
  const m = /([A-Za-z_$][\w$]*)$/.exec(receiver);
  return m?.[1] ?? "";
}

// ../core/src/scanner/scan.ts
var CODE_EXT = /\.(?:[mc]?[jt]sx?)$/i;
var IGNORED = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.git|\.turbo|\.vercel|\.experiment-doctor)\//;
var MCP_FILES = /(^|\/)(\.mcp\.json|mcp\.json|claude_desktop_config\.json|\.cursor\/mcp\.json|\.vscode\/mcp\.json)$/;
var MAX_FILE_BYTES = 75e4;
var TEST_PATH = /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|e2e|fixtures?|cypress|playwright)\/|\.(test|spec|e2e)\.[mc]?[jt]sx?$/i;
var BUNDLE_DIR = /(^|\/)(public|vendor|vendors|dist|build|out|static\/js)\//i;
var BUNDLE_NAME = /\.(min|bundle|umd|prod)\.[mc]?js$/i;
var SDK_SOURCE = /eventProcessorConfig requires enableEvents|ValueError: enableEvents must be true|this\.getExperimentFlag\s*=\s*function|FLAG_EXPOSURE_EVENT\s*=\s*['"]\$flag_exposure['"]|class EventProcessor\b[\s\S]{0,2000}trackExposureEvent/;
function resolveRelative(from, spec) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/").replace(/\.(?:[mc]?[jt]sx?)$/i, "");
}
function skipReason(path, content) {
  if (TEST_PATH.test(path)) return "test";
  if (BUNDLE_NAME.test(path) || BUNDLE_DIR.test(path) || content.length > MAX_FILE_BYTES) return "bundle";
  const lines = content.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  if (longest > 2e3 || content.length / Math.max(1, lines.length) > 500) return "minified";
  if (SDK_SOURCE.test(content)) return "sdk-copy";
  return null;
}
var JS_PACKAGES = ["@flagsmith/flagsmith", "flagsmith", "react-native-flagsmith"];
var NODE_PACKAGES = ["@flagsmith/nodejs", "flagsmith-nodejs"];
function sdkOfSpecifier(spec) {
  const base = spec.replace(/\/(react|isomorphic|next-middleware|src.*)$/, "");
  if (JS_PACKAGES.includes(base)) return "js";
  if (NODE_PACKAGES.includes(base)) return "node";
  return null;
}
var truncate = (s, n) => s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
function makeLoc(ctx, offset) {
  const line = ctx.lines.lineOf(offset);
  const text = ctx.lines.lineText(line);
  const red = redactSecrets(text);
  const loc = { file: ctx.path, line, snippet: truncate(red.trim(), 160) };
  if (red === text) loc.text = text;
  return loc;
}
var spanText = (ctx, s) => s ? ctx.code.slice(s.start, s.end).trim() : "";
function stripAsConst(text) {
  return text.replace(/\s+as\s+const\s*$/, "").replace(/\s+as\s+[\w.<>[\]|' ]+$/, "").trim();
}
function parseImports(code) {
  const out = [];
  const esm = /\bimport\s+(?:type\s+)?([A-Za-z_$][\w$]*)?\s*,?\s*(\{[^}]*\}|\*\s*as\s+[A-Za-z_$][\w$]*)?\s*from\s*(['"])([^'"\n]+)\3/g;
  for (const m of code.matchAll(esm)) {
    const spec = m[4];
    const info = { spec, sdk: sdkOfSpecifier(spec), named: [] };
    if (m[1]) info.defaultName = m[1];
    const braces = m[2];
    if (braces?.startsWith("{")) info.named = parseNamed(braces.slice(1, -1), "as");
    else if (braces) info.defaultName = info.defaultName ?? /as\s+([\w$]+)/.exec(braces)?.[1];
    out.push(info);
  }
  const cjs = /\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"\n]+)\2\s*\)(\.default|\.Flagsmith)?/g;
  for (const m of code.matchAll(cjs)) {
    const spec = m[3];
    const info = { spec, sdk: sdkOfSpecifier(spec), named: [] };
    const lhs = m[1];
    if (lhs.startsWith("{")) info.named = parseNamed(lhs.slice(1, -1), ":");
    else if (m[4] === ".Flagsmith") info.named = [{ imported: "Flagsmith", local: lhs }];
    else info.defaultName = lhs;
    out.push(info);
  }
  return out;
}
function parseNamed(inner, sep) {
  return inner.split(",").map((p) => p.trim().replace(/^type\s+/, "")).filter(Boolean).map((p) => {
    const parts = sep === "as" ? p.split(/\s+as\s+/) : p.split(/\s*:\s*/);
    return { imported: parts[0].trim(), local: (parts[1] ?? parts[0]).trim() };
  });
}
function collectConsts(ctx) {
  const { code, skel } = ctx;
  const simple = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+?)?=\s*(['"`])([^'"`$\n]*)\2/g;
  for (const m of code.matchAll(simple)) ctx.consts.set(m[1], m[3]);
  const objects = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+?)?=\s*\{/g;
  for (const m of skel.matchAll(objects)) {
    const open = m.index + m[0].length - 1;
    const obj = parseObject(code, skel, open);
    if (!obj) continue;
    for (const p of obj.props) {
      const v = stringLiteral(stripAsConst(p.value));
      if (v !== null) ctx.consts.set(`${m[1]}.${p.key}`, v);
    }
  }
  const enums = /\benum\s+([A-Za-z_$][\w$]*)\s*\{/g;
  for (const m of skel.matchAll(enums)) {
    const open = m.index + m[0].length - 1;
    const close = findClose(skel, open);
    if (close < 0) continue;
    for (const member of code.slice(open + 1, close).split(",")) {
      const mm = /^\s*([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2/.exec(member);
      if (mm) ctx.consts.set(`${m[1]}.${mm[1]}`, mm[3]);
    }
  }
}
function collectBindings(ctx) {
  for (const imp of ctx.imports) {
    if (imp.sdk === "js") {
      if (imp.defaultName && !/^(Flagsmith)?Provider$/.test(imp.defaultName)) ctx.clients.set(imp.defaultName, "js");
      for (const n of imp.named) {
        if (n.imported === "createFlagsmithInstance") ctx.factories.add(n.local);
        if (n.imported === "default") ctx.clients.set(n.local, "js");
      }
    } else if (imp.sdk === "node") {
      if (imp.defaultName) ctx.nodeClasses.add(imp.defaultName);
      for (const n of imp.named) if (/^(Flagsmith|default)$/.test(n.imported)) ctx.nodeClasses.add(n.local);
    }
  }
  const { skel } = ctx;
  for (const m of skel.matchAll(/(?:\b(?:const|let|var)\s+|\bthis\.|\b)([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>.[\]| ]+)?=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const cls = m[2];
    if (ctx.nodeClasses.has(cls) || cls === "Flagsmith" && ctx.sdkHint !== "js") ctx.clients.set(m[1], "node");
  }
  for (const m of skel.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    const fn = m[2];
    if (ctx.factories.has(fn) || fn === "createFlagsmithInstance" || fn === "useFlagsmith") ctx.clients.set(m[1], "js");
  }
  for (const m of ctx.code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(useFlagsmith\s*\(\s*\)|[A-Za-z_$][\w$]*)/g)) {
    const rhs = m[2];
    const sdk = rhs.startsWith("useFlagsmith") ? "js" : ctx.clients.get(rhs);
    if (!sdk) continue;
    for (const n of parseNamed(m[1], ":")) ctx.boundFns.set(n.local, sdk);
  }
  for (const m of skel.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$.]+\.\s*get(?:Identity|Environment)Flags\s*\(/g)) {
    ctx.flagsObjects.add(m[1]);
  }
  for (const m of skel.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    const sdk = ctx.clients.get(m[1]);
    if (sdk) ctx.exportedClients.set(m[1], sdk);
  }
  for (const m of skel.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const n of parseNamed(m[1], "as")) {
      const sdk = ctx.clients.get(n.imported);
      if (sdk) ctx.exportedClients.set(n.local, sdk);
    }
  }
  const def = /\bexport\s+default\s+(new\s+([A-Za-z_$][\w$]*)|[A-Za-z_$][\w$]*)/.exec(skel);
  if (def) {
    if (def[2] && (ctx.nodeClasses.has(def[2]) || def[2] === "Flagsmith")) ctx.defaultExportClient = "node";
    else if (!def[2] && ctx.clients.has(def[1])) ctx.defaultExportClient = ctx.clients.get(def[1]);
  }
}
function collectHandlers(ctx) {
  const { skel, code } = ctx;
  const add = (callOpen, kind) => {
    const close = findClose(skel, callOpen);
    if (close > 0) ctx.handlerRanges.push({ start: callOpen, end: close, kind });
  };
  for (const m of code.matchAll(/addEventListener\s*\(\s*(['"])(pagehide|visibilitychange|beforeunload|unload)\1/g)) {
    add(m.index + m[0].indexOf("("), "unload-handler");
  }
  for (const m of code.matchAll(/process\.(?:on|once)\s*\(\s*(['"])(SIGTERM|SIGINT|beforeExit|exit)\1/g)) {
    add(m.index + m[0].indexOf("("), "signal-handler");
  }
  for (const m of skel.matchAll(/\b(?:window\.)?on(?:beforeunload|pagehide)\s*=\s*/g)) {
    const start = m.index;
    const brace = skel.indexOf("{", start);
    if (brace > 0 && brace - start < 80) {
      const close = findClose(skel, brace);
      if (close > 0) ctx.handlerRanges.push({ start, end: close, kind: "unload-handler" });
    }
  }
}
var METHODS = "getExperimentFlag|trackEvent|trackExposureEvent|flushEvents|close|identify|getValue|hasFeature|getAllFlags|getIdentityFlags|getEnvironmentFlags|getFeatureValue|isFeatureEnabled|getFlag|init";
var DISTINCTIVE = /* @__PURE__ */ new Set(["getExperimentFlag", "trackExposureEvent", "getIdentityFlags", "getEnvironmentFlags", "flushEvents"]);
function isAwaited(ctx, receiverStart, close) {
  const before = ctx.skel.slice(Math.max(0, receiverStart - 24), receiverStart);
  if (/\b(await|return|yield)\s*\(?\s*$/.test(before)) return true;
  const after = ctx.skel.slice(close + 1, close + 40);
  return /^\s*\)?\s*\.\s*(then|finally)\s*\(/.test(after);
}
function objectProps(ctx, argText, argStart) {
  const map = /* @__PURE__ */ new Map();
  let open = -1;
  if (argText.startsWith("{")) open = skipSpace(ctx.code, argStart);
  else if (/^[A-Za-z_$][\w$]*$/.test(argText)) {
    const re = new RegExp(`\\b(?:const|let|var)\\s+${argText.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*\\{`);
    const m = re.exec(ctx.skel);
    if (m) open = m.index + m[0].length - 1;
  }
  if (open < 0) return null;
  const obj = parseObject(ctx.code, ctx.skel, open);
  if (!obj) return null;
  for (const p of obj.props) map.set(p.key, p);
  return map;
}
function resolveName(ctx, global, raw) {
  const text = stripAsConst(raw);
  const lit = stringLiteral(text);
  if (lit !== null) return lit;
  const id = text.replace(/\s+/g, "").replace(/\?\./g, ".");
  return ctx.consts.get(id) ?? global.get(id) ?? null;
}
function opaqueInit(ctx, sdk, style, callOffset, client) {
  const init = { loc: makeLoc(ctx, callOffset), sdk, style, enableEvents: null, apiUrl: null, eventsApiUrl: null, hasEventProcessorConfig: false, opaque: true };
  if (client) init.client = client;
  return init;
}
function initFromObject(ctx, open, sdk, style, callOffset, client) {
  const obj = parseObject(ctx.code, ctx.skel, open);
  if (!obj) return null;
  const lastSpread = obj.spreads.length ? Math.max(...obj.spreads) : -1;
  let opaque = obj.spreads.length > 0;
  const get = (k) => obj.props.find((p) => p.key === k && p.index > lastSpread);
  const looksLikeFlagsmith = obj.props.some((p) => /^(environmentID|environmentKey|enableEvents|eventProcessorConfig|api|apiUrl|identity)$/.test(p.key));
  if (!looksLikeFlagsmith && !opaque && style === "init") return null;
  const api = sdk === "node" ? get("apiUrl") ?? get("api") : get("api") ?? get("apiUrl");
  const epc = get("eventProcessorConfig");
  let eventsApiUrl = null;
  let eventsApiUrlLoc;
  if (epc && epc.value.startsWith("{")) {
    const inner = parseObject(ctx.code, ctx.skel, epc.valueOffset);
    const innerLast = inner?.spreads.length ? Math.max(...inner.spreads) : -1;
    if (inner?.spreads.length) opaque = true;
    const ev = inner?.props.find((p) => p.key === "eventsApiUrl" && p.index > innerLast);
    if (ev) {
      eventsApiUrl = ev.value;
      eventsApiUrlLoc = makeLoc(ctx, ev.keyOffset);
    }
  } else if (epc) {
    opaque = true;
  }
  const openLine = ctx.lines.lineOf(open);
  const closeLine = ctx.lines.lineOf(obj.close);
  const first = obj.props[0];
  let propIndent = `${/^\s*/.exec(ctx.lines.lineText(openLine))?.[0] ?? ""}  `;
  if (first && ctx.lines.lineOf(first.keyOffset) !== openLine) {
    propIndent = /^\s*/.exec(ctx.lines.lineText(ctx.lines.lineOf(first.keyOffset)))?.[0] ?? propIndent;
  }
  const init = {
    loc: makeLoc(ctx, callOffset),
    sdk,
    style,
    enableEvents: get("enableEvents")?.value ?? null,
    apiUrl: api?.value ?? null,
    eventsApiUrl,
    hasEventProcessorConfig: !!epc,
    propIndent
  };
  const enable = get("enableEvents");
  if (enable) init.enableEventsLoc = makeLoc(ctx, enable.keyOffset);
  if (api) init.apiUrlLoc = makeLoc(ctx, api.keyOffset);
  if (eventsApiUrlLoc) init.eventsApiUrlLoc = eventsApiUrlLoc;
  const analytics = get("enableAnalytics");
  if (analytics) init.enableAnalytics = analytics.value;
  const identity = get("identity");
  if (identity) init.identityExpr = normaliseExpr(identity.value);
  if (openLine !== closeLine) init.insertAfter = makeLoc(ctx, open);
  if (client) init.client = client;
  if (opaque) init.opaque = true;
  return init;
}
function collectCalls(ctx, global, out, globalClients) {
  const { code, skel } = ctx;
  const callRe = new RegExp(`\\.\\s*(${METHODS})\\s*(?:<[^>()]*>)?\\s*\\(`, "g");
  const sdkFor = (clientName, fallback) => ctx.clients.get(clientName) ?? globalClients.get(clientName) ?? ctx.sdkHint ?? fallback ?? "js";
  const handle = (method, recv, recvStart, open, bare) => {
    const call = readCallArgs(skel, open);
    if (!call) return;
    const args = call.args;
    const a0 = spanText(ctx, args[0]);
    const a1 = spanText(ctx, args[1]);
    const name = bare ? recv : lastIdent(recv);
    const known = bare || ctx.clients.has(name) || globalClients.has(name);
    const flagsmithish = known || /flagsmith/i.test(recv);
    const at = makeLoc(ctx, recvStart);
    const client = bare ? void 0 : name || void 0;
    if (!DISTINCTIVE.has(method)) {
      if (["getFeatureValue", "isFeatureEnabled", "getFlag"].includes(method)) {
        if (!(ctx.flagsObjects.has(name) || /flags/i.test(name) || ctx.sdkHint === "node")) return;
      } else if (!flagsmithish) return;
    }
    switch (method) {
      case "getExperimentFlag": {
        const sdk = args.length >= 2 ? "node" : sdkFor(name, "js");
        const ev = { loc: at, flag: resolveName(ctx, global, a0), method: "getExperimentFlag", sdk };
        if (client) ev.client = client;
        if (sdk === "node") {
          ev.identifierExpr = args[1] ? normaliseExpr(a1) : null;
          if (args[1]) out.identifies.push({ loc: at, expr: normaliseExpr(a1), raw: a1, via: "getExperimentFlag", awaited: true, sdk });
        }
        out.experimentFlags.push(ev);
        return;
      }
      case "trackEvent": {
        const sdk = sdkFor(name);
        const opts = args[1] ? objectProps(ctx, a1, args[1].start) : null;
        const idProp = opts?.get("identifier");
        const ev = {
          loc: at,
          event: resolveName(ctx, global, a0),
          raw: a0,
          identifierExpr: idProp ? normaliseExpr(idProp.value) : null,
          sdk
        };
        if (idProp) ev.identifierRaw = idProp.value;
        if (client) ev.client = client;
        out.trackEvents.push(ev);
        return;
      }
      case "trackExposureEvent": {
        const opts = args[1] ? objectProps(ctx, a1, args[1].start) : null;
        const idProp = opts?.get("identifier");
        const expr = idProp ? normaliseExpr(idProp.value) : null;
        out.exposures.push({ loc: at, flag: resolveName(ctx, global, a0), identifierExpr: expr });
        if (expr && idProp) out.identifies.push({ loc: at, expr, raw: idProp.value, via: "trackExposureEvent", awaited: true, sdk: sdkFor(name) });
        return;
      }
      case "flushEvents":
      case "close": {
        if (method === "close" && !known && !/flagsmith/i.test(recv)) return;
        const inExit = ctx.handlerRanges.some((r) => recvStart >= r.start && recvStart <= r.end);
        const ev = { loc: at, method, inExitHandler: inExit };
        if (client) ev.client = client;
        out.flushes.push(ev);
        return;
      }
      case "identify": {
        if (!args[0]) return;
        out.identifies.push({ loc: at, expr: normaliseExpr(a0), raw: a0, via: "identify", awaited: isAwaited(ctx, recvStart, call.close), sdk: sdkFor(name, "js") });
        return;
      }
      case "getIdentityFlags": {
        if (!args[0]) return;
        out.identifies.push({ loc: at, expr: normaliseExpr(a0), raw: a0, via: "getIdentityFlags", awaited: true, sdk: "node" });
        return;
      }
      case "getEnvironmentFlags":
        return;
      case "getValue":
      case "hasFeature":
      case "getFeatureValue":
      case "isFeatureEnabled":
      case "getFlag":
      case "getAllFlags": {
        const ev = { loc: at, flag: method === "getAllFlags" ? null : resolveName(ctx, global, a0), method };
        if (client) ev.client = client;
        out.plainFlagReads.push(ev);
        return;
      }
      case "init": {
        if (!args[0]) return;
        const objOpen = a0.startsWith("{") ? skipSpace(code, args[0].start) : -1;
        let open2 = objOpen;
        if (open2 < 0 && /^[A-Za-z_$][\w$]*$/.test(a0)) {
          const m = new RegExp(`\\b(?:const|let|var)\\s+${a0.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*\\{`).exec(skel);
          if (m) open2 = m.index + m[0].length - 1;
        }
        if (open2 < 0) {
          out.inits.push(opaqueInit(ctx, sdkFor(name, "js"), "init", recvStart, client));
          return;
        }
        const init = initFromObject(ctx, open2, sdkFor(name, "js"), "init", recvStart, client);
        if (init) {
          out.inits.push(init);
          if (init.identityExpr) out.identifies.push({ loc: init.loc, expr: init.identityExpr, raw: init.identityExpr, via: "init-identity", awaited: true, sdk: init.sdk });
        }
        return;
      }
    }
  };
  for (const m of skel.matchAll(callRe)) {
    const dot = m.index;
    const method = m[1];
    const open = dot + m[0].length - 1;
    const recv = receiverBefore(skel, dot);
    handle(method, recv.text, recv.start, open, false);
  }
  for (const [fn, sdk] of ctx.boundFns) {
    if (!METHODS.split("|").includes(fn)) continue;
    const re = new RegExp(`(?<![\\w$.])${fn}\\s*\\(`, "g");
    for (const m of skel.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      ctx.clients.set(fn, sdk);
      handle(fn, fn, m.index, open, true);
    }
  }
  for (const m of skel.matchAll(/(?<![\w$.])(useExperiment|useFlags)\s*(?:<[^>()]*>)?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const call = readCallArgs(skel, open);
    if (!call) continue;
    const a0 = spanText(ctx, call.args[0]);
    const at = makeLoc(ctx, m.index);
    if (m[1] === "useExperiment") {
      out.experimentFlags.push({ loc: at, flag: resolveName(ctx, global, a0), method: "useExperiment", sdk: "js" });
    } else {
      const names = a0.startsWith("[") ? a0.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (!names.length) out.plainFlagReads.push({ loc: at, flag: null, method: "useFlags" });
      for (const n of names) out.plainFlagReads.push({ loc: at, flag: resolveName(ctx, global, n), method: "useFlags" });
    }
  }
  for (const m of skel.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const cls = m[1];
    if (!(ctx.nodeClasses.has(cls) || cls === "Flagsmith" && ctx.sdkHint !== "js")) continue;
    const open = m.index + m[0].length - 1;
    const call = readCallArgs(skel, open);
    if (!call?.args[0]) continue;
    const a0 = spanText(ctx, call.args[0]);
    let objOpen = a0.startsWith("{") ? skipSpace(code, call.args[0].start) : -1;
    if (objOpen < 0 && /^[A-Za-z_$][\w$]*$/.test(a0)) {
      const mm = new RegExp(`\\b(?:const|let|var)\\s+${a0.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*\\{`).exec(skel);
      if (mm) objOpen = mm.index + mm[0].length - 1;
    }
    const lhs = /([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>.[\]| ]+)?=\s*$/.exec(skel.slice(Math.max(0, m.index - 80), m.index));
    if (objOpen < 0) {
      out.inits.push(opaqueInit(ctx, "node", "constructor", m.index, lhs?.[1]));
      continue;
    }
    const init = initFromObject(ctx, objOpen, "node", "constructor", m.index, lhs?.[1]);
    if (init) out.inits.push(init);
  }
  for (const m of skel.matchAll(/<FlagsmithProvider\b/g)) {
    const region = skel.slice(m.index, m.index + 3e3);
    const opt = /\boptions\s*=\s*\{/.exec(region);
    if (!opt) continue;
    const exprOpen = m.index + opt.index + opt[0].length - 1;
    const inner = skipSpace(skel, exprOpen + 1);
    let objOpen = skel[inner] === "{" ? inner : -1;
    if (objOpen < 0) {
      const id = /^([A-Za-z_$][\w$]*)/.exec(code.slice(inner))?.[1];
      if (id) {
        const mm = new RegExp(`\\b(?:const|let|var)\\s+${id.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*\\{`).exec(skel);
        if (mm) objOpen = mm.index + mm[0].length - 1;
      }
    }
    if (objOpen < 0) {
      out.inits.push(opaqueInit(ctx, "js", "provider", m.index));
      continue;
    }
    const init = initFromObject(ctx, objOpen, "js", "provider", m.index);
    if (init) {
      out.inits.push(init);
      if (init.identityExpr) out.identifies.push({ loc: init.loc, expr: init.identityExpr, raw: init.identityExpr, via: "init-identity", awaited: true, sdk: "js" });
    }
  }
  for (const m of code.matchAll(/\bupdate_experiment\b/g)) out.experimentUpdates.push({ loc: makeLoc(ctx, m.index), via: "mcp-update_experiment" });
  for (const m of code.matchAll(/['"`][^'"`\n]*\/experiments\/[^'"`\n]*['"`]/g)) {
    const around = code.slice(Math.max(0, m.index - 200), m.index + m[0].length + 300);
    if (/method\s*:\s*['"]PUT['"]|\.put\s*\(|-X\s*PUT\b/i.test(around)) out.experimentUpdates.push({ loc: makeLoc(ctx, m.index), via: "http-put" });
  }
  for (const m of skel.matchAll(/\bprocess\.exit\s*\(/g)) out.exits.push({ loc: makeLoc(ctx, m.index), kind: "process.exit" });
  for (const r of ctx.handlerRanges) out.exits.push({ loc: makeLoc(ctx, r.start), kind: r.kind });
}
function classify(ctx, usesFlagsmith) {
  const { skel, path } = ctx;
  if (/\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|\bexport\s+(?:const|let)\s+(GET|POST|handler)\s*=|\bexport\s+default\s+(?:async\s+)?function\s+handler\b|\bexports\.handler\s*=/.test(skel) || /(^|\/)(pages\/api|app\/api|netlify\/functions|api)\/.+\.(?:[mc]?[jt]s)$/.test(path)) {
    return "serverless";
  }
  if (/\.listen\s*\(|\bcreateServer\s*\(|\bfastify\s*\(|\bnew\s+Hono\s*\(|\bBun\.serve\s*\(/.test(skel)) return "node-server";
  const nodeSdk = ctx.sdkHint === "node";
  const scripty = /\bprocess\.exit\s*\(|\bprocess\.argv\b|^\s*#!|^\s*(?:await\s+)?main\s*\(|\bmain\s*\(\s*\)\s*\.(then|catch)\s*\(/m.test(ctx.code);
  if (scripty && (nodeSdk || /\bprocess\./.test(skel))) return "node-script";
  if (ctx.imports.some((i) => i.sdk === "js" && /\/react$/.test(i.spec)) || /\b(useExperiment|useFlags|useFlagsmith)\s*\(|<FlagsmithProvider\b/.test(skel)) return "react";
  if (ctx.sdkHint === "js" || usesFlagsmith && /\b(window|document)\s*\./.test(skel)) return "browser";
  return "unknown";
}
function scanFiles(input2, options = {}) {
  const files = input2.map((f) => ({ path: f.path.replace(/\\/g, "/").replace(/^\.\//, ""), content: f.content }));
  const packages = [];
  const installed = [];
  const appRoots = /* @__PURE__ */ new Set();
  const skipped = [];
  let usesFlagsmithMcp = false;
  for (const f of files) {
    if (isInstalledManifest(f.path)) {
      const inst = readInstalled(f.path, f.content);
      if (inst) installed.push(inst);
      continue;
    }
    if (IGNORED.test(f.path) || TEST_PATH.test(f.path) || BUNDLE_DIR.test(f.path)) continue;
    if (/(^|\/)package\.json$/.test(f.path)) {
      packages.push(...readManifest(f.path, f.content));
      appRoots.add(f.path.replace(/(^|\/)package\.json$/, ""));
    }
    if (MCP_FILES.test(f.path) && /flagsmith/i.test(f.content)) usesFlagsmithMcp = true;
  }
  for (const p of packages) {
    const root = p.manifest.file.replace(/package\.json$/, "");
    const inst = installed.filter((i) => i.name === p.name).sort((a, b) => b.root.length - a.root.length).find((i) => root.startsWith(i.root) || i.root.startsWith(root));
    p.installed = inst ? inst.version : null;
  }
  const ctxs = [];
  for (const f of files) {
    if (!CODE_EXT.test(f.path) || IGNORED.test(f.path) || /\.d\.ts$/.test(f.path)) continue;
    const notAppCode = skipReason(f.path, f.content);
    if (notAppCode) {
      skipped.push({ file: f.path, reason: notAppCode });
      continue;
    }
    const { code, skeleton } = lex(f.content);
    const ctx = {
      path: f.path,
      code,
      skel: skeleton,
      lines: new LineIndex(f.content),
      imports: parseImports(code),
      sdkHint: null,
      clients: /* @__PURE__ */ new Map(),
      nodeClasses: /* @__PURE__ */ new Set(),
      factories: /* @__PURE__ */ new Set(),
      flagsObjects: /* @__PURE__ */ new Set(),
      boundFns: /* @__PURE__ */ new Map(),
      consts: /* @__PURE__ */ new Map(),
      exportedClients: /* @__PURE__ */ new Map(),
      defaultExportClient: null,
      handlerRanges: []
    };
    const sdks = new Set(ctx.imports.map((i) => i.sdk).filter((s) => !!s));
    if (sdks.size === 1) ctx.sdkHint = [...sdks][0];
    collectConsts(ctx);
    collectBindings(ctx);
    collectHandlers(ctx);
    ctxs.push(ctx);
  }
  const globalConsts = /* @__PURE__ */ new Map();
  const ambiguous = /* @__PURE__ */ new Set();
  for (const c of ctxs) {
    for (const [k, v] of c.consts) {
      if (globalConsts.has(k) && globalConsts.get(k) !== v) ambiguous.add(k);
      else globalConsts.set(k, v);
    }
  }
  for (const k of ambiguous) globalConsts.delete(k);
  const exported = /* @__PURE__ */ new Map();
  const defaultByModule = /* @__PURE__ */ new Map();
  for (const c of ctxs) {
    for (const [k, v] of c.exportedClients) exported.set(k, v);
    if (c.defaultExportClient) defaultByModule.set(c.path.replace(/\.[^./]+$/, "").split("/").pop(), c.defaultExportClient);
  }
  for (const c of ctxs) {
    for (const imp of c.imports) {
      if (imp.sdk || !imp.spec.startsWith(".") && !imp.spec.startsWith("@/") && !imp.spec.startsWith("~/")) continue;
      for (const n of imp.named) {
        const sdk = exported.get(n.imported);
        if (sdk) c.clients.set(n.local, sdk);
      }
      if (imp.defaultName) {
        const base = imp.spec.split("/").pop().replace(/\.[^.]+$/, "");
        const sdk = defaultByModule.get(base) ?? (base === "index" ? void 0 : defaultByModule.get(base));
        if (sdk) c.clients.set(imp.defaultName, sdk);
      }
      if (!c.sdkHint) {
        const viaImport = [...c.clients.values()];
        if (viaImport.length) c.sdkHint = viaImport[0];
      }
    }
  }
  const globalClients = /* @__PURE__ */ new Map();
  for (const c of ctxs) for (const [k, v] of c.clients) if (!globalClients.has(k)) globalClients.set(k, v);
  const out = { inits: [], identifies: [], experimentFlags: [], plainFlagReads: [], trackEvents: [], exposures: [], flushes: [], exits: [], experimentUpdates: [] };
  const summaries = [];
  for (const c of ctxs) {
    const before = countAll(out);
    collectCalls(c, globalConsts, out, globalClients);
    const used = countAll(out) > before || c.imports.some((i) => i.sdk) || c.clients.size > 0;
    if (used) {
      const summary = { file: c.path, runtime: classify(c, used), usesFlagsmith: true };
      const local = c.imports.map((i) => resolveRelative(c.path, i.spec)).filter((p) => p !== null);
      if (local.length) summary.imports = [...new Set(local)].sort();
      summaries.push(summary);
    } else {
      out.exits = out.exits.filter((e) => e.loc.file !== c.path);
    }
  }
  const byLoc = (a, b) => a.loc.file.localeCompare(b.loc.file) || a.loc.line - b.loc.line;
  const evidence = {
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
    exits: out.exits.sort(byLoc)
  };
  if (options.root) evidence.root = options.root;
  if (usesFlagsmithMcp) evidence.usesFlagsmithMcp = true;
  if (out.experimentUpdates.length) evidence.experimentUpdates = out.experimentUpdates.sort(byLoc);
  if (appRoots.size) evidence.appRoots = [...appRoots].sort();
  if (skipped.length) evidence.skipped = skipped.sort((a, b) => a.file.localeCompare(b.file));
  return evidence;
}
function countAll(c) {
  return c.inits.length + c.identifies.length + c.experimentFlags.length + c.plainFlagReads.length + c.trackEvents.length + c.exposures.length + c.flushes.length;
}
function dedupe(ids) {
  const seen = /* @__PURE__ */ new Set();
  return ids.filter((i) => {
    const k = `${i.loc.file}:${i.loc.line}:${i.via}:${i.expr}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// src/gate.ts
var SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
function primaryLocation(f) {
  for (const e of f.evidence) {
    if (e.location) {
      return {
        file: e.location.file,
        line: e.location.line,
        text: (e.location.text ?? e.location.snippet ?? "").replace(/\s+/g, " ").trim()
      };
    }
  }
  if (f.fix.patch) return { file: f.fix.patch.file, line: f.fix.patch.line, text: f.fix.patch.before.replace(/\s+/g, " ").trim() };
  return null;
}
function findingKey(f) {
  const loc = primaryLocation(f);
  return loc ? `${f.id}|${loc.file}|${loc.text}` : `${f.id}|-`;
}
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
function findRenames(base, head, metrics) {
  if (!base || !head) return [];
  const baseNames = new Set(base.trackEvents.map((t) => t.event).filter((e) => Boolean(e)));
  const headNames = new Set(head.trackEvents.map((t) => t.event).filter((e) => Boolean(e)));
  const renames = [];
  for (const gone of baseNames) {
    if (headNames.has(gone)) continue;
    for (const t of head.trackEvents) {
      if (!t.event || baseNames.has(t.event)) continue;
      const close = t.event.toLowerCase() === gone.toLowerCase() || editDistance(t.event, gone) <= 2;
      if (close) {
        renames.push({
          from: gone,
          to: t.event,
          file: t.loc.file,
          line: t.loc.line,
          breaksMetric: metrics.includes(gone) && !metrics.includes(t.event)
        });
      }
    }
  }
  return renames;
}
function runGate(base, head, code, config) {
  const baseKeys = new Set((base?.findings ?? []).map(findingKey));
  const headKeys = new Set(head.findings.map(findingKey));
  const defects = head.findings.filter((f) => f.kind === "defect");
  const introduced = defects.filter((f) => !baseKeys.has(findingKey(f)));
  const unchanged = defects.filter((f) => baseKeys.has(findingKey(f)));
  const fixed = (base?.findings ?? []).filter((f) => f.kind === "defect" && !headKeys.has(findingKey(f)));
  const renames = findRenames(code.base, code.head, config.metrics);
  const blocking2 = (f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[config.failOn] && f.confidence >= config.minConfidence;
  const failing = introduced.some(blocking2) || renames.some((r) => r.breaksMetric);
  const annotations = [];
  for (const r of renames) {
    annotations.push({
      level: r.breaksMetric ? "error" : "warning",
      file: r.file,
      line: r.line,
      title: r.breaksMetric ? "Experiment regression: conversion event renamed" : "Conversion event renamed",
      message: r.breaksMetric ? `trackEvent("${r.from}") became trackEvent("${r.to}"), but the metric still listens for "${r.from}". Conversions will silently stop counting.` : `trackEvent("${r.from}") became trackEvent("${r.to}"). Check that a metric listens for the new name.`
    });
  }
  for (const f of introduced) {
    const loc = primaryLocation(f);
    if (!loc) continue;
    annotations.push({
      level: blocking2(f) ? "error" : "warning",
      file: loc.file,
      line: loc.line,
      title: `${f.id} ${f.title}`.slice(0, 120),
      message: `${f.detail} Fix: ${f.fix.summary}`
    });
  }
  return { introduced, fixed, unchanged, renames, failing, annotations };
}
function summaryMarkdown(result, head) {
  const lines = [];
  lines.push(`## Experiment Doctor CI Gate: ${result.failing ? "\u274C failed" : "\u2705 passed"}`);
  lines.push("");
  lines.push(
    result.failing ? "This pull request introduces a change that would make the experiment stop counting. Nothing else in the build would catch it: SDKs skip events silently." : "No new experiment regressions in this pull request."
  );
  lines.push("");
  if (result.renames.length) {
    lines.push("### Renamed conversion events");
    lines.push("| From | To | Where | Breaks a metric |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of result.renames) lines.push(`| \`${r.from}\` | \`${r.to}\` | ${r.file}:${r.line} | ${r.breaksMetric ? "yes" : "no"} |`);
    lines.push("");
  }
  const table = (title, findings) => {
    if (!findings.length) return;
    lines.push(`### ${title}`);
    lines.push("| Rule | Finding | Where | Confidence |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of findings) {
      const loc = primaryLocation(f);
      lines.push(`| ${f.id} | ${f.title} | ${loc ? `${loc.file}:${loc.line}` : "config"} | ${Math.round(f.confidence * 100)}% |`);
    }
    lines.push("");
  };
  table("Introduced by this PR", result.introduced);
  table("Fixed by this PR", result.fixed);
  if (result.unchanged.length) lines.push(`${result.unchanged.length} existing finding(s) unchanged, not blocking.`, "");
  lines.push(`Head verdict: **${head.verdict}**. Pending experiment data never fails this check.`);
  return lines.join("\n");
}

// src/main.ts
var CODE = /\.(?:[mc]?[jt]sx?)$/i;
var SKIP = /(^|\/)(node_modules|dist|build|\.next|out|coverage|\.git)(\/|$)/;
function input(name, fallback = "") {
  const fromEnv = process.env[`INPUT_${name.toUpperCase().replace(/ /g, "_")}`];
  const flag = process.argv.indexOf(`--${name}`);
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
  return (fromEnv ?? "").trim() || fallback;
}
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
function loadConfig(root) {
  const file = join(root, ".experiment-doctor.json");
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8"));
}
function walk(dir, root, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (SKIP.test(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else if ((CODE.test(name) || name === "package.json") && st.size < 512e3) out.push({ path: rel, content: readFileSync(full, "utf8") });
  }
}
function headFiles(root, paths) {
  const out = [];
  for (const p of paths) {
    const dir = join(root, p);
    if (existsSync(dir)) walk(dir, root, out);
  }
  return out;
}
function baseFiles(root, ref, paths) {
  let listing;
  try {
    listing = git(["ls-tree", "-r", "--name-only", ref, "--", ...paths], root);
  } catch {
    return null;
  }
  const out = [];
  for (const path of listing.split("\n").filter(Boolean)) {
    if (SKIP.test(path) || !(CODE.test(path) || path.endsWith("package.json"))) continue;
    try {
      out.push({ path, content: git(["show", `${ref}:${path}`], root) });
    } catch {
    }
  }
  return out;
}
function configEvidence(cfg) {
  if (!cfg.flag && !cfg.metrics?.length) return null;
  return {
    source: "file",
    flag: cfg.flag ? { name: cfg.flag, variants: (cfg.variants ?? []).map((key, i) => ({ id: i + 1, value: key, key })) } : null,
    metrics: (cfg.metrics ?? []).map((event, i) => ({ id: i + 1, name: event, event, aggregation: "occurrence" }))
  };
}
function report(code, cfg) {
  return diagnose({
    schemaVersion: 1,
    target: cfg.flag ? { flag: cfg.flag } : void 0,
    config: configEvidence(cfg),
    code
  });
}
function escapeData(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProp(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
function emit(a) {
  console.log(`::${a.level} file=${escapeProp(a.file)},line=${a.line},title=${escapeProp(a.title)}::${escapeData(a.message)}`);
}
function main() {
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const cfg = loadConfig(root);
  const paths = cfg.paths?.length ? cfg.paths : ["."];
  const baseRef = input("base") || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1");
  const failOn = input("fail-on", "critical") ?? "critical";
  const minConfidence = Number(input("min-confidence", "0.8"));
  let mergeBase = baseRef;
  try {
    mergeBase = git(["merge-base", baseRef, "HEAD"], root).trim() || baseRef;
  } catch {
  }
  const headCode = scanFiles(headFiles(root, paths), { root });
  const baseSources = baseFiles(root, mergeBase, paths);
  const baseCode = baseSources ? scanFiles(baseSources, { root }) : null;
  const head = report(headCode, cfg);
  const base = baseCode ? report(baseCode, cfg) : null;
  const result = runGate(base, head, { base: baseCode, head: headCode }, {
    metrics: cfg.metrics ?? [],
    failOn,
    minConfidence
  });
  for (const a of result.annotations) emit(a);
  const summary = summaryMarkdown(result, head);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  else console.log("\n" + summary);
  console.log(
    `
experiment-doctor ci: ${result.introduced.length} introduced, ${result.fixed.length} fixed, ${result.renames.length} renamed event(s) vs ${mergeBase.slice(0, 12)}`
  );
  process.exitCode = result.failing ? 1 : 0;
}
main();
