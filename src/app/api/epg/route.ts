import { NextRequest, NextResponse } from "next/server";
import { loadEpg, nowNext } from "@/lib/epg";

/**
 * GET /api/epg?ids=a,b,c
 * Returns now/next program info for the requested channel ids. Channels with no
 * guide data are simply omitted, so the client can degrade gracefully.
 *
 * When a Cloudflare worker is configured, proxy to it so edge + local serve the
 * same guide data.
 */
export async function GET(request: NextRequest) {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
  if (workerUrl) {
    try {
      const idsParam = request.nextUrl.searchParams.get("ids");
      const qs = idsParam ? `?ids=${encodeURIComponent(idsParam)}` : "";
      const res = await fetch(`${workerUrl.replace(/\/$/, "")}/api/epg${qs}`, {
        next: { revalidate: 60 },
      });
      if (res.ok) {
        return NextResponse.json(await res.json(), {
          headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
        });
      }
    } catch {
      // fall through to local
    }
  }

  const epg = loadEpg();
  if (!epg) {
    return NextResponse.json({ updatedAt: null, guide: {} });
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  const at = Date.now();
  const guide: Record<
    string,
    { now: { t: string; s: number; e: number } | null; next: { t: string; s: number; e: number } | null }
  > = {};

  const ids = idsParam
    ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : Object.keys(epg.programs);

  for (const id of ids) {
    const nn = nowNext(epg, id, at);
    if (nn && (nn.now || nn.next)) guide[id] = nn;
  }

  return NextResponse.json(
    { updatedAt: epg.updatedAt, guide },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
  );
}
