"use client";

import clsx from "clsx";
import { Radio, Share2, Star } from "lucide-react";
import type { ApiChannel } from "@/lib/types";
import { ChannelLogo } from "./channel-logo";
import { useNowNext, fmtTime, progressOf } from "@/lib/use-epg";

interface ActionProps {
  icon: typeof Star;
  label: string;
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
}

function Action({ icon: Icon, label, onClick, active, activeClass }: ActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        "focusable flex flex-1 flex-col items-center gap-1.5 rounded-2xl py-3 text-xs font-medium transition",
        active
          ? activeClass
          : "bg-white/[0.04] text-fg-muted hover:bg-white/10 hover:text-fg",
      )}
    >
      <Icon className={clsx("h-5 w-5", active && "fill-current")} />
      <span>{label}</span>
    </button>
  );
}

/**
 * Channel info + premium action row (research-standard secondary actions:
 * Favorite / Share, evenly spaced and touch-friendly).
 */
export function NowPlaying({
  channel,
  isFavorite,
  onToggleFavorite,
  onShare,
}: {
  channel: ApiChannel;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onShare: () => void;
}) {
  const guide = useNowNext(channel.id);
  const statusMeta =
    channel.status === "active"
      ? { label: "Live", color: "text-[var(--live)]" }
      : channel.status === "degraded"
        ? { label: "Unstable", color: "text-[var(--degraded)]" }
        : { label: "Offline", color: "text-fg-subtle" };
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-3">
        <ChannelLogo
          name={channel.name}
          logo={channel.logo}
          className="h-14 w-14 shrink-0 ring-1 ring-[var(--border)]"
        />
        <div className="min-w-0 flex-1">
          <div
            className={clsx(
              "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider",
              statusMeta.color,
            )}
          >
            <Radio className="h-3 w-3" />
            {statusMeta.label}
          </div>
          <p className="mt-0.5 truncate text-lg font-bold leading-tight">
            {channel.name}
          </p>
          <p className="truncate text-sm capitalize text-fg-muted">
            {channel.category}
            {channel.isBdix && " · BDIX"}
            {channel.sources.length > 1 &&
              ` · ${channel.sources.length} sources`}
          </p>
        </div>
      </div>

      {guide?.now && (
        <div className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-fg">
              {guide.now.t}
            </p>
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-fg-subtle">
              {fmtTime(guide.now.s)} – {fmtTime(guide.now.e)}
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${Math.round(progressOf(guide.now) * 100)}%` }}
            />
          </div>
          {guide.next && (
            <p className="mt-2 truncate text-xs text-fg-muted">
              <span className="font-medium text-fg-subtle">Next</span>{" "}
              {fmtTime(guide.next.s)} · {guide.next.t}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-stretch gap-2">
        <Action
          icon={Star}
          label={isFavorite ? "Favorited" : "Favorite"}
          onClick={onToggleFavorite}
          active={isFavorite}
          activeClass="bg-[var(--degraded)]/15 text-[var(--degraded)]"
        />
        <Action icon={Share2} label="Share" onClick={onShare} />
      </div>
    </div>
  );
}
