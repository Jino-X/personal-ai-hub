"use client";

import { useEffect } from "react";

const SELECTOR = '[data-slot="card"]';

/**
 * Lights the card under the pointer: one listener for the whole app writes the pointer's position
 * into that card's --gx/--gy and marks it data-glow, which the card styles in globals.css turn into a
 * spotlight and a lit edge. Positions are set directly, once per frame, so nothing re-renders. Touch
 * and reduced motion get no light.
 */
export function PointerGlow() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const clear = () => {
      if (current) delete current.dataset.glow;
      current = null;
    };

    const update = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const card = e.target instanceof Element ? (e.target.closest(SELECTOR) as HTMLElement | null) : null;
      if (card !== current) {
        clear();
        current = card;
      }
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--gx", `${(e.clientX - r.left).toFixed(0)}px`);
      card.style.setProperty("--gy", `${(e.clientY - r.top).toFixed(0)}px`);
      card.dataset.glow = "";
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onLeave = () => clear();

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      clear();
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return null;
}
