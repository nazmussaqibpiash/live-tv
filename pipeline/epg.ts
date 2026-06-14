/**
 * Builds a compact "now / next" EPG (Electronic Program Guide) for the channels
 * in our catalog.
 *
 * Data source: epgshare01.online — community-maintained, country-grouped XMLTV
 * files derived from the iptv-org ecosystem, refreshed daily. We deliberately
 * fetch only the country files relevant to our catalog (inferred from each
 * channel's `tvgId` country suffix) to keep the download small.
 *
 * We match a channel to its guide entry by:
 *   1. exact tvg-id  (e.g. "PTV.Sports.pk")
 *   2. normalized tvg-id / display-name (folds punctuation/spacing/case)
 *
 * Output: public/data/epg.json
 *   {
 *     updatedAt: ISO,
 *     // keyed by our channel id; value is the upcoming programmes (now + next few)
 *     programs: { [channelId]: { t: title, s: startMs, e: stopMs }[] }
 *   }
 *
 * The whole step is best-effort: any network/parse failure for a country file is
 * logged and skipped so a partial guide is always better than none, and the app
 * degrades gracefully when a channel has no guide data.
 */
import zlib from "node:zlib";
import { promisify } from "node:util";
import type { CatalogPayload } from "../src/lib/types";
import { publicDataPath } from "./paths";
import { readJsonFile, writeJsonFile, fetchWithTimeout } from "./utils";

const gunzip = promisify(zlib.gunzip);

const BASE = "https://epgshare01.online/epgshare01";
/** how many upcoming programmes to keep per channel (now + next few) */
const KEEP_PER_CHANNEL = 4;
/** keep programmes that end no earlier than (now - this) to allow for "now" */
const PAST_GRACE_MS = 6 * 60 * 60 * 1000;

interface Programme {
  t: string;
  s: number;
  e: number;
}

/** normalize a channel id / name for fuzzy matching */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** XMLTV datetime: "20260614000000 +0530" -> epoch ms (returns NaN if bad) */
function parseXmltvTime(raw: string): number {
  const m = raw
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s = "00", tz] = m;
  let iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (tz) iso += `${tz.slice(0, 3)}:${tz.slice(3)}`;
  else iso += "Z";
  return Date.parse(iso);
}

/** ISO 3166 country code (lowercase) from a tvg-id like "PTV.Sports.pk" */
function countryFromTvgId(tvgId?: string): string | null {
  if (!tvgId) return null;
  const m = tvgId.match(/\.([a-z]{2})(@.*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Lightweight XMLTV parser focused on <channel> display-names and <programme>
 * now/next. Avoids a heavy XML dep; the format is regular and machine-generated.
 */
function parseXmltv(xml: string): {
  /** normalized key (id + display names) -> guide channel id */
  aliasToId: Map<string, string>;
  /** guide channel id -> programmes */
  byId: Map<string, Programme[]>;
} {
  const aliasToId = new Map<string, string>();
  const byId = new Map<string, Programme[]>();
  const now = Date.now();
  const cutoff = now - PAST_GRACE_MS;

  // channels (build alias map)
  const chanRe = /<channel\s+id="([^"]+)">([\s\S]*?)<\/channel>/g;
  let cm: RegExpExecArray | null;
  while ((cm = chanRe.exec(xml))) {
    const id = decodeEntities(cm[1]);
    aliasToId.set(norm(id), id);
    const nameRe = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
    let nm: RegExpExecArray | null;
    while ((nm = nameRe.exec(cm[2]))) {
      const key = norm(decodeEntities(nm[1].trim()));
      if (key && !aliasToId.has(key)) aliasToId.set(key, id);
    }
  }

  // programmes
  const progRe =
    /<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)">([\s\S]*?)<\/programme>/g;
  let pm: RegExpExecArray | null;
  while ((pm = progRe.exec(xml))) {
    const e = parseXmltvTime(pm[2]);
    if (!Number.isFinite(e) || e < cutoff) continue;
    const s = parseXmltvTime(pm[1]);
    if (!Number.isFinite(s)) continue;
    const id = decodeEntities(pm[3]);
    const titleM = pm[4].match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const t = titleM ? decodeEntities(titleM[1].trim()) : "";
    if (!t) continue;
    const list = byId.get(id) ?? [];
    list.push({ t, s, e });
    byId.set(id, list);
  }

  // sort + trim each channel's programmes to the upcoming window
  for (const [id, list] of byId) {
    list.sort((a, b) => a.s - b.s);
    byId.set(id, list.filter((p) => p.e >= cutoff).slice(0, KEEP_PER_CHANNEL));
  }

  return { aliasToId, byId };
}

async function fetchCountryFiles(cc: string): Promise<string[]> {
  const out: string[] = [];
  // epgshare01 splits big countries into numbered files (CC1, CC2, ...)
  const CC = cc.toUpperCase();
  for (let i = 1; i <= 6; i++) {
    const url = `${BASE}/epg_ripper_${CC}${i}.xml.gz`;
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 30000 });
      if (!res.ok) {
        if (i === 1) break; // no data for this country at all
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const xml = (await gunzip(buf)).toString("utf-8");
      out.push(xml);
    } catch (err) {
      console.warn(`[epg] ${url} failed: ${(err as Error).message}`);
      if (i === 1) break;
    }
  }
  return out;
}

export async function runEpg(): Promise<void> {
  console.log("[epg] Building now/next guide...");
  const catalog = readJsonFile<CatalogPayload>(publicDataPath("catalog.json"));
  const channels = catalog.channels.filter(
    (c) => c.status === "active" || c.status === "degraded",
  );

  // group channels by country so we only download relevant guide files
  const byCountry = new Map<string, typeof channels>();
  for (const c of channels) {
    const cc = countryFromTvgId(c.tvgId);
    if (!cc) continue;
    const arr = byCountry.get(cc) ?? [];
    arr.push(c);
    byCountry.set(cc, arr);
  }

  // only fetch countries with a meaningful number of channels (keeps it fast)
  const countries = [...byCountry.entries()]
    .filter(([, arr]) => arr.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cc]) => cc);

  console.log(
    `[epg] ${channels.length} channels across ${byCountry.size} countries; fetching ${countries.length} guide(s)`,
  );

  const programs: Record<string, Programme[]> = {};
  let matched = 0;

  for (const cc of countries) {
    const xmls = await fetchCountryFiles(cc);
    if (xmls.length === 0) continue;
    const aliasToId = new Map<string, string>();
    const byId = new Map<string, Programme[]>();
    for (const xml of xmls) {
      const parsed = parseXmltv(xml);
      for (const [k, v] of parsed.aliasToId) if (!aliasToId.has(k)) aliasToId.set(k, v);
      for (const [k, v] of parsed.byId) byId.set(k, v);
    }

    for (const ch of byCountry.get(cc) ?? []) {
      const candidates = [ch.tvgId, ch.name].filter(Boolean) as string[];
      let progs: Programme[] | undefined;
      for (const cand of candidates) {
        const gid = aliasToId.get(norm(cand));
        if (gid && byId.has(gid)) {
          progs = byId.get(gid);
          break;
        }
      }
      if (progs && progs.length > 0) {
        programs[ch.id] = progs;
        matched++;
      }
    }
    console.log(`[epg]   ${cc}: matched ${matched} so far`);
  }

  writeJsonFile(publicDataPath("epg.json"), {
    updatedAt: new Date().toISOString(),
    programs,
  });
  console.log(
    `[epg] Wrote guide for ${matched}/${channels.length} channels -> public/data/epg.json`,
  );
}

if (import.meta.url.startsWith("file:")) {
  const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
  if (scriptPath.endsWith("epg.ts") || scriptPath.endsWith("epg.js")) {
    runEpg().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
