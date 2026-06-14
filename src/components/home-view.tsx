"use client";

import { useEffect, useState } from "react";
import { History, Star } from "lucide-react";
import type { ApiChannel } from "@/lib/types";
import { usePrefs } from "@/lib/store";
import { ChannelRail } from "@/components/channel-rail";
import { ErrorBanner } from "@/components/error-banner";

interface HomeRail {
  id: string;
  label: string;
  channels: ApiChannel[];
}

interface HomeViewProps {
  activeId: string | null;
  onSelect: (channel: ApiChannel) => void;
  onSeeCategory: (categoryId: string) => void;
  onToggleFavorite?: (id: string) => void;
  /** hide the spotlight hero (e.g. when shown below an active player) */
  showSpotlight?: boolean;
}

async function resolveIds(ids: string[]): Promise<ApiChannel[]> {
  if (!ids.length) return [];
  const res = await fetch(`/api/channels?ids=${ids.join(",")}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { channels?: ApiChannel[] };
  return data.channels ?? [];
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="skeleton h-44 w-full rounded-3xl sm:h-56" />
      <div>
        <div className="skeleton mb-2 h-4 w-32 rounded" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-24 w-36 shrink-0 rounded-xl sm:w-40" />
          ))}
        </div>
      </div>
      <div>
        <div className="skeleton mb-2 h-4 w-40 rounded" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-24 w-36 shrink-0 rounded-xl sm:w-40" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HomeView({
  activeId,
  onSelect,
  onSeeCategory,
  onToggleFavorite,
  showSpotlight = true,
}: HomeViewProps) {
  const favorites = usePrefs((s) => s.favorites);
  const history = usePrefs((s) => s.history);
  const storeToggleFavorite = usePrefs((s) => s.toggleFavorite);
  const toggleFavorite = onToggleFavorite ?? storeToggleFavorite;

  const [rails, setRails] = useState<HomeRail[]>([]);
  const [favChannels, setFavChannels] = useState<ApiChannel[]>([]);
  const [historyChannels, setHistoryChannels] = useState<ApiChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      try {
        const r = await fetch("/api/home");
        const d = (await r.json()) as { rails?: HomeRail[]; error?: string };
        if (!r.ok) throw new Error(d.error ?? "Could not load home content");
        if (!cancelled) setRails(d.rails ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load home content");
          setRails([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveIds(favorites.slice(0, 20)).then(
      (c) => !cancelled && setFavChannels(c),
    );
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  useEffect(() => {
    let cancelled = false;
    const ids = history.map((h) => h.id).slice(0, 20);
    void resolveIds(ids).then((c) => !cancelled && setHistoryChannels(c));
    return () => {
      cancelled = true;
    };
  }, [history]);

  if (loading) return <HomeSkeleton />;

  if (error) {
    return (
      <ErrorBanner
        message={error}
        onRetry={() => {
          setLoading(true);
          void fetch("/api/home")
            .then(async (r) => {
              const d = (await r.json()) as { rails?: HomeRail[]; error?: string };
              if (!r.ok) throw new Error(d.error ?? "Could not load home content");
              setRails(d.rails ?? []);
              setError(null);
            })
            .catch((e) =>
              setError(e instanceof Error ? e.message : "Could not load home content"),
            )
            .finally(() => setLoading(false));
        }}
      />
    );
  }

  const isGoodName = (n: string) => {
    const t = n.trim();
    if (t.length < 3) return false;
    if (/^[\d\s.]+$/.test(t)) return false;
    if (/\b(4k|hdr|test|sd|hd|fhd|uhd)\b/i.test(t) && t.length < 8) return false;
    return /[a-z]/i.test(t);
  };
  const spotlight = showSpotlight
    ? rails
        .flatMap((r) => r.channels)
        .find((c) => c.logo && isGoodName(c.name)) ??
      rails[0]?.channels[0] ??
      null
    : null;

  return (
    <div className="flex flex-col gap-6">
      {spotlight && (
        <button
          type="button"
          onClick={() => onSelect(spotlight)}
          aria-label={`Watch ${spotlight.name}`}
          className="focusable group relative flex h-48 w-full items-end overflow-hidden rounded-3xl text-left sm:h-64"
        >
          {spotlight.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={spotlight.logo}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-tr from-[var(--accent-soft)] via-[var(--bg-card)] to-[var(--bg)]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="relative z-10 flex w-full items-end justify-between gap-4 p-5 sm:p-7">
            <div className="flex min-w-0 items-center gap-4">
              <div className="hidden shrink-0 sm:block">
                <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/15 backdrop-blur-sm">
                  {spotlight.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={spotlight.logo}
                      alt=""
                      className="h-full w-full object-contain p-1.5"
                    />
                  ) : null}
                </span>
              </div>
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--live)]/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--live)]">
                  Featured Live
                </span>
                <h2 className="mt-2 truncate text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                  {spotlight.name}
                </h2>
                <p className="mt-1 truncate text-sm capitalize text-white/70">
                  {spotlight.category}
                  {spotlight.isBdix && " · BDIX"}
                </p>
              </div>
            </div>
            <span className="hidden shrink-0 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black shadow-lg transition group-hover:scale-105 sm:inline">
              Watch now
            </span>
          </div>
        </button>
      )}

      {historyChannels.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 px-1 text-fg-muted">
            <History className="h-4 w-4" />
            <span className="text-sm font-semibold">Continue Watching</span>
          </div>
          <ChannelRail
            label="Continue Watching"
            channels={historyChannels}
            activeId={activeId}
            favorites={favorites}
            onSelect={onSelect}
            onToggleFavorite={toggleFavorite}
            hideLabel
          />
        </div>
      )}

      {favChannels.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 px-1 text-fg-muted">
            <Star className="h-4 w-4 fill-[var(--degraded)] text-[var(--degraded)]" />
            <span className="text-sm font-semibold">Your Favorites</span>
          </div>
          <ChannelRail
            label="Your Favorites"
            channels={favChannels}
            activeId={activeId}
            favorites={favorites}
            onSelect={onSelect}
            onToggleFavorite={toggleFavorite}
            hideLabel
          />
        </div>
      )}

      {rails.map((rail) => (
        <ChannelRail
          key={rail.id}
          label={rail.label}
          channels={rail.channels}
          activeId={activeId}
          favorites={favorites}
          onSelect={onSelect}
          onToggleFavorite={toggleFavorite}
          onSeeAll={
            rail.id !== "live" ? () => onSeeCategory(rail.id) : undefined
          }
        />
      ))}

      {rails.length === 0 && (
        <div className="py-24 text-center text-sm text-fg-subtle">
          No channels available right now. Please try again later.
        </div>
      )}
    </div>
  );
}
