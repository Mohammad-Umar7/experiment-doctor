"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";
import { duration } from "@/lib/motion";

function format(n: number, pad: number, decimals: number) {
  const fixed = n.toFixed(decimals);
  if (!pad) return fixed;
  const [int, frac] = fixed.split(".");
  return int.padStart(pad, "0") + (frac ? `.${frac}` : "");
}

/** A number that eases to its new value over 450ms. Only animates real changes. */
export function Counter({
  value,
  pad = 0,
  decimals = 0,
  suffix = "",
  className,
}: {
  value: number;
  pad?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(value);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || last.current === value) {
      el.textContent = format(value, pad, decimals) + suffix;
      last.current = value;
      return;
    }
    const controls = animate(last.current, value, {
      duration: duration.counter,
      ease: "easeOut",
      onUpdate: (v) => {
        el.textContent = format(v, pad, decimals) + suffix;
      },
    });
    last.current = value;
    return () => controls.stop();
  }, [value, pad, decimals, suffix, reduce]);

  return (
    <span ref={ref} className={`tabular ${className ?? ""}`}>
      {format(value, pad, decimals) + suffix}
    </span>
  );
}
