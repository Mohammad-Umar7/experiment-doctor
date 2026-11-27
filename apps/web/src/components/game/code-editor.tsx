"use client";

import { useMemo, useRef } from "react";
import { highlight } from "sugar-high";
import { cn } from "@/lib/cn";

const LINE = 22; // px, must match leading-[22px]
const PAD_Y = 14;

export type LineMark = { line: number; tone: "critical" | "healthy" };

/**
 * A light code editor: a transparent textarea stacked on highlighted code in one grid cell,
 * so both always have identical size and no scroll syncing is needed.
 */
export function CodeEditor({
  value,
  onChange,
  onSubmit,
  readOnly = false,
  marks = [],
  label,
  className,
}: {
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  readOnly?: boolean;
  marks?: LineMark[];
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => highlight(value), [value]);
  const lineCount = value.split("\n").length;

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && !readOnly) {
      // Insert two spaces instead of leaving the editor. Escape then Tab still moves focus.
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = value.slice(0, s) + "  " + value.slice(end);
      onChange?.(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = s + 2;
      });
    }
  }

  return (
    <div className={cn("relative flex overflow-auto bg-canvas font-mono text-[13px] leading-[22px]", className)}>
      {/* gutter */}
      <div
        aria-hidden
        className="sticky left-0 z-10 shrink-0 select-none border-r border-border bg-canvas px-3 text-right text-fg-muted/70"
        style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="tabular">
            {String(i + 1).padStart(2, "0")}
          </div>
        ))}
      </div>

      <div className="relative min-w-0 flex-1">
        {marks.map((m) => (
          <div
            key={`${m.line}-${m.tone}`}
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 border-l-2",
              m.tone === "critical" ? "border-critical bg-critical/[0.08]" : "border-healthy bg-healthy/[0.07]",
            )}
            style={{ top: PAD_Y + (m.line - 1) * LINE, height: LINE }}
          />
        ))}

        <div className="grid min-w-max">
          <pre
            aria-hidden
            className="pointer-events-none m-0 whitespace-pre px-4 [grid-area:1/1]"
            style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y }}
          >
            <code dangerouslySetInnerHTML={{ __html: html + "\n" }} />
          </pre>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            aria-label={label}
            className="m-0 resize-none overflow-hidden whitespace-pre bg-transparent px-4 text-transparent caret-accent outline-none [grid-area:1/1] selection:bg-accent/40 selection:text-transparent focus-visible:outline-none"
            style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y }}
          />
        </div>
      </div>
    </div>
  );
}
