"use client";

import { useEffect, useRef, useState } from "react";

const fmt = new Intl.NumberFormat("en-IN"); // Indian grouping: 1,06,000

/**
 * Animated count-up for metric figures. Starts at 0 and eases to `value`.
 * Honors prefers-reduced-motion by showing the final value immediately.
 * Digits render in Sora with tabular numerals via the "mono" class.
 */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(Math.round(value * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <span className="mono">{fmt.format(display)}</span>;
}
