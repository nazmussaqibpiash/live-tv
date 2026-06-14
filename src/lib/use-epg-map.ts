"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Shared EPG "now" cache + request de-duplication.
 *
 * The home screen renders several rails and the browse grid simultaneously,
 * each needing now-playing titles for overlapping channel ids. Without sharing,
 * every component fires its own /api/epg request (often for the same ids). This
 * module keeps a short-lived per-id cache and coalesces in-flight requests so a
 * given id is fetched at most once per TTL window across the whole app.
 */

const TTL_MS = 60_000;
const MAX_IDS_PER_REQUEST = 40;

interface Entry {
  title: string | null;
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();

function fresh(id: string): boolean {
  const e = cache.get(id);
  return !!e && Date.now() - e.at < TTL_MS;
}

async function fetchBatch(ids: string[]): Promise<void> {
  const key = ids.join(",");
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/epg?ids=${encodeURIComponent(key)}`);
      const json = res.ok ? await res.json() : null;
      const now = Date.now();
      const guide = (json?.guide ?? {}) as Record<
        string,
        { now?: { t: string } | null }
      >;
      for (const id of ids) {
        cache.set(id, { title: guide[id]?.now?.t ?? null, at: now });
      }
    } catch {
      // leave cache untouched; a later render can retry
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** channelId -> current program title (if guide data exists) */
export function useEpgMap(channelIds: string[]): Map<string, string> {
  const [version, force] = useState(0);

  const ids = useMemo(
    () => [...new Set(channelIds)].filter(Boolean).slice(0, MAX_IDS_PER_REQUEST),
    [channelIds],
  );
  const idsKey = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) return;
    const missing = ids.filter((id) => !fresh(id));
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchBatch(missing).then(() => {
      if (!cancelled) force((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // idsKey captures the id set; ids.length avoids the empty-array edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const id of ids) {
      const title = cache.get(id)?.title;
      if (title) map.set(id, title);
    }
    return map;
    // `version` re-reads the shared cache after an async fetch resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, version]);
}
