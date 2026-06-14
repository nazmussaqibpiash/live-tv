"use client";

import { useEffect, useState } from "react";

export interface NowNextProgram {
  t: string;
  s: number;
  e: number;
}

export interface NowNext {
  now: NowNextProgram | null;
  next: NowNextProgram | null;
}

/**
 * Fetches now/next guide info for a single channel. Returns null while loading
 * or when the channel has no guide data (caller hides the block gracefully).
 */
export function useNowNext(channelId: string | null | undefined): NowNext | null {
  // store the channelId alongside the data so a stale response for a previously
  // selected channel is never shown for the current one.
  const [state, setState] = useState<{ id: string; data: NowNext | null } | null>(
    null,
  );

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    fetch(`/api/epg?ids=${encodeURIComponent(channelId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setState({ id: channelId, data: json?.guide?.[channelId] ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ id: channelId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return state && state.id === channelId ? state.data : null;
}

/** "8:30 PM" style time label */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** progress 0..1 of the currently airing program */
export function progressOf(p: NowNextProgram, at = Date.now()): number {
  if (at <= p.s) return 0;
  if (at >= p.e) return 1;
  return (at - p.s) / (p.e - p.s);
}
