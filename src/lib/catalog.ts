import fs from "node:fs";
import path from "node:path";
import type { ApiChannel, CatalogPayload } from "./types";

const CATALOG_PATH = path.join(process.cwd(), "public", "data", "catalog.json");

// in-memory cache keyed by file mtime — avoids re-parsing 15MB JSON per request
let cached: { mtimeMs: number; catalog: CatalogPayload } | null = null;

/**
 * Derived indexes computed once per catalog load (keyed by object identity).
 * Building these on every request would mean filtering + sorting ~15k channels
 * per API hit; instead we memoize against the parsed catalog reference.
 */
interface CatalogIndex {
  byId: Map<string, ApiChannel>;
  /** active + degraded, pre-sorted by status → rank → name (default list order) */
  visibleSorted: ApiChannel[];
}

const indexCache = new WeakMap<CatalogPayload, CatalogIndex>();

function rankSortCmp(a: ApiChannel, b: ApiChannel): number {
  const order = { active: 0, degraded: 1, offline: 2 } as const;
  const sa = order[a.status] ?? 9;
  const sb = order[b.status] ?? 9;
  if (sa !== sb) return sa - sb;
  const scoreA = a.sources[0]?.rankScore ?? 0;
  const scoreB = b.sources[0]?.rankScore ?? 0;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return a.name.localeCompare(b.name);
}

export function getCatalogIndex(catalog: CatalogPayload): CatalogIndex {
  const existing = indexCache.get(catalog);
  if (existing) return existing;
  const byId = new Map<string, ApiChannel>();
  for (const c of catalog.channels) byId.set(c.id, c);
  const visibleSorted = catalog.channels
    .filter((c) => c.status === "active" || c.status === "degraded")
    .sort(rankSortCmp);
  const index: CatalogIndex = { byId, visibleSorted };
  indexCache.set(catalog, index);
  return index;
}

export function loadLocalCatalog(): CatalogPayload | null {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return null;
    const stat = fs.statSync(CATALOG_PATH);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.catalog;
    }
    const raw = fs.readFileSync(CATALOG_PATH, "utf-8");
    if (!raw.trim()) return cached?.catalog ?? null;
    const catalog = JSON.parse(raw) as CatalogPayload;
    cached = { mtimeMs: stat.mtimeMs, catalog };
    return catalog;
  } catch {
    return cached?.catalog ?? null;
  }
}

export async function loadRemoteCatalog(
  baseUrl: string,
): Promise<CatalogPayload | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/api/channels?status=active,degraded`;
    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      channels: CatalogPayload["channels"];
      categories: CatalogPayload["categories"];
      generatedAt?: string;
      stats?: CatalogPayload["stats"];
    };
    return {
      version: "1.0.0",
      generatedAt: data.generatedAt ?? new Date().toISOString(),
      stats: data.stats ?? {
        totalChannels: data.channels.length,
        activeChannels: data.channels.filter((c) => c.status === "active")
          .length,
        degradedChannels: data.channels.filter((c) => c.status === "degraded")
          .length,
        totalSources: 0,
        validatedSources: 0,
      },
      categories: data.categories,
      channels: data.channels,
    };
  } catch {
    return null;
  }
}

export async function getCatalog(): Promise<CatalogPayload | null> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
  if (workerUrl) {
    const remote = await loadRemoteCatalog(workerUrl);
    if (remote && remote.channels.length > 0) return remote;
  }
  return loadLocalCatalog();
}

/** subsequence match for light typo/abbrev tolerance ("hbosp" -> "HBO Sports") */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/**
 * Relevance score for a search term against a channel name/group.
 * exact > starts-with > word-boundary > contains > subsequence (fuzzy).
 * Returns 0 when there's no match at all.
 */
function searchScore(term: string, name: string, group?: string): number {
  const n = name.toLowerCase();
  const g = group?.toLowerCase() ?? "";
  if (n === term) return 100;
  if (n.startsWith(term)) return 85;
  // word-boundary start (e.g. "sports" matches "Star Sports")
  if (new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n))
    return 70;
  if (n.includes(term)) return 55;
  if (g.includes(term)) return 40;
  // fuzzy (subsequence) only when term is reasonably long, to avoid noise
  if (term.length >= 4 && isSubsequence(term, n)) return 25;
  return 0;
}

export function filterCatalog(
  catalog: CatalogPayload,
  category?: string | null,
  q?: string | null,
): CatalogPayload["channels"] {
  const { visibleSorted } = getCatalogIndex(catalog);
  const term = q?.trim().toLowerCase();

  // Fast path: no category + no search → return the pre-sorted visible list
  // (already status → rank → name ordered, computed once per catalog).
  if ((!category || category === "all") && !term) {
    return visibleSorted;
  }

  let channels = visibleSorted;

  if (category === "bdix") {
    channels = channels.filter((c) => c.isBdix);
  } else if (category && category !== "all") {
    channels = channels.filter((c) => c.category === category);
  }

  if (term) {
    // score, drop non-matches, then sort by relevance (then existing rank)
    const scored = channels
      .map((c) => ({ c, s: searchScore(term, c.name, c.group) }))
      .filter((x) => x.s > 0);
    scored.sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      const ra = a.c.sources[0]?.rankScore ?? 0;
      const rb = b.c.sources[0]?.rankScore ?? 0;
      return rb - ra;
    });
    return scored.map((x) => x.c);
  }

  return channels;
}
