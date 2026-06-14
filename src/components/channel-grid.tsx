"use client";

import { useEffect, useRef } from "react";
import { Loader2, Tv } from "lucide-react";
import type { ApiChannel } from "@/lib/types";
import { useEpgMap } from "@/lib/use-epg-map";
import { ChannelPoster } from "./channel-poster";

interface ChannelGridProps {
  channels: ApiChannel[];
  activeId: string | null;
  onSelect: (channel: ApiChannel) => void;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  favorites?: string[];
  onToggleFavorite?: (id: string) => void;
  searchTerm?: string;
  onClearSearch?: () => void;
  emptyHint?: string;
}

export function ChannelGrid({
  channels,
  activeId,
  onSelect,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  favorites,
  onToggleFavorite,
  searchTerm,
  onClearSearch,
  emptyHint,
}: ChannelGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const epgMap = useEpgMap(channels.map((c) => c.id));
  const favSet = favorites ? new Set(favorites) : null;

  useEffect(() => {
    if (!hasMore || !onLoadMore || isLoading || isLoadingMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, isLoading, isLoadingMore, channels.length]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton aspect-video rounded-2xl" />
        ))}
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Tv className="h-10 w-10 text-fg-subtle" />
        {searchTerm ? (
          <>
            <p className="text-sm text-fg-muted">
              No results for{" "}
              <span className="font-semibold text-fg">&ldquo;{searchTerm}&rdquo;</span>
            </p>
            <p className="max-w-xs text-xs text-fg-subtle">
              Try fewer or different words, or check the spelling.
            </p>
          </>
        ) : (
          <p className="text-sm text-fg-muted">{emptyHint ?? "No channels found"}</p>
        )}
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="mt-1 rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-xs font-semibold text-accent transition hover:opacity-90"
          >
            Clear search &amp; filters
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {channels.map((channel) => (
          <ChannelPoster
            key={channel.id}
            channel={channel}
            variant="grid"
            active={activeId === channel.id}
            isFavorite={favSet?.has(channel.id)}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
            nowPlaying={epgMap.get(channel.id) ?? null}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="h-4" aria-hidden />

      {isLoadingMore && (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-fg-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading more channels…
        </div>
      )}

      {!hasMore && channels.length > 20 && (
        <p className="py-3 text-center text-[10px] text-fg-subtle">All channels loaded</p>
      )}
    </>
  );
}
