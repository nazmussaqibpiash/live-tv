"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { subscribeToasts, type ToastItem } from "@/lib/toast";

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 left-1/2 z-[120] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 md:bottom-6"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "rounded-xl px-4 py-2.5 text-center text-sm font-medium shadow-lg backdrop-blur-md",
            t.kind === "success" && "bg-[var(--live)]/90 text-black",
            t.kind === "error" && "bg-[var(--offline)]/90 text-white",
            t.kind === "info" && "bg-[var(--bg-elevated)]/95 text-fg ring-1 ring-[var(--border)]",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
