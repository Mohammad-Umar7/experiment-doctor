"use client";

import { useMemo, useState } from "react";
import type { TimelinePoint } from "@/lib/experiment-results";

/** Validated with the dataviz palette checker against the dark surface #11141B (CVD ΔE 26.8). */
export const VARIANT_COLOR: Record<string, string> = {
  control: "#3987E5",
  one_fix: "#D95926",
};
const VARIANT_NAME: Record<string, string> = { control: "A · full report", one_fix: "B · one fix" };

const W = 520;
const H = 150;
const PAD = { top: 12, right: 76, bottom: 22, left: 34 };

function fmtBucket(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

function Chart({ title, points, kind }: { title: string; points: TimelinePoint[]; kind: "exposed" | "converted" }) {
  const [hover, setHover] = useState<number | null>(null);
  const keys = Object.keys(VARIANT_COLOR);
  const max = Math.max(1, ...points.flatMap((p) => keys.map((k) => p[kind][k] ?? 0)));
  const x = (i: number) => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const ticks = [0, Math.round(max / 2), max];
  const last = points.length - 1;

  return (
    <figure className="min-w-0">
      <figcaption className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">{title}</figcaption>
      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}: ${keys.map((k) => `${VARIANT_NAME[k]} ${points[last]?.[kind][k] ?? 0}`).join(", ")}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            let best = 0;
            for (let i = 0; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
            setHover(best);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#272D38" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#778195" fontFamily="var(--font-mono)">
                {t}
              </text>
            </g>
          ))}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="#778195" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {keys.map((k) => {
            const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[kind][k] ?? 0).toFixed(1)}`).join("");
            const end = points[last]?.[kind][k] ?? 0;
            return (
              <g key={k}>
                <path d={d} fill="none" stroke={VARIANT_COLOR[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(p[kind][k] ?? 0)}
                    r={hover === i ? 4.5 : 0}
                    fill={VARIANT_COLOR[k]}
                    stroke="#11141B"
                    strokeWidth={2}
                  />
                ))}
                {/* direct label at the line end, in text ink with a color chip */}
                <circle cx={W - PAD.right + 10} cy={y(end)} r={3} fill={VARIANT_COLOR[k]} />
                <text x={W - PAD.right + 18} y={y(end) + 3.5} fontSize={10.5} fill="#A0A8B8" fontFamily="var(--font-mono)">
                  {k === "control" ? "A" : "B"} {end}
                </text>
              </g>
            );
          })}
          {points.length > 0 && (
            <>
              <text x={PAD.left} y={H - 6} fontSize={10} fill="#778195" fontFamily="var(--font-mono)">
                {fmtBucket(points[0].bucket)}
              </text>
              {last > 0 && (
                <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="#778195" fontFamily="var(--font-mono)">
                  {fmtBucket(points[last].bucket)}
                </text>
              )}
            </>
          )}
        </svg>
        {hover !== null && points[hover] && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-border bg-elevated px-2.5 py-1.5 font-mono text-[11px] text-fg shadow-[var(--shadow-card)]"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > last / 2 ? "-105%" : "5%"})` }}
          >
            <p className="text-fg-muted">{fmtBucket(points[hover].bucket)}</p>
            {keys.map((k) => (
              <p key={k} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: VARIANT_COLOR[k] }} />
                {VARIANT_NAME[k]}: {points[hover][kind][k] ?? 0}
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

/** Running totals of identities exposed and converted per variant, straight from Flagsmith's results. */
export function Timeline({ points }: { points: TimelinePoint[] }) {
  const sorted = useMemo(() => [...points].sort((a, b) => a.bucket.localeCompare(b.bucket)), [points]);
  if (sorted.length === 0) {
    return <p className="text-[13px] text-fg-muted">Flagsmith has no time buckets for this experiment yet.</p>;
  }
  return (
    <div>
      <div className="flex flex-wrap gap-4 text-[12px] text-fg-secondary" aria-hidden>
        {Object.keys(VARIANT_COLOR).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: VARIANT_COLOR[k] }} />
            {VARIANT_NAME[k]}
          </span>
        ))}
      </div>
      <div className="mt-3 grid gap-5 md:grid-cols-2">
        <Chart title="Identities exposed (running total)" points={sorted} kind="exposed" />
        <Chart title="Verified repairs (running total)" points={sorted} kind="converted" />
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer font-mono text-[11px] text-fg-muted hover:text-fg-secondary">Show as a table</summary>
        <table className="mt-2 w-full font-mono text-[11.5px]">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="py-1 font-normal">bucket</th>
              <th className="py-1 text-right font-normal">A exposed</th>
              <th className="py-1 text-right font-normal">B exposed</th>
              <th className="py-1 text-right font-normal">A converted</th>
              <th className="py-1 text-right font-normal">B converted</th>
            </tr>
          </thead>
          <tbody className="text-fg-secondary">
            {sorted.map((p) => (
              <tr key={p.bucket} className="border-t border-border/60">
                <td className="py-1">{fmtBucket(p.bucket)}</td>
                <td className="py-1 text-right">{p.exposed.control ?? 0}</td>
                <td className="py-1 text-right">{p.exposed.one_fix ?? 0}</td>
                <td className="py-1 text-right">{p.converted.control ?? 0}</td>
                <td className="py-1 text-right">{p.converted.one_fix ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
