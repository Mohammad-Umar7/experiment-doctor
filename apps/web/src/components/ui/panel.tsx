import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Card surface. `elevated` sits one step above the page surface. */
export function Panel({
  className,
  elevated = false,
  ...props
}: ComponentProps<"div"> & { elevated?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-border",
        elevated ? "bg-elevated" : "bg-surface",
        className,
      )}
      {...props}
    />
  );
}

/** Small uppercase mono label used above headings and inside panels. */
export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-fg-muted", className)}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "rounded-[5px] border border-border bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary",
        className,
      )}
      {...props}
    />
  );
}
