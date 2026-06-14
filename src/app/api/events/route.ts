import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Lightweight, self-hosted analytics. No third party, no cookies, no PII.
 * Events are appended to a local JSONL file (best-effort; ignored on read-only
 * serverless filesystems) and optionally forwarded to the Cloudflare worker.
 *
 * Accepts a single event or a small batch (sendBeacon-friendly).
 */
const EVENTS_PATH = path.join(process.cwd(), "data", "pipeline", "events.jsonl");

const ALLOWED = new Set([
  "channel_play",
  "play_error",
  "source_switch",
  "search",
  "favorite_add",
  "app_open",
]);

interface AnalyticsEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
  ts?: number;
}

function appendEvents(events: AnalyticsEvent[]): void {
  try {
    fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true });
    const lines =
      events
        .map((e) =>
          JSON.stringify({
            name: e.name,
            props: e.props ?? {},
            ts: e.ts ?? Date.now(),
          }),
        )
        .join("\n") + "\n";
    fs.appendFileSync(EVENTS_PATH, lines);
  } catch {
    /* read-only FS — ignore */
  }
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limited = rateLimit(`events:${ip}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  try {
    const body = (await request.json()) as
      | AnalyticsEvent
      | { events: AnalyticsEvent[] };

    const incoming = Array.isArray((body as { events?: unknown }).events)
      ? (body as { events: AnalyticsEvent[] }).events
      : [body as AnalyticsEvent];

    // validate + cap batch size to avoid abuse
    const events = incoming
      .filter((e) => e && typeof e.name === "string" && ALLOWED.has(e.name))
      .slice(0, 20);

    if (events.length === 0) {
      return NextResponse.json({ ok: true, accepted: 0 });
    }

    appendEvents(events);
    return NextResponse.json({ ok: true, accepted: events.length });
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
}
