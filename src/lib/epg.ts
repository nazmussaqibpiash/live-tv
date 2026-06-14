import fs from "node:fs";
import path from "node:path";

const EPG_PATH = path.join(process.cwd(), "public", "data", "epg.json");

export interface EpgProgram {
  /** title */
  t: string;
  /** start time (epoch ms) */
  s: number;
  /** stop time (epoch ms) */
  e: number;
}

export interface EpgPayload {
  updatedAt: string;
  programs: Record<string, EpgProgram[]>;
}

// in-memory cache keyed by file mtime
let cached: { mtimeMs: number; epg: EpgPayload } | null = null;

export function loadEpg(): EpgPayload | null {
  try {
    if (!fs.existsSync(EPG_PATH)) return null;
    const stat = fs.statSync(EPG_PATH);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.epg;
    const raw = fs.readFileSync(EPG_PATH, "utf-8");
    if (!raw.trim()) return cached?.epg ?? null;
    const epg = JSON.parse(raw) as EpgPayload;
    cached = { mtimeMs: stat.mtimeMs, epg };
    return epg;
  } catch {
    return cached?.epg ?? null;
  }
}

/** now + next program for a channel id (or null if no guide data) */
export function nowNext(
  epg: EpgPayload,
  channelId: string,
  at = Date.now(),
): { now: EpgProgram | null; next: EpgProgram | null } | null {
  const list = epg.programs[channelId];
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
