"use client";

import { useEffect, useState } from "react";

/**
 * Device classes (research: Compact / Medium / Expanded + TV).
 * Drives device-aware layouts so we never leak mobile controls onto desktop
 * or desktop hover-only interactions onto a TV.
 */
export type DeviceType = "mobile" | "tablet" | "desktop" | "tv";

export interface DeviceInfo {
  type: DeviceType;
  isTouch: boolean;
  isTv: boolean;
  /** width-based class regardless of input (mirrors Tailwind breakpoints) */
  width: "compact" | "medium" | "expanded";
}

const TV_UA = /\b(smart-?tv|smarttv|googletv|appletv|hbbtv|netcast|nettv|webos|tizen|viera|aquos|crkey|bravia|aftt|aftb|aftm|firetv|roku)\b/i;

function detect(): DeviceInfo {
  if (typeof window === "undefined") {
    return { type: "desktop", isTouch: false, isTv: false, width: "expanded" };
  }

  const w = window.innerWidth;
  const ua = navigator.userAgent || "";
  const isTv =
    TV_UA.test(ua) ||
    // large screen + coarse pointer + no hover often means a TV browser
    (w >= 1280 &&
      window.matchMedia?.("(pointer: coarse)").matches === true &&
      window.matchMedia?.("(hover: none)").matches === true);

  const isTouch =
    window.matchMedia?.("(pointer: coarse)").matches === true ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0;

  const width: DeviceInfo["width"] =
    w < 768 ? "compact" : w < 1024 ? "medium" : "expanded";

  let type: DeviceType;
  if (isTv) type = "tv";
  else if (w < 768) type = "mobile";
  else if (w < 1024 && isTouch) type = "tablet";
  else type = "desktop";

  return { type, isTouch, isTv, width };
}

/**
 * SSR-safe: returns a stable desktop default on the server and during the
 * first client render, then updates after mount + on resize. Components that
 * branch on device should treat the first paint as `desktop`/`expanded`.
 */
export function useDevice(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>({
    type: "desktop",
    isTouch: false,
    isTv: false,
    width: "expanded",
  });

  useEffect(() => {
    const update = () => setInfo(detect());
    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return info;
}
