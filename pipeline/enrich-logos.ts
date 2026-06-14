/**
 * Builds a tvg-id / channel-name -> logo URL map from the iptv-org logo
 * database (https://iptv-org.github.io/api/logos.json) so channels missing a
 * logo in their playlist can still render a real branded image.
 *
 * Output: data/logo-map.json  (consumed by merge.ts)
 *
 * Logo selection follows iptv-org best practice: prefer logos marked
 * `in_use`, then raster/SVG formats with a known size, smaller (cleaner)
 * square-ish marks first.
 */
import fs from "node:fs";
import { dataPath } from "./paths";
import { writeJsonFile } from "./utils";

const LOGOS_URL = "https://iptv-org.github.io/api/logos.json";
const CHANNELS_URL = "https://iptv-org.github.io/api/channels.json";

interface LogoEntry {
  channel: string;
  feed?: string | null;
  in_use?: boolean;
  format?: string | null;
  width?: number;
  height?: number;
  url: string;
}

interface ChannelEntry {
  id: string;
  name?: string;
  alt_names?: string[];
}

const PREFERRED_FORMATS = new Set(["PNG", "SVG", "WEBP", "JPEG", "AVIF"]);

function key(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Higher score = better logo for our UI. */
function scoreLogo(l: LogoEntry): number {
  let s = 0;
  if (l.in_use) s += 100;
  if (l.format && PREFERRED_FORMATS.has(l.format.toUpperCase())) s += 20;
  if (l.url.startsWith("https://")) s += 10;
  // prefer reasonably sized marks (not gigantic banners)
  if (l.width && l.width >= 100 && l.width <= 1200) s += 5;
  return s;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "live-tv-pipeline/1.0" },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function runEnrichLogos(): Promise<void> {
  console.log("[logos] Fetching iptv-org logo + channel database...");
  const [logos, channels] = await Promise.all([
    fetchJson<LogoEntry[]>(LOGOS_URL),
    fetchJson<ChannelEntry[]>(CHANNELS_URL).catch(() => [] as ChannelEntry[]),
  ]);

  // pick best logo per channel id
  const best = new Map<string, { url: string; score: number }>();
  for (const l of logos) {
    if (!l.channel || !l.url) continue;
    const sc = scoreLogo(l);
    const cur = best.get(l.channel);
    if (!cur || sc > cur.score) best.set(l.channel, { url: l.url, score: sc });
  }

  // build lookup: key(channelId) -> url, plus key(name)/key(alt) -> url
  const map: Record<string, string> = {};
  const nameById = new Map<string, ChannelEntry>();
  for (const c of channels) nameById.set(c.id, c);

  for (const [channelId, { url }] of best) {
    map[key(channelId)] = url;
    const meta = nameById.get(channelId);
    if (meta?.name) {
      const nk = key(meta.name);
      if (!(nk in map)) map[nk] = url;
    }
    for (const alt of meta?.alt_names ?? []) {
      const ak = key(alt);
      if (!(ak in map)) map[ak] = url;
    }
  }

  fs.mkdirSync(dataPath(), { recursive: true });
  writeJsonFile(dataPath("logo-map.json"), map);
  console.log(
    `[logos] Wrote ${Object.keys(map).length} logo mappings from ${best.size} channels`,
  );
}

if (import.meta.url.startsWith("file:")) {
  const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
  if (
    scriptPath.endsWith("enrich-logos.ts") ||
    scriptPath.endsWith("enrich-logos.js")
  ) {
    runEnrichLogos().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
