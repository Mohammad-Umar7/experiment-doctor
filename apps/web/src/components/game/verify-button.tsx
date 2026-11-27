"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";

/**
 * Primary action. While verifying, a 400ms charge fills the button (a nod to the
 * defibrillator, without the hold-to-charge friction). Disabled while a request is in flight.
 */
export function VerifyButton({
  onClick,
  verifying,
  disabled,
  className,
}: {
  onClick: () => void;
  verifying: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || verifying}
      className={cn(
        "relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-[8px] bg-accent px-5 text-[15px] font-medium text-white",
        "shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_8px_24px_rgba(104,55,252,0.28)] transition-[transform,filter] duration-[140ms]",
        "hover:-translate-y-px hover:brightness-110 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed",
        disabled && !verifying && "opacity-50",
        className,
      )}
    >
      {verifying && (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-white/20"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <span className="relative">{verifying ? "Verifying repair…" : "Verify repair"}</span>
      {!verifying && (
        <kbd className="relative hidden rounded border border-white/25 px-1.5 py-0.5 font-mono text-[10px] text-white/80 sm:inline">
          Ctrl ↵
        </kbd>
      )}
    </button>
  );
}
