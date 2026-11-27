"use client";

import { createElement, useEffect, useRef } from "react";

/**
 * Fades content in the first time it scrolls into view, with a CSS transition.
 * Hidden only when the page has the .js class (set before paint in the root layout),
 * and revealed immediately if IntersectionObserver is missing.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.dataset.revealed = "";
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.revealed = "";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return createElement(
    as,
    {
      ref,
      className,
      "data-reveal": "",
      style: { "--reveal-delay": `${Math.round(delay * 1000)}ms` } as React.CSSProperties,
    },
    children,
  );
}
