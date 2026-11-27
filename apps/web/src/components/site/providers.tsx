"use client";

import { MotionConfig } from "motion/react";

/** Global client providers. Motion follows the user's reduced-motion setting everywhere. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
