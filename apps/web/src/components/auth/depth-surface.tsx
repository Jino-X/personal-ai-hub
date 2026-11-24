"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface DepthSurfaceProps extends ComponentProps<"div"> {
  /** The most a `.depth-stage` inside tilts, in degrees, with the pointer at an edge. */
  maxTilt?: number;
}

/**
 * Tracks the pointer over this element and writes it into CSS variables for the depth styles in
 * globals.css: --rx/--ry tilt any `.depth-stage` inside, --mx/--my place `.depth-sheen` lights, and
 * data-active marks a pointer over it. The variables are set directly, once per frame, so moving the
 * pointer never re-renders React. Touch and reduced motion get no tilt.
 */
export function DepthSurface({ maxTilt = 8, className, children, ...props }: DepthSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const apply = (x: number, y: number, active: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty("--rx", `${(-y * maxTilt).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(x * maxTilt).toFixed(2)}deg`);
        el.style.setProperty("--mx", `${((x + 1) * 50).toFixed(1)}%`);
        el.style.setProperty("--my", `${((y + 1) * 50).toFixed(1)}%`);
        el.dataset.active = String(active);
      });
    };
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      apply(clamp(((e.clientX - r.left) / r.width) * 2 - 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1), true);
    };
    const onLeave = () => apply(0, 0, false);

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [maxTilt]);

  return (
    <div ref={ref} className={cn("depth-surface", className)} {...props}>
      {children}
    </div>
  );
}
