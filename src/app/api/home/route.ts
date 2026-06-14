import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getCatalog } from "@/lib/catalog";
import type { ApiChannel, CatalogPayload } from "@/lib/types";

const RAIL_SIZE = 20;
const statusOrder = { active: 0, degraded: 1, offline: 2 } as const;

interface SeasonalEvent {
  id: string;
  label: string;
  active: boolean;
  matchPatterns: string[];
  categoryHint?: string;
}

interface HomeRail {
  id: string;
  label: string;
  channels: ApiChannel[];
}

function loadSeasonal(): SeasonalEvent[] {
  try {
    const p = path.join(process.cwd(), "data", "seasonal-config.json");
    if (!fs.existsSync(p)) return [];
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as {
      events?: SeasonalEvent[];
    };
    return (data.events ?? []).filter((e) => e.active);
  } catch {
    return [];
  }
}

function rankSort(a: ApiChannel, b: ApiChannel): number {
  const sa = statusOrder[a.status] ?? 9;
  const sb = statusOrder[b.status] ?? 9;
  if (sa !== sb) return sa - sb;
  const ra = a.sources[0]?.rankScore ?? 0;
  const rb = b.sources[0]?.rankScore ?? 0;
  return rb - ra;
}

// Rails are derived purely from the catalog; memoize against its identity so we
// don't rebuild every rail (multiple full filters + sorts over ~15k channels)
// on every home request.
const railsCache = new WeakMap<CatalogPayload, HomeRail[]>();

function buildRails(catalog: CatalogPayload): HomeRail[] {
  const cachedRails = railsCache.get(catalog);
  if (cachedRails) return cachedRails;

  const channels = catalog.channels.filter(
    (c) => c.status === "active" || c.status === "degraded",
  );

  const rails: HomeRail[] = [];

  // Seasonal/event rails first (e.g. World Cup) — highest visibility
  for (const ev of loadSeasonal()) {
    const matched = channels
      .filter((c) => {
        const hay = `${c.name} ${c.group ?? ""}`.toLowerCase();
        const inCat = ev.categoryHint ? c.category === ev.categoryHint : true;
        const kw = ev.matchPatterns.some((p) => hay.includes(p.toLowerCase()));
        return inCat && kw;
      })
      .sort(rankSort)
      .slice(0, RAIL_SIZE);
    if (matched.length >= 3) {
      rails.push({ id: `season-${ev.id}`, label: ev.label, channels: matched });
    }
  }

  // BDIX Fast — local high-speed channels
  const bdix = channels
    .filter((c) => c.isBdix && c.status === "active")
    .sort(rankSort)
    .slice(0, RAIL_SIZE);
  if (bdix.length >= 4) {
    rails.push({ id: "bdix", label: "BDIX Fast", channels: bdix });
  }

  // Trending Live — top-ranked active channels (curated, not the full list).
  const live = channels
    .filter((c) => c.status === "active")
    .sort(rankSort)
    .slice(0, RAIL_SIZE);
  if (live.length >= 4) {
    rails.push({ id: "live", label: "Trending Live", channels: live });
  }

  // Top categories only — home is curated, not a dump of every category.
  const MAX_CATEGORY_RAILS = 4;
  const topCats = [...catalog.categories]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, MAX_CATEGORY_RAILS);

  for (const cat of topCats) {
    const list = channels
      .filter((c) => c.category === cat.id)
      .sort(rankSort)
      .slice(0, RAIL_SIZE);
    if (list.length >= 4) {
      rails.push({ id: cat.id, label: cat.label, channels: list });
    }
  }

  railsCache.set(catalog, rails);
  return rails;
}

export async function GET() {
  const catalog = await getCatalog();
  if (!catalog) {
    return NextResponse.json(
      { error: "Catalog not available", rails: [] },
      { status: 503 },
    );
  }

  const rails = buildRails(catalog);

  return NextResponse.json(
    {
      rails,
      categories: catalog.categories,
      generatedAt: catalog.generatedAt,
      stats: catalog.stats,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
