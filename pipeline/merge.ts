import fs from "node:fs";
import type {
  ApiChannel,
  CatalogPayload,
  CategoryInfo,
  ChannelSource,
  RawStreamEntry,
  ValidationResult,
} from "./types";
import {
  channelDedupKey,
  computeRankScore,
  detectQuality,
  readJsonFile,
  sourceId,
  writeJsonFile,
} from "./utils";
import { dataPath, pipelinePath, publicDataPath } from "./paths";

interface CategoryRulesFile {
  categories: { id: string; label: string; order: number }[];
  rules: { category: string; patterns: string[] }[];
  feedRegionMap: Record<string, string>;
}

/**
 * Returns the category and whether it came from a content RULE (strong)
 * vs a feed-region FALLBACK (weak). Rule matches should win over fallbacks
 * during dedup so a real movie/news channel isn't stuck in a region bucket.
 */
const ruleRegexCache = new Map<string, RegExp>();

function patternToRegex(pattern: string): RegExp {
  let re = ruleRegexCache.get(pattern);
  if (!re) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // word-boundary match so short tokens like "gtv" don't match inside
    // "samsungtvplus"; works for multi-word patterns too.
    re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    ruleRegexCache.set(pattern, re);
  }
  return re;
}

function assignCategory(
  entry: RawStreamEntry,
  rules: CategoryRulesFile,
): { category: string; fromRule: boolean } {
  // Match channel NAME primarily; group is noisy (e.g. "SamsungTVPlus")
  // and causes false positives, so only use it as a secondary signal.
  const name = entry.name.toLowerCase();
  const group = (entry.group ?? "").toLowerCase();

  for (const rule of rules.rules) {
    if (rule.patterns.some((p) => patternToRegex(p).test(name))) {
      return { category: rule.category, fromRule: true };
    }
  }
  // secondary: allow group match only for non-region categories
  for (const rule of rules.rules) {
    if (rule.category === "bangladesh" || rule.category === "international")
      continue;
    if (rule.patterns.some((p) => patternToRegex(p).test(group))) {
      return { category: rule.category, fromRule: true };
    }
  }

  return {
    category: rules.feedRegionMap[entry.feedRegion] ?? "international",
    fromRule: false,
  };
}

function isDefinitelyDead(v?: ValidationResult): boolean {
  if (!v) return false;
  return v.status === "dead" || v.status === "timeout" || v.status === "invalid";
}

/** A source with this many user-reported playback failures is dropped entirely. */
const REPORT_DROP_THRESHOLD = 2;

interface ReportEntry {
  sourceId: string;
  fails: number;
}

/** Normalize a tvg-id / channel name to a logo-map lookup key. */
function logoKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveLogo(
  stream: RawStreamEntry,
  logoMap: Map<string, string>,
): string | undefined {
  if (stream.logo) return stream.logo;
  if (logoMap.size === 0) return undefined;
  if (stream.tvgId) {
    const byId = logoMap.get(logoKey(stream.tvgId));
    if (byId) return byId;
  }
  return logoMap.get(logoKey(stream.name));
}

export function mergeCatalog(
  streams: RawStreamEntry[],
  validations: Map<string, ValidationResult>,
  rules: CategoryRulesFile,
  reports: Map<string, number> = new Map(),
  logoMap: Map<string, string> = new Map(),
): CatalogPayload {
  const channelMap = new Map<string, ApiChannel>();
  // tracks whether a channel's current category came from a strong content rule
  const categoryFromRule = new Map<string, boolean>();

  for (const stream of streams) {
    const validation = validations.get(stream.url);
    if (isDefinitelyDead(validation)) continue;

    const sid = sourceId(stream.url);
    const reportFails = reports.get(sid) ?? 0;
    // Drop sources users have repeatedly reported as broken — these are dead
    // in practice even if a HEAD check happens to pass (geo/token/format issues).
    if (reportFails >= REPORT_DROP_THRESHOLD) continue;

    const channelKey = channelDedupKey(stream.name);
    const { category, fromRule } = assignCategory(stream, rules);
    const quality = detectQuality(stream.name, stream.url);
    const latencyMs = validation?.latencyMs ?? 5000;
    const hasValidation = Boolean(validation);

    const rankScore = hasValidation
      ? computeRankScore({
          uptime:
            validation!.status === "ok"
              ? 1
              : validation!.status === "slow"
                ? 0.7
                : validation!.status === "geo_blocked"
                  ? 0.55
                  : 0.4,
          playbackSuccess: validation!.status === "geo_blocked" ? 0.6 : 0.9,
          latencyMs,
          quality,
          lastCheckAgeHours: 0,
        })
      : 45;

    // playback-failure feedback: each user-reported failure drops the score,
    // capped at -30 so a confirmed-good source can still recover over time.
    const reportPenalty = Math.min(30, reportFails * 10);
    const adjustedScore = Math.max(0, rankScore - reportPenalty);

    const source: ChannelSource = {
      id: sid,
      url: stream.url,
      quality,
      rankScore: adjustedScore,
      latencyMs: hasValidation ? latencyMs : undefined,
      isPrimary: false,
      sourceOrigin: stream.feedId,
    };

    const existing = channelMap.get(channelKey);
    if (!existing) {
      categoryFromRule.set(channelKey, fromRule);
      channelMap.set(channelKey, {
        id: channelKey,
        name: stream.name,
        logo: resolveLogo(stream, logoMap),
        category,
        group: stream.group,
        status: rankScore >= 40 ? "active" : "degraded",
        isBdix: stream.isBdix,
        tvgId: stream.tvgId,
        sources: [source],
      });
      continue;
    }

    if (!existing.logo) existing.logo = resolveLogo(stream, logoMap);
    if (stream.isBdix) existing.isBdix = true;
    // upgrade weak (region-fallback) category when a later variant matches a rule
    if (fromRule && !categoryFromRule.get(channelKey)) {
      existing.category = category;
      categoryFromRule.set(channelKey, true);
    }
    if (!existing.sources.some((s) => s.url === source.url)) {
      existing.sources.push(source);
    }
  }

  const channels: ApiChannel[] = [];

  const qualityRank: Record<string, number> = {
    "2160p": 5,
    "1080p": 4,
    "720p": 3,
    "480p": 2,
  };

  for (const ch of channelMap.values()) {
    // Best-source ordering with deterministic tie-breakers so the PRIMARY
    // is always the strongest, and backups go deep (best → worst):
    //  1. rankScore (validation + quality + latency + report feedback)
    //  2. validated sources beat unvalidated
    //  3. lower latency wins
    //  4. higher resolution wins
    //  5. https beats http (more browser-playable)
    ch.sources.sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;

      const aVal = a.latencyMs !== undefined ? 1 : 0;
      const bVal = b.latencyMs !== undefined ? 1 : 0;
      if (aVal !== bVal) return bVal - aVal;

      const aLat = a.latencyMs ?? 9999;
      const bLat = b.latencyMs ?? 9999;
      if (aLat !== bLat) return aLat - bLat;

      const aQ = qualityRank[a.quality ?? ""] ?? 1;
      const bQ = qualityRank[b.quality ?? ""] ?? 1;
      if (aQ !== bQ) return bQ - aQ;

      const aHttps = a.url.startsWith("https") ? 1 : 0;
      const bHttps = b.url.startsWith("https") ? 1 : 0;
      return bHttps - aHttps;
    });

    ch.sources.forEach((s, i) => {
      s.isPrimary = i === 0;
    });

    const best = ch.sources[0]?.rankScore ?? 0;
    if (best >= 70) ch.status = "active";
    else if (best >= 40) ch.status = "degraded";
    else ch.status = "offline";

    if (ch.status === "offline" && ch.sources.every((s) => s.rankScore < 25)) continue;
    channels.push(ch);
  }

  channels.sort((a, b) => a.name.localeCompare(b.name));

  const categoryCounts = new Map<string, number>();
  for (const ch of channels) {
    categoryCounts.set(ch.category, (categoryCounts.get(ch.category) ?? 0) + 1);
  }

  const categories: CategoryInfo[] = rules.categories
    .map((c) => ({
      ...c,
      count: categoryCounts.get(c.id) ?? 0,
    }))
    .filter((c) => c.count > 0);

  const validatedSources = [...validations.values()].filter(
    (v) => v.status === "ok" || v.status === "slow" || v.status === "geo_blocked",
  ).length;

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    stats: {
      totalChannels: channels.length,
      activeChannels: channels.filter((c) => c.status === "active").length,
      degradedChannels: channels.filter((c) => c.status === "degraded").length,
      totalSources: streams.length,
      validatedSources,
    },
    categories,
    channels,
  };
}

export async function runMerge(): Promise<CatalogPayload> {
  const rawPath = pipelinePath("raw-streams.json");
  if (!fs.existsSync(rawPath)) {
    throw new Error("Missing raw-streams.json — run discover first");
  }

  const raw = readJsonFile<{ streams: RawStreamEntry[] }>(rawPath);
  const validationsPath = pipelinePath("validations.json");

  let validations = new Map<string, ValidationResult>();
  if (fs.existsSync(validationsPath)) {
    const list = readJsonFile<ValidationResult[]>(validationsPath);
    validations = new Map(list.map((v) => [v.url, v]));
  }

  const rules = readJsonFile<CategoryRulesFile>(dataPath("category-rules.json"));

  // playback-failure reports → auto-demote map
  const reports = new Map<string, number>();
  const reportsPath = pipelinePath("reports.json");
  if (fs.existsSync(reportsPath)) {
    try {
      const data = readJsonFile<Record<string, ReportEntry>>(reportsPath);
      for (const entry of Object.values(data)) {
        if (entry?.sourceId) reports.set(entry.sourceId, entry.fails ?? 0);
      }
    } catch {
      /* ignore malformed reports */
    }
  }

  // logo enrichment map (tvgId/name -> logo URL), built by enrich-logos step
  const logoMap = new Map<string, string>();
  const logoMapPath = dataPath("logo-map.json");
  if (fs.existsSync(logoMapPath)) {
    try {
      const data = readJsonFile<Record<string, string>>(logoMapPath);
      for (const [k, v] of Object.entries(data)) logoMap.set(k, v);
      console.log(`[merge] Loaded ${logoMap.size} logo mappings`);
    } catch {
      /* ignore malformed logo map */
    }
  }

  const catalog = mergeCatalog(raw.streams, validations, rules, reports, logoMap);

  fs.mkdirSync(publicDataPath(), { recursive: true });
  writeJsonFile(publicDataPath("catalog.json"), catalog);
  writeJsonFile(pipelinePath("catalog.json"), catalog);

  console.log(
    `[merge] Catalog: ${catalog.stats.totalChannels} channels, ${catalog.stats.activeChannels} active`,
  );
  return catalog;
}

if (import.meta.url.startsWith("file:")) {
  const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
  if (scriptPath.endsWith("merge.ts") || scriptPath.endsWith("merge.js")) {
    runMerge().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
