"use client";

import { motion } from "motion/react";
import { duration, ease } from "@/lib/motion";

/** Fades and lifts content 12px the first time it scrolls into view. */
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
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: duration.entrance, ease: ease.smooth, delay }}
    >
      {children}
    </Tag>
  );
}
