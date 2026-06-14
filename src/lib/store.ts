"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ApiChannel } from "@/lib/types";

export type ThemeMode = "dark" | "oled" | "light";
export type AccentColor = "cyan" | "violet" | "emerald" | "rose" | "amber";
export type ContrastMode = "normal" | "high";
export type LayoutMode = "list" | "grid";
export type SortMode = "reliability" | "latency" | "name" | "recent";

export interface HistoryItem {
  id: string;
  name: string;
  logo?: string;
  category: string;
  watchedAt: number;
}

export interface PlayerPrefs {
  defaultQuality: "auto" | "1080p" | "720p" | "480p";
  autoplay: boolean;
  startMuted: boolean;
  rememberSource: boolean;
}

interface PrefsState {
  theme: ThemeMode;
  accent: AccentColor;
  contrast: ContrastMode;
  layout: LayoutMode;
  sort: SortMode;
  liveOnly: boolean;
  player: PlayerPrefs;

  favorites: string[];
  history: HistoryItem[];
  recentSearches: string[];
  /** channelId -> last working sourceId */
  lastSource: Record<string, string>;

  setTheme: (t: ThemeMode) => void;
  setAccent: (a: AccentColor) => void;
  setContrast: (c: ContrastMode) => void;
  setLayout: (l: LayoutMode) => void;
  setSort: (s: SortMode) => void;
  setLiveOnly: (v: boolean) => void;
  setPlayerPref: <K extends keyof PlayerPrefs>(key: K, value: PlayerPrefs[K]) => void;

  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  pushHistory: (channel: ApiChannel) => void;
  clearHistory: () => void;
  pushRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
  setLastSource: (channelId: string, sourceId: string) => void;
}

const HISTORY_LIMIT = 30;

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      accent: "cyan",
      contrast: "normal",
      layout: "list",
      sort: "reliability",
      liveOnly: false,
      player: {
        defaultQuality: "auto",
        autoplay: true,
        startMuted: false,
        rememberSource: true,
      },

      favorites: [],
      history: [],
      recentSearches: [],
      lastSource: {},

      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setContrast: (contrast) => set({ contrast }),
      setLayout: (layout) => set({ layout }),
      setSort: (sort) => set({ sort }),
      setLiveOnly: (liveOnly) => set({ liveOnly }),
      setPlayerPref: (key, value) =>
        set((s) => ({ player: { ...s.player, [key]: value } })),

      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id)
            ? s.favorites.filter((f) => f !== id)
            : [id, ...s.favorites],
        })),
      isFavorite: (id) => get().favorites.includes(id),

      pushHistory: (channel) =>
        set((s) => {
          const item: HistoryItem = {
            id: channel.id,
            name: channel.name,
            logo: channel.logo,
            category: channel.category,
            watchedAt: Date.now(),
          };
          const rest = s.history.filter((h) => h.id !== channel.id);
          return { history: [item, ...rest].slice(0, HISTORY_LIMIT) };
        }),
      clearHistory: () => set({ history: [] }),

      pushRecentSearch: (q) =>
        set((s) => {
          const term = q.trim();
          if (term.length < 2) return s;
          const rest = s.recentSearches.filter(
            (r) => r.toLowerCase() !== term.toLowerCase(),
          );
          return { recentSearches: [term, ...rest].slice(0, 8) };
        }),
      clearRecentSearches: () => set({ recentSearches: [] }),

      setLastSource: (channelId, sourceId) =>
        set((s) => ({ lastSource: { ...s.lastSource, [channelId]: sourceId } })),
    }),
    {
      name: "live-tv-prefs",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * Returns true only after the component has mounted on the client.
 * Use to gate rendering of persisted-state-dependent UI so the first
 * client render matches the server HTML (prevents hydration mismatch).
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  return mounted;
}
