/** Shared easing curves from docs/design.md. */
export const ease = {
  smooth: [0.22, 1, 0.36, 1],
  standard: [0.4, 0, 0.2, 1],
} as const;

/** Durations in seconds, named after what they animate. */
export const duration = {
  press: 0.1,
  hover: 0.14,
  hint: 0.2,
  counter: 0.45,
  entrance: 0.45,
  bars: 0.6,
  resurrection: 1.4,
} as const;

/** Entrance used by hero blocks: fade in and rise 12px, staggered by 60ms. */
export const rise = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: duration.entrance, ease: ease.smooth, delay: i * 0.06 },
  }),
};
