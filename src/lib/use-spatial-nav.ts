"use client";

import { useEffect } from "react";

/**
 * Lightweight spatial (D-pad) navigation for TV browsers & keyboard users.
 * Works on any element carrying the `.focusable` class — no per-component
 * wiring required. Uses geometric nearest-neighbor in the pressed direction.
 *
 * - Arrow keys move focus to the nearest focusable in that direction
 * - Enter/OK activates (native button click)
 * - Auto-scrolls the focused element into view
 * - Adds `tv-mode` class to <html> when remote-style navigation is detected
 */
export function useSpatialNav(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const root = document.documentElement;

    const getFocusables = (): HTMLElement[] =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".focusable, button:not([disabled]), a[href], input, select, [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.offsetParent !== null;
      });

    const center = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const findNext = (
      current: HTMLElement,
      dir: "up" | "down" | "left" | "right",
    ): HTMLElement | null => {
      const cands = getFocusables().filter((el) => el !== current);
      const c = center(current);
      let best: HTMLElement | null = null;
      let bestDist = Infinity;

      for (const el of cands) {
        const p = center(el);
        const dx = p.x - c.x;
        const dy = p.y - c.y;

        const valid =
          (dir === "up" && dy < -4) ||
          (dir === "down" && dy > 4) ||
          (dir === "left" && dx < -4) ||
          (dir === "right" && dx > 4);
        if (!valid) continue;

        // primary axis distance + penalized cross-axis drift
        const primary =
          dir === "up" || dir === "down" ? Math.abs(dy) : Math.abs(dx);
        const cross =
          dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
        const dist = primary + cross * 2;

        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      return best;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const isArrow =
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "ArrowLeft" ||
        key === "ArrowRight";
      if (!isArrow) return;

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      // let inputs/sliders/selects handle their own arrows
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        active?.getAttribute("role") === "slider"
      ) {
        return;
      }

      root.classList.add("tv-mode");

      const focusables = getFocusables();
      if (!focusables.length) return;

      const current =
        active && focusables.includes(active) ? active : focusables[0];

      const dir =
        key === "ArrowUp"
          ? "up"
          : key === "ArrowDown"
            ? "down"
            : key === "ArrowLeft"
              ? "left"
              : "right";

      const next = findNext(current, dir);
      if (next) {
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    };

    // switch off tv-mode when the mouse is used (pointer mode)
    const onPointer = () => root.classList.remove("tv-mode");

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onPointer, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onPointer);
    };
  }, [enabled]);
}
