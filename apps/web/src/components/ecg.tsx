"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { ecgPoints, toPath, yAt } from "@/lib/ecg";

type Tone = "healthy" | "critical" | "muted";

const toneColor: Record<Tone, string> = {
  healthy: "#22FF88",
  critical: "#FF5263",
  muted: "#778195",
};

/**
 * A vital-signs style ECG trace with a sweeping write head.
 * `alive` morphs the line between a flatline and a heartbeat.
 * The loop pauses off-screen and in hidden tabs; reduced motion renders a still trace.
 */
export function Ecg({
  alive,
  tone,
  width = 640,
  height = 120,
  period = 160,
  cycle = 2.4,
  morphMs = 300,
  className,
  label,
}: {
  alive: boolean;
  tone?: Tone;
  width?: number;
  height?: number;
  period?: number;
  cycle?: number;
  morphMs?: number;
  className?: string;
  label?: string;
}) {
  const reduce = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const color = toneColor[tone ?? (alive ? "healthy" : "critical")];

  const svgRef = useRef<SVGSVGElement>(null);
  const dimRef = useRef<SVGPathElement>(null);
  const brightRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const sweepRef = useRef<SVGRectElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const ampRef = useRef(alive ? 1 : 0);
  const targetRef = useRef(alive ? 1 : 0);
  const morphStartRef = useRef<{ from: number; t0: number } | null>(null);

  const sweepWidth = width * 0.45;
  const initialPath = useMemo(() => toPath(ecgPoints(width, height, period, alive ? 1 : 0)), [width, height, period]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start a morph whenever `alive` flips.
  useEffect(() => {
    const target = alive ? 1 : 0;
    if (targetRef.current === target) return;
    targetRef.current = target;
    morphStartRef.current = { from: ampRef.current, t0: performance.now() };
    if (reduce) {
      ampRef.current = target;
      const d = toPath(ecgPoints(width, height, period, target));
      dimRef.current?.setAttribute("d", d);
      brightRef.current?.setAttribute("d", d);
      glowRef.current?.setAttribute("d", d);
    }
  }, [alive, reduce, width, height, period]);

  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let visible = true;
    let pageVisible = typeof document === "undefined" ? true : document.visibilityState === "visible";
    let points = ecgPoints(width, height, period, ampRef.current);
    const start = performance.now();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && pageVisible && !raf) raf = requestAnimationFrame(tick);
    });
    if (svgRef.current) io.observe(svgRef.current);
    const onVis = () => {
      pageVisible = document.visibilityState === "visible";
      if (visible && pageVisible && !raf) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", onVis);

    function tick(now: number) {
      raf = 0;
      const morph = morphStartRef.current;
      if (morph) {
        const t = Math.min(1, (now - morph.t0) / morphMs);
        const eased = 1 - Math.pow(1 - t, 3);
        ampRef.current = morph.from + (targetRef.current - morph.from) * eased;
        points = ecgPoints(width, height, period, ampRef.current);
        const d = toPath(points);
        dimRef.current?.setAttribute("d", d);
        brightRef.current?.setAttribute("d", d);
        glowRef.current?.setAttribute("d", d);
        if (t >= 1) morphStartRef.current = null;
      }
      const phase = (((now - start) / 1000) % cycle) / cycle;
      const x = -sweepWidth + phase * (width + sweepWidth);
      sweepRef.current?.setAttribute("x", x.toFixed(1));
      const headX = Math.min(width, Math.max(0, x + sweepWidth));
      headRef.current?.setAttribute("cx", headX.toFixed(1));
      headRef.current?.setAttribute("cy", yAt(points, headX).toFixed(1));
      if (visible && pageVisible) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduce, width, height, period, cycle, morphMs, sweepWidth]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label ?? (alive ? "Heartbeat: experiment healthy" : "Flatline: experiment not receiving conversions")}
    >
      <defs>
        <linearGradient id={`g-${id}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="80%" stopColor="white" stopOpacity="0.85" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id={`m-${id}`} maskUnits="userSpaceOnUse">
          {reduce ? (
            <rect x={0} y={0} width={width} height={height} fill="white" />
          ) : (
            <rect ref={sweepRef} x={-sweepWidth} y={0} width={sweepWidth} height={height} fill={`url(#g-${id})`} />
          )}
        </mask>
        <filter id={`f-${id}`} x="-10%" y="-50%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <path
        ref={dimRef}
        d={initialPath}
        fill="none"
        stroke={color}
        strokeOpacity={0.16}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <g mask={`url(#m-${id})`}>
        <path
          ref={glowRef}
          d={initialPath}
          fill="none"
          stroke={color}
          strokeOpacity={0.5}
          strokeWidth={4}
          filter={`url(#f-${id})`}
          vectorEffect="non-scaling-stroke"
        />
        <path
          ref={brightRef}
          d={initialPath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      {!reduce && <circle ref={headRef} r={3.5} cx={0} cy={height / 2} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />}
    </svg>
  );
}
