"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

/** A shell command with a copy button. The prompt symbol is not copied. */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 rounded-[10px] border border-border bg-canvas px-3.5 py-2.5 font-mono text-[13px]",
        className,
      )}
    >
      <code className="min-w-0 overflow-x-auto whitespace-nowrap text-fg">
        <span className="select-none text-fg-muted">$ </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="relative flex h-8 min-w-14 items-center justify-center rounded-md border border-border px-2 text-[11px] uppercase tracking-[0.08em] text-fg-secondary transition-colors hover:border-border-strong hover:text-fg"
        aria-label={copied ? "Copied" : `Copy command: ${command}`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? "y" : "n"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className={copied ? "text-healthy" : undefined}
          >
            {copied ? "Copied" : "Copy"}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}
