import { cn } from "@/lib/cn";

export type Status = "healthy" | "critical" | "warning" | "unknown" | "info" | "accent";

const tone: Record<Status, { text: string; dot: string; ring: string }> = {
  healthy: { text: "text-healthy", dot: "bg-healthy", ring: "border-healthy/25 bg-healthy/[0.06]" },
  critical: { text: "text-critical", dot: "bg-critical", ring: "border-critical/25 bg-critical/[0.06]" },
  warning: { text: "text-warning", dot: "bg-warning", ring: "border-warning/25 bg-warning/[0.06]" },
  unknown: { text: "text-fg-muted", dot: "bg-fg-muted", ring: "border-border bg-elevated" },
  info: { text: "text-info", dot: "bg-info", ring: "border-info/25 bg-info/[0.06]" },
  accent: { text: "text-[#a98bff]", dot: "bg-accent", ring: "border-accent/30 bg-accent/[0.08]" },
};

/** A status label that never relies on color alone: dot + uppercase text. */
export function StatusPill({
  status,
  children,
  pulse = false,
  className,
}: {
  status: Status;
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  const t = tone[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
        t.ring,
        t.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot, pulse && "animate-critical-pulse")} aria-hidden />
      {children}
    </span>
  );
}
