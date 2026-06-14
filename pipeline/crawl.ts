import { fetchWithTimeout, readJsonFile, writeJsonFile, slugify } from "./utils";
import { dataPath } from "./paths";
import type { SourceFeed } from "./types";

/**
 * Auto-discovery crawler.
 *
 * Continuously finds NEW public .m3u/.m3u8 playlists and appends the valid,
 * channel-rich ones to data/source-registry.json — so the source pool keeps
 * growing on its own without manual edits.
 *
 * Strategy:
 *  1. GitHub code/repo search (uses GITHUB_TOKEN if available for higher rate)
 *  2. A curated set of well-known aggregator raw URLs as a guaranteed baseline
 *  3. Each candidate is fetched, verified to be a real M3U with enough channels,
 *     deduped against the existing registry, then appended.
 */

const MIN_CHANNELS = 15;
const MAX_NEW_PER_RUN = Number(process.env.CRAWL_MAX_NEW ?? 25);
const CANDIDATE_TIMEOUT = 25000;

// GitHub search queries that surface large, fresh IPTV playlists
const GITHUB_QUERIES = [
  "iptv playlist m3u",
  "bdix iptv m3u",
  "live tv m3u8 playlist",
  "iptv bangladesh m3u",
  "free iptv playlist m3u8",
];

// Always-checked known aggregators (kept fresh by their maintainers)
const KNOWN_CANDIDATES: { name: string; url: string; region: string }[] = [
  {
    name: "iptv-org Index (full)",
    url: "https://iptv-org.github.io/iptv/index.m3u",
    region: "international",
  },
  {
    name: "iptv-org Index by Country",
    url: "https://iptv-org.github.io/iptv/index.country.m3u",
    region: "international",
  },
  {
    name: "Free-TV IPTV",
    url: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",
    region: "international",
  },
];

interface GithubItem {
  full_name?: string;
  default_branch?: string;
  html_url?: string;
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token
    ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
    : { Accept: "application/vnd.github+json" };
}

async function searchGithubRepos(query: string): Promise<string[]> {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
      query,
    )}&sort=updated&per_page=15`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: 20000,
      headers: authHeaders(),
    });
    if (!res.ok) {
      console.warn(`[crawl] github search ${res.status} for "${query}"`);
      return [];
    }
    const data = (await res.json()) as { items?: GithubItem[] };
    const urls: string[] = [];
    for (const item of data.items ?? []) {
      if (!item.full_name) continue;
      const branch = item.default_branch ?? "main";
      // common playlist filenames in these repos
      for (const file of [
        "playlist.m3u",
        "playlist.m3u8",
        "index.m3u",
        "combined-playlist.m3u",
        "iptv.m3u",
        "tv.m3u",
      ]) {
        urls.push(
          `https://raw.githubusercontent.com/${item.full_name}/${branch}/${file}`,
        );
      }
    }
    return urls;
  } catch (err) {
    console.warn(`[crawl] github search failed: ${String(err)}`);
    return [];
  }
}

async function verifyCandidate(url: string): Promise<number> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: CANDIDATE_TIMEOUT });
    if (!res.ok) return 0;
    const text = await res.text();
    if (!text.includes("#EXTINF")) return 0;
    const count = (text.match(/#EXTINF/g) ?? []).length;
    return count;
  } catch {
    return 0;
  }
}

export async function runCrawl(): Promise<number> {
  const registryPath = dataPath("source-registry.json");
  const registry = readJsonFile<SourceFeed[]>(registryPath);
  const existingUrls = new Set(registry.map((f) => f.url));
  const existingIds = new Set(registry.map((f) => f.id));

  // collect candidate URLs
  const candidates = new Map<string, string>(); // url -> region
  for (const c of KNOWN_CANDIDATES) candidates.set(c.url, c.region);

  for (const q of GITHUB_QUERIES) {
    const urls = await searchGithubRepos(q);
    for (const u of urls) candidates.set(u, "international");
  }

  console.log(`[crawl] ${candidates.size} candidate URLs to verify`);

  const added: SourceFeed[] = [];
  for (const [url, region] of candidates) {
    if (added.length >= MAX_NEW_PER_RUN) break;
    if (existingUrls.has(url)) continue;

    const channelCount = await verifyCandidate(url);
    if (channelCount < MIN_CHANNELS) continue;

    // derive a stable id from the url
    const slug = slugify(
      url.replace(/^https?:\/\//, "").replace(/\.(m3u8?|txt)$/i, ""),
    ).slice(0, 50);
    let id = `crawl-${slug}`;
    let n = 1;
    while (existingIds.has(id)) id = `crawl-${slug}-${n++}`;

    const feed: SourceFeed = {
      id,
      name: `Auto: ${url.split("/").slice(3, 5).join("/")}`,
      url,
      type: "m3u",
      region,
      priority: 5,
    };
    added.push(feed);
    existingUrls.add(url);
    existingIds.add(id);
    console.log(`[crawl] + ${id} (${channelCount} channels)`);
  }

  if (added.length > 0) {
    const updated = [...registry, ...added];
    writeJsonFile(registryPath, updated);
    console.log(`[crawl] Added ${added.length} new sources (total ${updated.length})`);
  } else {
    console.log("[crawl] No new valid sources this run");
  }

  return added.length;
}

if (import.meta.url.startsWith("file:")) {
  const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
  if (scriptPath.endsWith("crawl.ts") || scriptPath.endsWith("crawl.js")) {
    runCrawl().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
