"use client";

import { Ecg } from "@/components/ecg";
import { Pipeline, type Stage } from "@/components/pipeline";
import { Counter } from "@/components/counter";
import type { GameCase } from "@/lib/game/cases";
import type { StageKey } from "@/lib/game/verify";
import type { ResurrectionStep } from "@/lib/use-resurrection";

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: "app", label: "App" },
  { key: "sdk", label: "SDK" },
  { key: "flagsmith", label: "Flagsmith" },
  { key: "warehouse", label: "Warehouse" },
  { key: "results", label: "Results" },
];

function stagesFor(broken: StageKey | null, fixed: boolean): Stage[] {
  const brokenIndex = broken ? STAGES.findIndex((s) => s.key === broken) : -1;
  return STAGES.map((s, i) => ({
    ...s,
    status: fixed || brokenIndex === -1 ? "ok" : i < brokenIndex ? "ok" : i === brokenIndex ? "broken" : "unknown",
  }));
}

/** Everything the player can see about the patient: config, vitals and where the signal dies. */
export function EvidencePanel({
  game,
  brokenStage,
  step,
}: {
  game: GameCase;
  brokenStage: StageKey | null;
  step: ResurrectionStep;
}) {
  const alive = step.heartbeat;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[10px] border border-border bg-canvas/60">
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
          <div className="px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">Exposures</p>
            <p className="mt-1 font-mono text-xl text-fg">
              <Counter value={alive ? Math.max(game.vitals.exposures, 248) : game.vitals.exposures} />
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">Conversions</p>
            <p className="mt-1 font-mono text-xl">
              <Counter value={alive ? 17 : game.vitals.conversions} pad={3} className={alive ? "text-healthy" : "text-critical"} />
            </p>
          </div>
        </div>
        <div className="px-2 py-2">
          <Ecg alive={alive} width={420} height={70} period={120} className="h-auto w-full" />
        </div>
        <div className="border-t border-border px-3 py-3">
          <Pipeline stages={stagesFor(brokenStage, step.nodeFixed)} compact />
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[10px] border border-border bg-canvas/60 px-4 py-3 font-mono text-[12px]">
        <dt className="text-fg-muted">flag</dt>
        <dd className="truncate text-fg">{game.config.flag}</dd>
        <dt className="text-fg-muted">variants</dt>
        <dd className="truncate text-fg-secondary">{game.config.variants.join(", ")}</dd>
        <dt className="text-fg-muted">metric event</dt>
        <dd className="truncate text-fg">{game.config.metric}</dd>
        <dt className="text-fg-muted">sdk</dt>
        <dd className="truncate text-fg-secondary">{game.config.sdk}</dd>
        <dt className="text-fg-muted">warehouse</dt>
        <dd className="text-healthy">{game.config.warehouse}</dd>
        <dt className="text-fg-muted">experiment</dt>
        <dd className="text-healthy">{game.config.experiment}</dd>
      </dl>
    </div>
  );
}
