import { NextRequest, NextResponse } from "next/server";

/**
 * When a Cloudflare API worker is configured, proxy a frontend API request
 * straight through to it and stream the response body back — WITHOUT buffering
 * the (potentially multi-MB) payload into the frontend worker's memory.
 *
 * Returns `null` when no worker is configured (or the upstream failed), so the
 * caller can fall back to the local-file code path (used in dev / on Vercel).
 */
export async function proxyToWorker(
  request: NextRequest,
  workerPath: string,
): Promise<NextResponse | Response | null> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
  if (!workerUrl) return null;

  const search = request.nextUrl.search; // preserves ?category=&q=&page=&limit=...
  const target = `${workerUrl.replace(/\/$/, "")}${workerPath}${search}`;

  try {
    const upstream = await fetch(target, {
      headers: { Accept: "application/json" },
      // Edge cache for a short window; the data only changes every few hours.
      next: { revalidate: 120 },
    });

    if (!upstream.ok) return null;

    // Stream the body through verbatim (no .json()/.text() buffering).
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ??
          "application/json; charset=utf-8",
        "Cache-Control":
          upstream.headers.get("Cache-Control") ??
          "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch {
    return null;
  }
}
