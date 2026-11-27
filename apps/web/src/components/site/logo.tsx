import Link from "next/link";
import { cn } from "@/lib/cn";

/** Mark: a single heartbeat inside a rounded square. Wordmark is lowercase by design. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#11141B" stroke="#272D38" />
      <path
        d="M4 17h6l2-4 3 9 3-14 2.5 9H28"
        fill="none"
        stroke="#22FF88"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group flex items-center gap-2.5", className)} aria-label="Experiment Doctor home">
      <LogoMark className="transition-transform duration-300 group-hover:scale-105" />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">
        experiment <span className="text-fg-secondary">doctor</span>
      </span>
    </Link>
  );
}
