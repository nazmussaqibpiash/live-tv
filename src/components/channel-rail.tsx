"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ApiChannel } from "@/lib/types";
import { useEpgMap } from "@/lib/use-epg-map";
import { ChannelCard } from "@/components/channel-card";

interface ChannelRailProps {
  label: string;
  channels: ApiChannel[];
  activeId: string | null;
  favorites: string[];
  onSelect: (channel: ApiChannel) => void;
  onToggleFavorite: (id: string) => void;
  onSeeAll?: () => void;
  /** when an outer section already renders the title */
  hideLabel?: boolean;
}

export function ChannelRail({
  label,
  channels,
  activeId,
  favorites,
  onSelect,
  onToggleFavorite,
  onSeeAll,
  hideLabel,
}: ChannelRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const favSet = new Set(favorites);
  const epgMap = useEpgMap(channels.map((c) => c.id));

  const scroll = (dir: number) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  if (!channels.length) return null;

  return (
    <section className="group/rail" aria-label={label || undefined}>
      {!hideLabel && (
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-fg md:text-base">{label}</h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="flex items-center gap-0.5 text-xs font-medium text-accent transition hover:opacity-80"
          >
            View all
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
          className="absolute left-0 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover/rail:opacity-100 md:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          ref={scrollRef}
          className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth pb-1"
        >
          {channels.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              active={activeId === c.id}
              isFavorite={favSet.has(c.id)}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
              nowPlaying={epgMap.get(c.id) ?? null}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => scroll(1)}
          aria-label="Scroll right"
          className="absolute right-0 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover/rail:opacity-100 md:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}
