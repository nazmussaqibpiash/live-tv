"use client";

import { useState } from "react";
import clsx from "clsx";

/**
 * Canonical avatar fallback chain (industry standard):
 *   image -> initials -> icon
 * A logo is shown when present and loads; otherwise we render a deterministic
 * branded initials tile so a card is never blank or broken.
 */

// pleasant, high-contrast gradient pairs for initials tiles
const PALETTE: [string, string][] = [
  ["#0ea5e9", "#2563eb"],
  ["#8b5cf6", "#6d28d9"],
  ["#10b981", "#059669"],
  ["#f43f5e", "#be123c"],
  ["#f59e0b", "#d97706"],
  ["#06b6d4", "#0891b2"],
  ["#ec4899", "#db2777"],
  ["#14b8a6", "#0d9488"],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "TV";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ChannelLogo({
  name,
  logo,
  className,
  rounded = "rounded-xl",
}: {
  name: string;
  logo?: string | null;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImg = logo && !failed;

  if (showImg) {
    return (
      <div
        className={clsx(
          "flex items-center justify-center overflow-hidden bg-white/5",
          rounded,
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt={name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }

  const [c1, c2] = PALETTE[hash(name) % PALETTE.length];
  return (
    <div
      role="img"
      aria-label={name}
      className={clsx(
        "flex items-center justify-center font-bold tracking-tight text-white/95",
        rounded,
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      <span className="select-none text-[42%] leading-none drop-shadow-sm">
        {initials(name)}
      </span>
    </div>
  );
}
