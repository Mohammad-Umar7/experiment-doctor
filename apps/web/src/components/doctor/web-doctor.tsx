"use client";

import { useState } from "react";
import type { Evidence, Report } from "@experiment-doctor/core";
import { CodeEditor } from "@/components/game/code-editor";
import { ReportView } from "@/components/doctor/report-view";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/panel";
import { CASES } from "@/lib/game/cases";
import { diagnoseCode } from "@/lib/doctor/engine";
import { cn } from "@/lib/cn";

type Mode = "code" | "json";

const DEFAULT_SAMPLE = CASES[3]; // "Two faces": identity mismatch, a bug that is easy to miss in review

function configFrom(flag: string, metric: string, variants: string): Evidence["config"] {
  const keys = variants
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return {
    source: "file",
    flag: flag
      ? {
          name: flag,
          variants: keys.map((key, i) => ({ id: i + 1, value: key, key })),
        }
      : null,
    metrics: metric ? [{ id: 1, name: metric, event: metric, aggregation: "occurrence" }] : [],
  };
}

function isReport(value: unknown): value is Report {
  return Boolean(value && typeof value === "object" && "verdict" in value && "pipeline" in value && "findings" in value);
}

export function WebDoctor() {
  const [mode, setMode] = useState<Mode>("code");
  const [sampleId, setSampleId] = useState(DEFAULT_SAMPLE.id);
  const [file, setFile] = useState(DEFAULT_SAMPLE.file);
  const [code, setCode] = useState(DEFAULT_SAMPLE.code);
  const [flag, setFlag] = useState(DEFAULT_SAMPLE.config.flag);
  const [metric, setMetric] = useState(DEFAULT_SAMPLE.config.metric);

  function loadSample(id: string) {
    const sample = CASES.find((c) => c.id === id);
    if (!sample) return;
    setSampleId(id);
    setFile(sample.file);
    setCode(sample.code);
    setFlag(sample.config.flag);
    setMetric(sample.config.metric);
    setReport(null);
    setError(null);
  }
  const [variants, setVariants] = useState("one_click");
  const [json, setJson] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    try {
      if (mode === "code") {
        setReport(diagnoseCode([{ path: file || "app.js", content: code }], configFrom(flag, metric, variants), flag || undefined));
      } else {
        const parsed = JSON.parse(json);
        const candidate = parsed?.report ?? parsed;
        if (!isReport(candidate)) throw new Error("That JSON is not a Doctor report. Use experiment-doctor check --report report.json.");
        setReport(candidate);
      }
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Could not read that input.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <Eyebrow>Doctor report</Eyebrow>
      <h1 className="mt-2 max-w-[760px] text-balance text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
        Diagnose it here. Nothing leaves your browser.
      </h1>
      <p className="mt-3 max-w-[680px] text-[15px] leading-[1.6] text-fg-secondary">
        The same engine as the CLI, running inside this page. For the config checks (variant keys, warehouse, experiment
        status), run the CLI with your <code className="font-mono text-[13px] text-fg">flagsmith login</code>.
      </p>

      <ol className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border sm:grid-cols-3">
        {[
          ["Pick a sample or paste your file", "the code that calls Flagsmith"],
          ["Match your Flagsmith setup", "flag, metric event, variant keys"],
          ["Run the Doctor", "verdict, root cause and the exact fix"],
        ].map(([title, detail], n) => (
          <li key={title} className="flex min-w-0 items-center gap-3 bg-surface px-4 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 font-mono text-[11px] text-[#c4b0ff]">
              {n + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium text-fg">{title}</span>
              <span className="block truncate font-mono text-[11px] text-fg-muted">{detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="inline-flex rounded-[10px] border border-border bg-surface p-1" role="tablist" aria-label="Input">
            {(["code", "json"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "h-9 rounded-[7px] px-3 text-[13px] transition-colors",
                  mode === m ? "bg-elevated text-fg" : "text-fg-secondary hover:text-fg",
                )}
              >
                {m === "code" ? "Paste code" : "Open a CLI report"}
              </button>
            ))}
          </div>

          {mode === "code" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Experiment flag" value={flag} onChange={setFlag} />
                <Field label="Metric event" value={metric} onChange={setMetric} />
                <Field label="Variant keys" value={variants} onChange={setVariants} />
              </div>
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
                  <label htmlFor="file" className="sr-only">
                    File name
                  </label>
                  <input
                    id="file"
                    value={file}
                    onChange={(e) => setFile(e.target.value)}
                    className="h-7 w-28 min-w-0 rounded-md bg-transparent px-1 font-mono text-[12px] text-fg focus:bg-canvas focus:outline-none sm:w-48"
                  />
                  <label htmlFor="sample" className="sr-only">
                    Load a sample
                  </label>
                  <select
                    id="sample"
                    value={sampleId}
                    onChange={(e) => loadSample(e.target.value)}
                    className="ml-auto h-7 min-w-0 max-w-full flex-1 truncate rounded-md border border-border bg-canvas px-2 font-mono text-[11px] text-fg-secondary focus:border-accent focus:outline-none sm:max-w-[60%] sm:flex-none"
                  >
                    {CASES.map((c) => (
                      <option key={c.id} value={c.id}>
                        sample {c.id}: {c.title} ({c.failureId})
                      </option>
                    ))}
                  </select>
                </div>
                <CodeEditor value={code} onChange={setCode} onSubmit={run} label="Code to diagnose" className="max-h-[520px] min-h-[380px]" />
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="json" className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
                Report JSON
              </label>
              <textarea
                id="json"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder='Paste the file written by: npx experiment-doctor check --report report.json'
                className="mt-2 h-[460px] w-full resize-none rounded-[var(--radius-card)] border border-border bg-canvas p-4 font-mono text-[12.5px] text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                spellCheck={false}
              />
            </div>
          )}

          <Button size="lg" onClick={run} className="w-full sm:w-auto">
            Run the Doctor
          </Button>
          {error && (
            <p role="alert" className="text-[13px] text-critical">
              {error}
            </p>
          )}
        </div>

        <div aria-live="polite" className="min-w-0">
          {report ? (
            <ReportView report={report} />
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border-strong p-8 text-center">
              <div className="max-w-[340px]">
                <p className="text-[15px] font-medium text-fg">Your report shows up here.</p>
                <p className="mt-1.5 text-[13px] leading-[1.55] text-fg-muted">
                  Try the sample first: it has a bug that passes most code reviews.
                </p>
                <ul className="mx-auto mt-5 w-fit space-y-1.5 text-left font-mono text-[12px] text-fg-secondary">
                  <li>
                    <span className="text-healthy">✓</span> a verdict you can trust
                  </li>
                  <li>
                    <span className="text-healthy">✓</span> the root cause, with evidence
                  </li>
                  <li>
                    <span className="text-healthy">✓</span> the exact line to change
                  </li>
                </ul>
                <Button onClick={run} variant="secondary" className="mt-6">
                  Run on the sample
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-10 w-full rounded-[8px] border border-border bg-canvas px-3 font-mono text-[13px] text-fg focus:border-accent focus:outline-none"
      />
    </div>
  );
}
