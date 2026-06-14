import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function readJsonFile<T>(path: string): T {
  const raw = fs.readFileSync(path, "utf-8");
  return JSON.parse(raw) as T;
}

/**
 * Atomic JSON write: serialize to a temp file in the same directory, then
 * rename over the target. rename() is atomic on the same filesystem, so a
 * concurrent reader (e.g. the API) never observes a half-written file — this
 * prevents the catalog-corruption class of bug seen with plain writeFileSync.
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "channel"
  );
}

export function channelIdFromName(name: string): string {
  return slugify(name);
}

/**
 * Dedup key that folds quality/format variants of the SAME channel together
 * (e.g. "Channel I HD" + "Channel I (1080p)" → one card) while preserving
 * distinct channels that differ by number (e.g. "Star Sports 1" vs "2").
 */
export function channelDedupKey(name: string): string {
  let n = name.toLowerCase();
  // strip bracketed/parenthetical qualifiers: (1080p), [backup], {hd}
  n = n.replace(/[([{][^)\]}]*[)\]}]/g, " ");
  // strip trailing quality / format tokens
  n = n.replace(
    /\b(fhd|uhd|hd|sd|4k|2160p?|1080p?|720p?|480p?|h265|hevc|hq|backup|raw|feed)\b/g,
    " ",
  );
  return slugify(n);
}

export function sourceId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function sanitizeName(name: string): string {
  return name.replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 200);
}

export function detectQuality(name: string, url: string): string | undefined {
  const text = `${name} ${url}`.toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return "2160p";
  if (text.includes("1080") || text.includes("fhd")) return "1080p";
  if (text.includes("720") || text.includes("hd")) return "720p";
  if (text.includes("480") || text.includes("sd")) return "480p";
  return undefined;
}

export function qualityScore(quality?: string): number {
  switch (quality) {
    case "2160p":
      return 1.0;
    case "1080p":
      return 0.95;
    case "720p":
      return 0.75;
    case "480p":
      return 0.5;
    default:
      return 0.6;
  }
}

export function computeRankScore(input: {
  uptime: number;
  playbackSuccess: number;
  latencyMs: number;
  quality?: string;
  lastCheckAgeHours: number;
}): number {
  const latencyScore = Math.max(0, 1 - input.latencyMs / 8000);
  const freshness =
    input.lastCheckAgeHours <= 2
      ? 1
      : Math.max(0, 1 - (input.lastCheckAgeHours - 2) / 22);

  const score =
    input.uptime * 35 +
    input.playbackSuccess * 30 +
    latencyScore * 20 +
    qualityScore(input.quality) * 10 +
    freshness * 5;

  return Math.round(Math.min(100, Math.max(0, score)));
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "LiveTV-Pipeline/1.0",
        Accept: "*/*",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runner(),
    ),
  );
  return results;
}
