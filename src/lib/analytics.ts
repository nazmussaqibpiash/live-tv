"use client";

/**
 * Lightweight, privacy-friendly client analytics. No cookies, no PII, no third
 * party. Events are batched and flushed via `navigator.sendBeacon` (so they
 * survive page unload) to our own /api/events endpoint.
 */

export type EventName =
  | "channel_play"
  | "play_error"
  | "source_switch"
  | "search"
  | "favorite_add"
  | "app_open";

interface QueuedEvent {
  name: EventName;
  props?: Record<string, string | number | boolean>;
  ts: number;
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(useBeacon = false): void {
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  const payload = JSON.stringify({ events });

  try {
    if (
      useBeacon &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      navigator.sendBeacon(
        "/api/events",
        new Blob([payload], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never let analytics break the app */
  }
}

/** Track a usage event (batched, fire-and-forget). */
export function track(
  name: EventName,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  queue.push({ name, props, ts: Date.now() });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush(false), 2000);
  // safety: flush large batches immediately
  if (queue.length >= 10) flush(false);
}

// flush whatever is queued when the page is hidden / unloaded
if (typeof window !== "undefined") {
  const onHide = () => flush(true);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
  });
}
