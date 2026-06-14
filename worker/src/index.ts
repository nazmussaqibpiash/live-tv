import type { ApiChannel, CatalogPayload, CategoryInfo } from "../../pipeline/types";
import { isBlockedProxyTarget, isManifestUrl, rewriteM3u8 } from "./hls-proxy";

export interface Env {
  CATALOG: KVNamespace;
  DB?: D1Database;
  ALLOWED_ORIGINS?: string;
  HLS_PROXY_ENABLED?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function cors(origin: string | null, allowed?: string): HeadersInit {
  const list = (allowed ?? "*").split(",").map((s) => s.trim());
  const allow =
    !origin || list.includes("*") || list.includes(origin)
      ? origin ?? "*"
      : list[0];
  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Origin": allow,
  };
}

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...extraHeaders,
    },
  });
}

async function loadCatalog(env: Env): Promise<CatalogPayload | null> {
  const cached = await env.CATALOG.get("catalog:v1");
  if (cached) return JSON.parse(cached) as CatalogPayload;
  return null;
}

interface EpgProgram {
  t: string;
  s: number;
  e: number;
}
interface EpgPayload {
  updatedAt: string;
  programs: Record<string, EpgProgram[]>;
}

async function loadEpg(env: Env): Promise<EpgPayload | null> {
  const cached = await env.CATALOG.get("epg:v1");
  if (cached) return JSON.parse(cached) as EpgPayload;
  return null;
}

function nowNext(
  list: EpgProgram[] | undefined,
  at: number,
): { now: EpgProgram | null; next: EpgProgram | null } | null {
  if (!list || list.length === 0) return null;
  let now: EpgProgram | null = null;
  let next: EpgProgram | null = null;
  for (const p of list) {
    if (p.s <= at && at < p.e) now = p;
    else if (p.s > at && (!next || p.s < next.s)) next = p;
  }
  if (!now && !next) return null;
  return { now, next };
}

/** subsequence match for light typo/abbrev tolerance */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** relevance score (must stay in sync with src/lib/catalog.ts searchScore) */
function searchScore(term: string, name: string, group?: string): number {
  const n = name.toLowerCase();
  const g = group?.toLowerCase() ?? "";
  if (n === term) return 100;
  if (n.startsWith(term)) return 85;
  if (new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n))
    return 70;
  if (n.includes(term)) return 55;
  if (g.includes(term)) return 40;
  if (term.length >= 4 && isSubsequence(term, n)) return 25;
  return 0;
}

function filterCatalog(
  catalog: CatalogPayload,
  params: URLSearchParams,
): { categories: CategoryInfo[]; channels: ApiChannel[] } {
  const category = params.get("category");
  const q = params.get("q")?.toLowerCase().trim();
  const status = params.get("status") ?? "active,degraded";

  const allowedStatus = new Set(status.split(",").map((s) => s.trim()));

  let channels = catalog.channels.filter((c) => allowedStatus.has(c.status));

  if (category === "bdix") {
    channels = channels.filter((c) => c.isBdix);
  } else if (category && category !== "all") {
    channels = channels.filter((c) => c.category === category);
  }

  if (q) {
    const scored = channels
      .map((c) => ({ c, s: searchScore(q, c.name, c.group) }))
      .filter((x) => x.s > 0);
    scored.sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      return (b.c.sources[0]?.rankScore ?? 0) - (a.c.sources[0]?.rankScore ?? 0);
    });
    channels = scored.map((x) => x.c);
  }

  return { categories: catalog.categories, channels };
}

async function handleHlsProxy(request: Request, env: Env): Promise<Response> {
  if (env.HLS_PROXY_ENABLED !== "true") {
    return json({ error: "HLS proxy disabled" }, 403);
  }

  const url = new URL(request.url).searchParams.get("url");
  if (!url || isBlockedProxyTarget(url)) {
    return json({ error: "Valid url parameter required" }, 400);
  }

  try {
    const target = new URL(url);

    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          request.headers.get("User-Agent") ??
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: request.headers.get("Referer") ?? target.origin,
      },
    });

    if (!upstream.ok) {
      return json({ error: `Upstream HTTP ${upstream.status}` }, 502);
    }

    const contentType =
      upstream.headers.get("Content-Type") ?? "application/vnd.apple.mpegurl";

    if (isManifestUrl(url, contentType)) {
      const text = await upstream.text();
      const origin = new URL(request.url).origin;
      const rewritten = rewriteM3u8(text, url, origin);
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store",
        },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return json({ error: "Proxy fetch failed" }, 502);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const corsHeaders = cors(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (url.pathname === "/api/health") {
        const meta = await env.CATALOG.get("meta:v1");
        return json(
          {
            ok: true,
            service: "live-tv-worker",
            meta: meta ? JSON.parse(meta) : null,
          },
          200,
          corsHeaders,
        );
      }

      if (url.pathname === "/api/hls-proxy" && request.method === "GET") {
        const res = await handleHlsProxy(request, env);
        return res;
      }

      if (url.pathname === "/api/epg" && request.method === "GET") {
        const epg = await loadEpg(env);
        if (!epg) {
          return json({ updatedAt: null, guide: {} }, 200, corsHeaders);
        }
        const at = Date.now();
        const idsParam = url.searchParams.get("ids");
        const ids = idsParam
          ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
          : Object.keys(epg.programs);
        const guide: Record<string, ReturnType<typeof nowNext>> = {};
        for (const id of ids) {
          const nn = nowNext(epg.programs[id], at);
          if (nn) guide[id] = nn;
        }
        return json({ updatedAt: epg.updatedAt, guide }, 200, {
          ...corsHeaders,
          "Cache-Control": "public, max-age=60, s-maxage=300",
        });
      }

      if (url.pathname === "/api/report" && request.method === "POST") {
        const body = (await request.json()) as {
          sourceId?: string;
          channelId?: string;
          error?: string;
        };
        console.log("[report]", JSON.stringify(body));
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/events" && request.method === "POST") {
        // self-hosted analytics: log to worker observability (no PII)
        const body = (await request.json().catch(() => null)) as {
          events?: unknown[];
        } | null;
        const events = Array.isArray(body?.events) ? body.events : [];
        if (events.length > 0) console.log("[events]", JSON.stringify(events).slice(0, 2000));
        return json({ ok: true, accepted: events.length }, 200, corsHeaders);
      }

      const catalog = await loadCatalog(env);
      if (!catalog) {
        return json(
          { error: "Catalog not loaded. Run pipeline and publish to KV." },
          503,
          corsHeaders,
        );
      }

      if (url.pathname === "/api/categories") {
        return json({ categories: catalog.categories, stats: catalog.stats }, 200, {
          ...corsHeaders,
          "Cache-Control": "public, max-age=600",
        });
      }

      if (url.pathname === "/api/channels") {
        const filtered = filterCatalog(catalog, url.searchParams);
        return json(
          {
            ...filtered,
            generatedAt: catalog.generatedAt,
            stats: catalog.stats,
          },
          200,
          corsHeaders,
        );
      }

      const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
      if (channelMatch) {
        const id = decodeURIComponent(channelMatch[1]);
        const channel = catalog.channels.find((c) => c.id === id);
        if (!channel) {
          return json({ error: "Channel not found" }, 404, corsHeaders);
        }
        return json({ channel }, 200, corsHeaders);
      }

      return json({ error: "Not found" }, 404, corsHeaders);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal server error" }, 500, corsHeaders);
    }
  },
};

export default worker;
