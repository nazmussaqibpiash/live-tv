"use client";

import clsx from "clsx";
import { Gauge, Zap } from "lucide-react";
import type { ChannelSource } from "@/lib/types";

interface SourceSwitcherProps {
  sources: ChannelSource[];
  activeSourceId: string | null;
  onSelect: (index: number) => void;
}

/** Translate the internal rankScore into a human, user-facing reliability label. */
function healthLabel(score: number): { label: string; tone: string } {
  if (score >= 70) return { label: "Stable", tone: "text-[var(--live)]" };
  if (score >= 40) return { label: "Good", tone: "text-fg-muted" };
  return { label: "Backup", tone: "text-fg-subtle" };
}

export function SourceSwitcher({
  sources,
  activeSourceId,
  onSelect,
}: SourceSwitcherProps) {
  if (sources.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source, index) => {
        const isActive = source.id === activeSourceId;
        const health = healthLabel(source.rankScore);
        return (
          <button
            key={source.id}
            type="button"
            onClick={() => onSelect(index)}
            title={`${health.label} source${source.quality ? ` · ${source.quality}` : ""}`}
            className={clsx(
              "focusable flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              isActive
                ? "bg-[var(--accent-soft)] text-accent ring-1 ring-[var(--accent)]/40"
                : "bg-white/5 text-fg-muted hover:bg-white/10",
            )}
          >
            {source.isPrimary ? (
              <Zap className="h-3 w-3 fill-current" />
            ) : (
              <Gauge className="h-3 w-3" />
            )}
            <span>{source.isPrimary ? "Auto (Best)" : `Backup ${index}`}</span>
            {source.quality && (
              <span className="rounded bg-white/10 px-1 text-[10px] font-semibold">
                {source.quality}
              </span>
            )}
            {!isActive && (
              <span className={clsx("text-[10px]", health.tone)}>
                {health.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
