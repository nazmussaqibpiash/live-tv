"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  ChevronLeft,
  Compass,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Star,
} from "lucide-react";
import type { ApiChannel, CatalogPayload, CategoryInfo } from "@/lib/types";
import { CategoryTabs } from "@/components/category-tabs";
import { ChannelGrid } from "@/components/channel-grid";
import { SourceSwitcher } from "@/components/source-switcher";
import { VideoPlayer } from "@/components/video-player";
import { SettingsPanel } from "@/components/settings-panel";
import { HomeView } from "@/components/home-view";
import { NowPlaying } from "@/components/now-playing";
import { ErrorBanner } from "@/components/error-banner";
import { SearchInput } from "@/components/search-input";
import { usePrefs, useHasMounted } from "@/lib/store";
import { useSpatialNav } from "@/lib/use-spatial-nav";
import { useDevice } from "@/lib/use-device";
import { track } from "@/lib/analytics";
import { toast } from "@/lib/toast";

type MobileTab = "home" | "browse" | "watch";

const PROXY_BASE =
  process.env.NEXT_PUBLIC_HLS_PROXY_URL ?? "/api/hls-proxy";

const PAGE_SIZE = 60;
const CACHE_KEY = "live-tv-catalog-meta";

interface ChannelsResponse {
  channels?: ApiChannel[];
  categories?: CategoryInfo[];
  generatedAt?: string;
  stats?: CatalogPayload["stats"];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
  error?: string;
}

function readMetaCache(): Pick<CatalogPayload, "generatedAt" | "stats" | "categories"> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Pick<CatalogPayload, "generatedAt" | "stats" | "categories">) : null;
  } catch {
    return null;
  }
}

function writeMetaCache(meta: Pick<CatalogPayload, "generatedAt" | "stats" | "categories">) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(meta));
  } catch {
    /* quota exceeded — ignore */
  }
}

function resolveSourceStartIndex(
  channel: ApiChannel,
  rememberSource: boolean,
  lastSource: Record<string, string>,
): number {
  if (!rememberSource || !channel.sources.length) return 0;
  const remembered = lastSource[channel.id];
  if (!remembered) return 0;
  const idx = channel.sources.findIndex((s) => s.id === remembered);
  return idx >= 0 ? idx : 0;
}

function applyChannelSelection(
  channel: ApiChannel,
  rememberSource: boolean,
  lastSource: Record<string, string>,
): { startIndex: number; sourceId: string | null } {
  const startIndex = resolveSourceStartIndex(channel, rememberSource, lastSource);
  return {
    startIndex,
    sourceId: channel.sources[startIndex]?.id ?? null,
  };
}

export function LiveTvApp({ initialChannelId }: { initialChannelId?: string } = {}) {
  const pathname = usePathname();

  // Shallow URL update: switching channels while already in the app shell must
  // NOT trigger a full App Router navigation — `/` and `/watch/[id]` are
  // separate route segments, so router.push() remounts <LiveTvApp> and briefly
  // flashes the home view before the deep-link effect reloads the channel.
  // window.history.pushState updates the URL in place; Next's usePathname()
  // still reflects it, and the browser back/forward effect keeps working.
  const navigateShallow = useCallback(
    (url: string) => {
      if (typeof window !== "undefined" && window.location.pathname !== url) {
        window.history.pushState(null, "", url);
      }
    },
    [],
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>(
    initialChannelId ? "watch" : "home",
  );
  // NOTE: never seed state from sessionStorage during the initial render —
  // it causes SSR/client hydration mismatches. Hydrate after mount instead.
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [channels, setChannels] = useState<ApiChannel[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeChannel, setActiveChannel] = useState<ApiChannel | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalChannels, setTotalChannels] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const favorites = usePrefs((s) => s.favorites);
  const toggleFavorite = usePrefs((s) => s.toggleFavorite);

  const handleToggleFavorite = useCallback(
    (id: string) => {
      const wasFav = favorites.includes(id);
      toggleFavorite(id);
      if (!wasFav) track("favorite_add", { channelId: id });
    },
    [favorites, toggleFavorite],
  );
  const pushHistory = usePrefs((s) => s.pushHistory);
  const pushRecentSearch = usePrefs((s) => s.pushRecentSearch);
  const liveOnly = usePrefs((s) => s.liveOnly);
  const setLiveOnly = usePrefs((s) => s.setLiveOnly);
  const playerPrefs = usePrefs((s) => s.player);
  const lastSource = usePrefs((s) => s.lastSource);
  const setLastSource = usePrefs((s) => s.setLastSource);

  const hasMounted = useHasMounted();
  const device = useDevice();

  // Read latest source-resume prefs without making them effect deps — otherwise
  // selecting a channel (which writes lastSource) would retrigger the URL-sync
  // effect and reload the player mid-playback.
  const sourceResumeRef = useRef({ rememberSource: playerPrefs.rememberSource, lastSource });
  useEffect(() => {
    sourceResumeRef.current = { rememberSource: playerPrefs.rememberSource, lastSource };
  });
  // Treat first paint (and <md widths) as the compact/mobile experience so we
  // never leak desktop hover/sidebar UI onto phones. Desktop = expanded width.
  const isMobile = hasMounted && device.width === "compact";

  // TV remote / keyboard spatial navigation
  useSpatialNav(true);

  // hydrate cached catalog meta AFTER mount (hydration-safe, deferred)
  useEffect(() => {
    const id = setTimeout(() => {
      const cached = readMetaCache();
      if (cached) {
        setCatalog({
          version: "1.0.0",
          generatedAt: cached.generatedAt,
          stats: cached.stats,
          categories: cached.categories,
          channels: [],
        });
        if (cached.categories?.length) setCategories(cached.categories);
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // deep-link: open a specific channel on mount
  useEffect(() => {
    if (!initialChannelId) return;
    let cancelled = false;
    void fetch(`/api/channels?ids=${initialChannelId}`)
      .then((r) => r.json())
      .then((d: { channels?: ApiChannel[] }) => {
        const ch = d.channels?.[0];
        if (cancelled) return;
        if (ch) {
          const { rememberSource, lastSource } = sourceResumeRef.current;
          const { startIndex, sourceId } = applyChannelSelection(
            ch,
            rememberSource,
            lastSource,
          );
          setActiveChannel(ch);
          setSourceIndex(startIndex);
          setActiveSourceId(sourceId);
          setMobileTab("watch");
          setDeepLinkError(null);
          setError(null);
        } else {
          setDeepLinkError("Channel not found or unavailable.");
        }
      })
      .catch(() => {
        if (!cancelled) setDeepLinkError("Could not load this channel.");
      });
    return () => {
      cancelled = true;
    };
  }, [initialChannelId]);

  const exitBrowse = useCallback(() => {
    setActiveCategory("all");
    setSearch("");
    setFavOnly(false);
    setLiveOnly(false);
  }, [setLiveOnly]);

  // keep UI in sync with browser back/forward (/ vs /watch/:id)
  useEffect(() => {
    const match = pathname.match(/^\/watch\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      let cancelled = false;
      const idTimer = setTimeout(() => setMobileTab("watch"), 0);
      if (activeChannel?.id === id) {
        return () => {
          cancelled = true;
          clearTimeout(idTimer);
        };
      }
      void fetch(`/api/channels?ids=${id}`)
        .then((r) => r.json())
        .then((d: { channels?: ApiChannel[] }) => {
          const ch = d.channels?.[0];
          if (!cancelled && ch) {
            const { rememberSource, lastSource } = sourceResumeRef.current;
            const { startIndex, sourceId } = applyChannelSelection(
              ch,
              rememberSource,
              lastSource,
            );
            setActiveChannel(ch);
            setSourceIndex(startIndex);
            setActiveSourceId(sourceId);
            setError(null);
          }
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
        clearTimeout(idTimer);
      };
    }
    if (pathname === "/") {
      const t = setTimeout(
        () => setMobileTab((tab) => (tab === "watch" ? "home" : tab)),
        0,
      );
      return () => clearTimeout(t);
    }
  }, [pathname, activeChannel?.id]);

  // one analytics ping per session load
  useEffect(() => {
    track("app_open");
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const t = search.trim();
      setDebouncedSearch(t);
      if (t.length >= 2) {
        pushRecentSearch(t);
        track("search", { qLen: t.length });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, pushRecentSearch]);

  const fetchPage = useCallback(
    async (category: string, q: string, pageNum: number, append: boolean, live = false, notify = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          limit: String(PAGE_SIZE),
        });
        if (category !== "all") params.set("category", category);
        if (q) params.set("q", q);
        if (live) params.set("status", "active");

        const res = await fetch(`/api/channels?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as ChannelsResponse;

        if (controller.signal.aborted) return;

        if (!res.ok) {
          throw new Error(data.error ?? "Catalog load failed");
        }

        const incoming = data.channels ?? [];
        setChannels((prev) => (append ? [...prev, ...incoming] : incoming));
        setPage(pageNum);
        setTotalPages(data.pagination?.totalPages ?? 1);
        setTotalChannels(data.pagination?.total ?? incoming.length);

        if (data.categories) setCategories(data.categories);
        if (data.generatedAt && data.stats) {
          const meta = {
            version: "1.0.0" as const,
            generatedAt: data.generatedAt,
            stats: data.stats,
            categories: data.categories ?? [],
            channels: [],
          };
          setCatalog(meta);
          writeMetaCache(meta);
        }
        if (!append && notify) toast("Channel list updated", "success");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        if (!append) setChannels([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (favOnly) return;
    const id = setTimeout(() => {
      void fetchPage(
        activeCategory,
        debouncedSearch,
        1,
        false,
        hasMounted && liveOnly,
      );
    }, 0);
    return () => {
      clearTimeout(id);
      abortRef.current?.abort();
    };
  }, [activeCategory, debouncedSearch, fetchPage, favOnly, hasMounted, liveOnly]);

  // favorites: load ALL favorite IDs (not paginated slice)
  useEffect(() => {
    if (!favOnly) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setIsLoading(true);
      setError(null);
      if (favorites.length === 0) {
        setChannels([]);
        setTotalChannels(0);
        setIsLoading(false);
        return;
      }
      void fetch(`/api/channels?ids=${favorites.join(",")}`)
        .then((r) => r.json())
        .then((d: ChannelsResponse) => {
          if (cancelled) return;
          setChannels(d.channels ?? []);
          setTotalChannels(d.channels?.length ?? 0);
          setPage(1);
          setTotalPages(1);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Could not load favorites");
            setChannels([]);
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [favOnly, favorites]);

  const loadMore = useCallback(() => {
    if (favOnly || isLoading || isLoadingMore || page >= totalPages) return;
    void fetchPage(
      activeCategory,
      debouncedSearch,
      page + 1,
      true,
      hasMounted && liveOnly,
    );
  }, [
    activeCategory,
    debouncedSearch,
    fetchPage,
    favOnly,
    hasMounted,
    isLoading,
    isLoadingMore,
    liveOnly,
    page,
    totalPages,
  ]);

  const handleRefresh = useCallback(() => {
    if (favOnly) return;
    void fetchPage(
      activeCategory,
      debouncedSearch,
      1,
      false,
      hasMounted && liveOnly,
      true,
    );
  }, [activeCategory, debouncedSearch, fetchPage, favOnly, hasMounted, liveOnly]);

  const handleSelectChannel = useCallback(
    (channel: ApiChannel) => {
      if (activeChannel?.id === channel.id) {
        setMobileTab("watch");
        setError(null);
        navigateShallow(`/watch/${channel.id}`);
        return;
      }
      const { startIndex, sourceId } = applyChannelSelection(
        channel,
        playerPrefs.rememberSource,
        lastSource,
      );
      setActiveChannel(channel);
      setSourceIndex(startIndex);
      setActiveSourceId(sourceId);
      setMobileTab("watch");
      setError(null);
      setDeepLinkError(null);
      pushHistory(channel);
      track("channel_play", {
        channelId: channel.id,
        category: channel.category,
      });
      navigateShallow(`/watch/${channel.id}`);
    },
    [activeChannel?.id, pushHistory, playerPrefs.rememberSource, lastSource, navigateShallow],
  );

  const visibleChannels = useMemo(() => {
    if (favOnly) return channels;
    if (liveOnly && hasMounted) return channels;
    return channels;
  }, [channels, favOnly, liveOnly, hasMounted]);

  const handleSourceSelect = useCallback(
    (index: number) => {
      if (!activeChannel) return;
      setSourceIndex(index);
      setActiveSourceId(activeChannel.sources[index]?.id ?? null);
      setError(null);
      track("source_switch", { channelId: activeChannel.id, index });
    },
    [activeChannel],
  );

  const handleAllSourcesFailed = useCallback(() => {
    setError(
      "All sources failed for this channel. Try another source or check back later.",
    );
  }, []);

  const handlePlayerSourceChange = useCallback(
    (source: ApiChannel["sources"][number]) => {
      setActiveSourceId(source.id);
      if (playerPrefs.rememberSource && activeChannel) {
        setLastSource(activeChannel.id, source.id);
      }
    },
    [activeChannel, playerPrefs.rememberSource, setLastSource],
  );

  const hasMore = page < totalPages;

  // Three layout modes (research: Netflix/FireTV — home shelves vs full browse
  // vs watch; never duplicate the channel list next to the rails):
  //   watch       -> player on the left + browse sidebar on the right
  //   browse-full -> full-width category/search results grid (with back)
  //   home        -> full-width home rails
  const isFiltering =
    debouncedSearch.trim().length > 0 ||
    activeCategory !== "all" ||
    favOnly ||
    (hasMounted && liveOnly);
  const browseFull = !activeChannel && isFiltering;
  const showSidebar = !!activeChannel;

  const goHome = useCallback(() => {
    exitBrowse();
    setActiveChannel(null);
    setActiveSourceId(null);
    setMobileTab("home");
    navigateShallow("/");
  }, [navigateShallow, exitBrowse]);

  const goBrowse = useCallback(() => {
    setMobileTab("browse");
  }, []);

  const showCategoryBar =
    isFiltering || activeChannel !== null || mobileTab === "browse" || !isMobile;

  const browseTitle = favOnly
    ? "Favorites"
    : debouncedSearch.trim()
      ? `Results for "${debouncedSearch.trim()}"`
      : activeCategory === "bdix"
        ? "BDIX Fast"
        : categories.find((c) => c.id === activeCategory)?.label ??
          (liveOnly ? "Live Now" : "Browse");

  return (
    <div
      data-device={device.type}
      className={clsx(
        "flex min-h-dvh flex-col bg-bg text-fg",
        device.isTv && "tv-mode text-[17px]",
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-[var(--accent-contrast)]"
      >
        Skip to content
      </a>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 md:h-16 md:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] shadow-lg">
              <Sparkles className="h-4 w-4 text-[var(--accent-contrast)]" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight md:text-lg">
                Live TV
              </h1>
              <p className="hidden text-[11px] text-fg-subtle sm:block">
                Live channels · always free
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* persistent top-bar search (desktop) — opens browse on home */}
            <div className="hidden w-44 md:block md:w-52">
              <SearchInput
                value={search}
                onChange={setSearch}
                onSubmit={() => setMobileTab("browse")}
                inputClassName="md:w-full"
              />
            </div>
            {catalog?.stats && (
              <span className="hidden rounded-full bg-white/5 px-3 py-1 text-xs text-fg-muted ring-1 ring-[var(--border)] lg:inline">
                {catalog.stats.activeChannels.toLocaleString()} channels ready
              </span>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-fg-muted transition hover:bg-white/10 hover:text-fg"
              aria-label="Refresh"
            >
              <RefreshCw className={clsx("h-4 w-4", isLoading && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-fg-muted transition hover:bg-white/10 hover:text-fg"
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* category bar — hidden on mobile home for a cleaner landing */}
        {showCategoryBar && categories.length > 0 && (
          <div className="border-t border-[var(--border)]/60">
            <div className="mx-auto w-full max-w-7xl px-3 py-2 md:px-6">
              <CategoryTabs
                categories={categories}
                active={activeCategory}
                onChange={(c) => {
                  setActiveCategory(c);
                  setMobileTab("browse");
                }}
              />
            </div>
          </div>
        )}
      </header>

      <main
        id="main-content"
        className={clsx(
          "mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 p-4 pb-24 md:gap-6 md:p-6 md:pb-6",
          showSidebar
            ? "md:grid-cols-[minmax(0,1fr)_420px] lg:grid-cols-[minmax(0,1fr)_460px]"
            : "md:grid-cols-1",
        )}
      >
        {(error || deepLinkError) && (
          <div className="col-span-full">
            <ErrorBanner
              message={error ?? deepLinkError ?? "Something went wrong"}
              onRetry={error ? handleRefresh : undefined}
              onDismiss={() => {
                setError(null);
                setDeepLinkError(null);
              }}
            />
          </div>
        )}

        <section
          className={clsx(
            "flex flex-col gap-4",
            // mobile: section holds the player (watch) or home rails (home);
            // hidden when the browse grid tab is active
            mobileTab === "browse" && "hidden md:flex",
          )}
        >
          {activeChannel &&
          activeChannel.sources.length > 0 &&
          !(isMobile && mobileTab === "home") ? (
            <>
              {/* mobile: full-bleed immersive hero (break out of main padding) */}
              <div className={clsx(isMobile && "-mx-4 -mt-4")}>
                <VideoPlayer
                  key={`${activeChannel.id}-${sourceIndex}`}
                  channelId={activeChannel.id}
                  sources={activeChannel.sources}
                  title={activeChannel.name}
                  poster={activeChannel.logo}
                  proxyBase={PROXY_BASE}
                  initialSourceIndex={sourceIndex}
                  autoplay={playerPrefs.autoplay}
                  startMuted={playerPrefs.startMuted}
                  defaultQuality={playerPrefs.defaultQuality}
                  channelStatus={activeChannel.status}
                  fullBleed={isMobile}
                  active={!isMobile || mobileTab === "watch"}
                  onAllSourcesFailed={handleAllSourcesFailed}
                  onSourceChange={handlePlayerSourceChange}
                />
              </div>
              <SourceSwitcher
                sources={activeChannel.sources}
                activeSourceId={activeSourceId}
                onSelect={handleSourceSelect}
              />
            </>
          ) : browseFull ? (
            <div className="flex min-h-[60dvh] flex-col gap-4">
              {/* full-width browse header with back to home */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={exitBrowse}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-fg-muted transition hover:bg-white/10 hover:text-fg"
                  aria-label="Back to home"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-bold capitalize">
                    {browseTitle}
                  </h2>
                  {!isLoading && (
                    <p className="text-xs text-fg-subtle">
                      {visibleChannels.length}
                      {totalChannels > visibleChannels.length && !favOnly
                        ? ` of ${totalChannels}`
                        : ""}{" "}
                      channels
                    </p>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <ChannelGrid
                  channels={visibleChannels}
                  activeId={null}
                  onSelect={handleSelectChannel}
                  isLoading={isLoading}
                  isLoadingMore={isLoadingMore && !favOnly && !liveOnly}
                  hasMore={hasMore && !favOnly}
                  onLoadMore={loadMore}
                  favorites={favorites}
                  onToggleFavorite={handleToggleFavorite}
                  searchTerm={debouncedSearch.trim() || undefined}
                  onClearSearch={exitBrowse}
                  emptyHint={
                    favOnly ? "No favorites yet — tap the star on any channel to save it here." : undefined
                  }
                />
              </div>
            </div>
          ) : (
            <HomeView
              activeId={null}
              onSelect={handleSelectChannel}
              onToggleFavorite={handleToggleFavorite}
              onSeeCategory={(cat) => {
                setActiveCategory(cat);
                setMobileTab("browse");
              }}
            />
          )}

          {activeChannel && (!isMobile || mobileTab === "watch") && (
            <NowPlaying
              channel={activeChannel}
              isFavorite={favorites.includes(activeChannel.id)}
              onToggleFavorite={() => handleToggleFavorite(activeChannel.id)}
              onShare={async () => {
                const url = `${window.location.origin}/watch/${activeChannel.id}`;
                try {
                  if (navigator.share) {
                    await navigator.share({ title: activeChannel.name, url });
                    toast("Link shared", "success");
                  } else if (navigator.clipboard) {
                    await navigator.clipboard.writeText(url);
                    toast("Link copied to clipboard", "success");
                  }
                } catch {
                  toast("Could not share link", "error");
                }
              }}
            />
          )}

          {/* mobile: discovery rails below the hero while watching (screenshot pattern) */}
          {activeChannel && isMobile && (
            <div className="mt-2">
              <HomeView
                activeId={activeChannel.id}
                onSelect={handleSelectChannel}
                onToggleFavorite={handleToggleFavorite}
                showSpotlight={false}
                onSeeCategory={(cat) => {
                  setActiveCategory(cat);
                  setMobileTab("browse");
                }}
              />
            </div>
          )}
        </section>

        <aside
          className={clsx(
            "flex min-h-[50dvh] flex-col gap-4 md:max-h-[calc(100dvh-7rem)] md:min-h-0",
            // desktop: browse sidebar only while watching a channel
            // (keeps the clean home screen free of a duplicate channel list)
            !showSidebar && "md:hidden",
            // mobile: browse grid shows only on the browse tab
            mobileTab !== "browse" && "hidden md:flex",
            mobileTab === "browse" && "flex",
          )}
        >
          {/* mobile search — desktop uses the persistent top-bar search */}
          <div className="shrink-0 md:hidden">
            <SearchInput
              value={search}
              onChange={setSearch}
              onSubmit={() => setMobileTab("browse")}
              inputClassName="h-12 rounded-xl pl-10"
            />
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setLiveOnly(!liveOnly)}
              aria-pressed={hasMounted && liveOnly}
              className={clsx(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
                hasMounted && liveOnly
                  ? "bg-[var(--live)]/20 text-[var(--live)] ring-1 ring-[var(--live)]/40"
                  : "bg-white/5 text-fg-muted hover:bg-white/10",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--live)]" />
              Live only
            </button>
            <button
              type="button"
              onClick={() => setFavOnly(!favOnly)}
              aria-pressed={favOnly}
              className={clsx(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
                favOnly
                  ? "bg-[var(--degraded)]/20 text-[var(--degraded)] ring-1 ring-[var(--degraded)]/40"
                  : "bg-white/5 text-fg-muted hover:bg-white/10",
              )}
            >
              <Star className={clsx("h-3 w-3", favOnly && "fill-current")} />
              Favorites {hasMounted && favorites.length > 0 && `(${favorites.length})`}
            </button>
          </div>

          {!isLoading && totalChannels > 0 && !favOnly && (
            <p className="shrink-0 text-xs text-fg-subtle">
              Showing {visibleChannels.length} of {totalChannels} channels
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto scroll-area">
            <ChannelGrid
              channels={visibleChannels}
              activeId={activeChannel?.id ?? null}
              onSelect={handleSelectChannel}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore && !favOnly && !liveOnly}
              hasMore={hasMore && !favOnly}
              onLoadMore={loadMore}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              searchTerm={debouncedSearch.trim() || undefined}
              onClearSearch={exitBrowse}
              emptyHint={
                favOnly ? "No favorites yet — tap the star on any channel to save it here." : undefined
              }
            />
          </div>

          {catalog?.generatedAt && (
            <p className="shrink-0 text-center text-[10px] text-fg-subtle">
              Updated {new Date(catalog.generatedAt).toLocaleString()}
            </p>
          )}
        </aside>
      </main>

      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-bg/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto flex h-16 max-w-lg">
          {[
            {
              id: "home",
              label: "Home",
              icon: Sparkles,
              active: mobileTab === "home" && !isFiltering,
              onClick: goHome,
            },
            {
              id: "browse",
              label: "Browse",
              icon: Compass,
              active: mobileTab === "browse" || isFiltering,
              onClick: goBrowse,
            },
            {
              id: "watch",
              label: "Watch",
              icon: Play,
              active: mobileTab === "watch" && !!activeChannel,
              disabled: !activeChannel,
              onClick: () => activeChannel && setMobileTab("watch"),
            },
          ].map(({ id, label, icon: Icon, active, disabled, onClick }) => (
            <button
              key={id}
              type="button"
              onClick={onClick}
              disabled={disabled}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition disabled:opacity-35",
                active ? "text-accent" : "text-fg-subtle hover:text-fg-muted",
              )}
            >
              <span
                className={clsx(
                  "flex h-8 w-12 items-center justify-center rounded-full transition",
                  active && "bg-[var(--accent-soft)]",
                )}
              >
                <Icon className={clsx("h-5 w-5", active && "fill-current")} />
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
