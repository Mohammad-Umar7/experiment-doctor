/**
 * ECG waveform geometry.
 *
 * The path always has the same number of points for a given width and period,
 * so it can be morphed from a flatline (amplitude 0) into a heartbeat (amplitude 1)
 * by only changing y values.
 */

export type Point = { x: number; y: number };

/** One PQRST complex as (phase 0..1, height) pairs. Negative height goes up. */
const COMPLEX: Array<[number, number]> = [
  [0.0, 0],
  [0.08, 0],
  [0.12, -3],
  [0.16, -5],
  [0.2, -3],
  [0.24, 0],
  [0.3, 0],
  [0.32, 5],
  [0.355, -40],
  [0.39, 15],
  [0.42, 0],
  [0.5, 0],
  [0.56, -6],
  [0.62, -10],
  [0.68, -6],
  [0.74, 0],
  [1.0, 0],
];

export function ecgPoints(width: number, height: number, period: number, amplitude: number): Point[] {
  const mid = height / 2;
  const points: Point[] = [];
  const beats = Math.ceil(width / period) + 1;
  for (let b = 0; b < beats; b++) {
    for (const [phase, h] of COMPLEX) {
      const x = b * period + phase * period;
      if (x > width + period) break;
      points.push({ x, y: mid + h * amplitude * (height / 100) });
    }
  }
  return points;
}

export function toPath(points: Point[]): string {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    d += `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return d;
}

/** Linear interpolation of y at x along a monotonic-in-x polyline. */
export function yAt(points: Point[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return points[points.length - 1].y;
}
