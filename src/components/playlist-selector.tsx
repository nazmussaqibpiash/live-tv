"use client";

import clsx from "clsx";
import { Globe, Link2, Zap } from "lucide-react";
import type { CuratedPlaylist, PlaylistCategory } from "@/lib/types";

interface PlaylistSelectorProps {
  playlists: CuratedPlaylist[];
  activePlaylistUrl: string | null;
  customUrl: string;
  onCustomUrlChange: (url: string) => void;
  onSelect: (url: string) => void;
  onLoadCustom: () => void;
  isLoading?: boolean;
}

const categoryMeta: Record<
  PlaylistCategory,
  { label: string; icon: typeof Zap; accent: string }
> = {
  bdix: {
    label: "BDIX",
    icon: Zap,
    accent: "from-amber-500/20 to-orange-500/10 border-amber-500/30",
  },
  international: {
    label: "International",
    icon: Globe,
    accent: "from-cyan-500/20 to-blue-500/10 border-cyan-500/30",
  },
  custom: {
    label: "Custom",
    icon: Link2,
    accent: "from-violet-500/20 to-purple-500/10 border-violet-500/30",
  },
};

export function PlaylistSelector({
  playlists,
  activePlaylistUrl,
  customUrl,
  onCustomUrlChange,
  onSelect,
  onLoadCustom,
  isLoading,
}: PlaylistSelectorProps) {
  const bdix = playlists.filter((p) => p.category === "bdix");
  const international = playlists.filter((p) => p.category === "international");

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <Link2 className="h-3.5 w-3.5" />
          Custom M3U URL
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={customUrl}
            onChange={(e) => onCustomUrlChange(e.target.value)}
            placeholder="https://example.com/playlist.m3u"
            className="h-12 flex-1 rounded-xl border border-white/10 bg-zinc-900/80 px-4 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
          />
          <button
            type="button"
            disabled={isLoading || !customUrl.trim()}
            onClick={onLoadCustom}
            className="h-12 shrink-0 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Load
          </button>
        </div>
      </section>

      <PlaylistGroup
        title="BDIX Playlists"
        category="bdix"
        items={bdix}
        activeUrl={activePlaylistUrl}
        onSelect={onSelect}
        isLoading={isLoading}
      />

      <PlaylistGroup
        title="International"
        category="international"
        items={international}
        activeUrl={activePlaylistUrl}
        onSelect={onSelect}
        isLoading={isLoading}
      />
    </div>
  );
}

function PlaylistGroup({
  title,
  category,
  items,
  activeUrl,
  onSelect,
  isLoading,
}: {
  title: string;
  category: PlaylistCategory;
  items: CuratedPlaylist[];
  activeUrl: string | null;
  onSelect: (url: string) => void;
  isLoading?: boolean;
}) {
  const meta = categoryMeta[category];
  const Icon = meta.icon;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h2>
      <ul className="space-y-2">
        {items.map((playlist) => {
          const isActive = activeUrl === playlist.url;
          return (
            <li key={playlist.id}>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onSelect(playlist.url)}
                className={clsx(
                  "w-full rounded-2xl border bg-gradient-to-br p-4 text-left transition disabled:opacity-50",
                  meta.accent,
                  isActive
                    ? "ring-2 ring-cyan-400/60"
                    : "hover:brightness-110",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-white">{playlist.name}</p>
                  {isActive && (
                    <span className="shrink-0 rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-300">
                      Live
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  {playlist.description}
                </p>
                <p className="mt-2 text-[10px] text-zinc-600">
                  Updated {playlist.updated}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
