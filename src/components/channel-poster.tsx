"use client";

import { memo } from "react";
import clsx from "clsx";
import { Play, Star } from "lucide-react";
import type { ApiChannel } from "@/lib/types";
import { ChannelLogo } from "./channel-logo";

function statusColor(status: ApiChannel["status"]): string {
  if (status === "active") return "bg-[var(--live)]";
  if (status === "degraded") return "bg-[var(--degraded)]";
  return "bg-[var(--offline)]";
}

function statusLabel(status: ApiChannel["status"]): string {
  if (status === "active") return "Live";
  if (status === "degraded") return "Unstable";
  return "Offline";
}

export interface ChannelPosterProps {
  channel: ApiChannel;
  active?: boolean;
  isFavorite?: boolean;
  onSelect: (channel: ApiChannel) => void;
  onToggleFavorite?: (id: string) => void;
  /** compact = rail card; grid = browse poster with meta block */
  variant?: "rail" | "grid";
  /** optional now-playing title from EPG */
  nowPlaying?: string | null;
}

export function ChannelPoster(props: ChannelPosterProps) {
  return <ChannelPosterInner {...props} />;
}

/**
 * Unified channel card visual — same badges, typography, and interaction
 * patterns for home rails and browse grid.
 */
function ChannelPosterImpl({
  channel,
  active,
  isFavorite,
  onSelect,
  onToggleFavorite,
  variant = "rail",
  nowPlaying,
}: ChannelPosterProps) {
  const quality = channel.sources[0]?.quality;
  const isGrid = variant === "grid";

  return (
    <div
      className={clsx(
        "focusable group relative",
        isGrid ? "overflow-hidden rounded-2xl border" : "w-36 shrink-0 sm:w-40 rounded-xl",
        isGrid &&
          (active
            ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]"),
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(channel)}
        aria-label={`Watch ${channel.name}`}
        className={clsx("block w-full text-left", !isGrid && "w-full")}
      >
        <div
          className={clsx(
            "relative aspect-video w-full bg-[var(--bg)]",
            !isGrid &&
              clsx(
                "overflow-hidden rounded-xl border transition",
                active
                  ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg-card)] group-hover:border-[var(--border-strong)]",
              ),
          )}
        >
          <ChannelLogo
            name={channel.name}
            logo={channel.logo}
            rounded="rounded-none"
            className="h-full w-full"
          />

          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Play
              className={clsx(
                "fill-white text-white",
                isGrid ? "h-9 w-9" : "h-8 w-8",
              )}
            />
          </span>

          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                statusColor(channel.status),
                channel.status === "active" && "animate-pulse",
              )}
            />
            {statusLabel(channel.status)}
          </span>

          {quality && (
            <span className="absolute right-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              {quality}
            </span>
          )}
        </div>

        {isGrid ? (
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold text-fg">{channel.name}</p>
            <p className="truncate text-[11px] text-fg-subtle">
              <span className="capitalize">{channel.category}</span>
              {channel.isBdix && (
                <span className="text-[var(--degraded)]"> · BDIX</span>
              )}
              {channel.sources.length > 1 && ` · ${channel.sources.length} sources`}
            </p>
            {nowPlaying && (
              <p className="mt-0.5 truncate text-[10px] text-fg-muted">
                Now: {nowPlaying}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-1.5 px-0.5">
            <p className="truncate text-xs font-medium text-fg">{channel.name}</p>
            {nowPlaying && (
              <p className="truncate text-[10px] text-fg-subtle">Now: {nowPlaying}</p>
            )}
          </div>
        )}
      </button>

      {onToggleFavorite && (
        <button
          type="button"
          onClick={() => onToggleFavorite(channel.id)}
          aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
          aria-pressed={isFavorite}
          className={clsx(
            "absolute flex items-center justify-center backdrop-blur-sm transition",
            isGrid
              ? "bottom-2 right-2 h-8 w-8 rounded-full bg-black/40"
              : "right-1.5 top-1.5 h-7 w-7 rounded-lg bg-black/50",
            isFavorite
              ? "text-[var(--degraded)] opacity-100"
              : clsx(
                  "text-white opacity-80",
                  isGrid
                    ? "opacity-80 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
                    : "md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100",
                ),
          )}
        >
          <Star
            className={clsx(
              isGrid ? "h-4 w-4" : "h-3.5 w-3.5",
              isFavorite && "fill-current",
            )}
          />
        </button>
      )}
    </div>
  );
}

// Memoized so a parent re-render (e.g. EPG map update or favorites change) only
// re-renders the cards whose props actually changed — important for the 60+
// card browse grid and multiple home rails.
const ChannelPosterInner = memo(ChannelPosterImpl);

