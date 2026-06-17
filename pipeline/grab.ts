import { parseM3U } from "../src/lib/m3u-parser";
import { validateStreamUrl } from "./validate";
import { fetchWithTimeout } from "./utils";
import type { SourceFeed, ValidatedPlaylist } from "./types";

/**
 * Grab module — scrape IPTV aggregator sites to auto-discover sources.
 *
 * Feed types:
 * - scrape_site:    Base aggregator URL → auto-detect M3U + Xtream article pages
 * - scrape_m3u:     Direct article/page URL → extract M3U playlist URLs
 * - scrape_xtream:  Direct article/page URL → extract Xtream credentials
 * - scrape_stalker: Scrape Stalker/STB portals → extract MAC + channels
 */

const GRAB_TIMEOUT = 25000;
const PLAYLIST_VALIDATE_TIMEOUT = 20000;
const DEFAULT_MAX_PLAYLISTS = Number(process.env.GRAB_MAX_PLAYLISTS ?? 5);
const MIN_PLAYLIST_CHANNELS = Number(process.env.GRAB_MIN_CHANNELS ?? 5);
const SAMPLE_STREAMS_TO_TEST = 3;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0";
const M3U_USER_AGENT = "VLC/3.0 LibVLC/3.0";

// Regional filtering patterns
const REGIONAL_CODES = {
  FR: /\|FR\||\bFR\b|france|french/i,
  AF: /\|AF\b|\bAF\b(?!T)|afrique|africa(?!n)|senegal|sn|cameroon|ivory\s*coast/i,
  SN: /\|SN\||\bSN\b|senegal/i,
  AFR: /\|AFR\||\bAFR\b|afrique/i,
  BE: /\|BE\||\bBE\b|belgique|belgium/i,
  CH: /\|CH\||\bCH\b|suisse|switzerland/i,
  LU: /\|LU\||\bLU\b|luxembourg/i,
  EU: /\|EU\||\bEU\b|europe/i,
};

const EXCLUDE_LINK_PATTERNS = [
  /\.(jpg|jpeg|png|gif|svg|ico|css|js|pdf|zip|rar|woff|ttf|webp)$/i,
  /\/(tag|category|author|page|about|contact|privacy|terms|login|register|search|feed)\/?$/i,
  /^https?:\/\/(?:t\.me|telegram|twitter|facebook|instagram|youtube|tiktok|discord)\//i,
  /iptv-xtream-codesm3u-what-stbemu/i,
  /what-stbemu-and-stalker/i,
];

const M3U_LINK_PATTERNS = [
  /iptv-m3u-daily-lists/i,
  /m3u-playlist-new-iptv/i,
  /popular-iptv-playlist-m3u/i,
  /popular.*playlist.*m3u/i,
  /m3u.*popular/i,
  /m3u/i,
  /playlist/i,
  /iptv.*list/i,
  /list.*iptv/i,
  /free.*iptv/i,
  /iptv.*free/i,
];

const XTREAM_LINK_PATTERNS = [
  /xtream-codes-daily-lists/i,
  /xtream-codes-popular/i,
  /popular.*xtream/i,
  /xtream/i,
  /xtream.?codes/i,
  /x.?codes/i,
];

export interface GrabResult {
  /** Playlists that passed fetch + channel + sample-stream checks */
  validatedPlaylists: ValidatedPlaylist[];
  m3uUrls: string[];
  xtreamCreds: Array<{ portal: string; username: string; password: string }>;
  /** Pages scraped for discovery (debug / grab-results.json) */
  scrapedPages?: { m3u: string[]; xtream: string[] };
  stats?: { candidatesTested: number; candidatesRejected: number };
}

export interface AggregatorPages {
  m3u: string[];
  xtream: string[];
  domain: string;
}

/**
 * Check if a channel name matches target regions (FR, AF, SN, AFR, France, EU, BE, CH, LU).
 * Detects regional codes like |FR|, |AF|, |SN|, |AFR| and country keywords.
 */
export function isChannelFromTargetRegion(channelName: string): boolean {
  if (!channelName) return false;
  
  const nameLower = channelName.toLowerCase();
  
  // Reject false positives
  if (nameLower.includes("singapore") || nameLower.includes("malaysia")) {
    return false;
  }
  
  // Check for regional codes and keywords
  for (const pattern of Object.values(REGIONAL_CODES)) {
    if (pattern.test(channelName)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Filter playlist to ensure 100% of channels match target regions.
 * Returns null if playlist is mixed or has no matching channels.
 */
export function filterPureRegionalPlaylist(
  channels: Array<{ name: string; url: string }>,
): Array<{ name: string; url: string }> | null {
  if (channels.length === 0) return null;
  
  const targetChannels = channels.filter((ch) => isChannelFromTargetRegion(ch.name));
  
  // Accept only if 100% or very high match rate (>95%)
  const matchRate = targetChannels.length / channels.length;
  if (matchRate >= 0.95) {
    return targetChannels;
  }
  
  return null;
}

/**
 * Build URL with today's date for dynamic URLs.
 * Handles: /16-06-2026/, /16-june-2026/, {DATE}
 */
export function buildUrlForToday(url: string): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();

  if (/\d{2}-\d{2}-\d{4}/.test(url)) {
    return url.replace(/\d{2}-\d{2}-\d{4}/g, `${dd}-${mm}-${yyyy}`);
  }

  const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const monthEn = MONTHS[d.getMonth()];
  if (/\d{1,2}-[a-z]+-\d{4}/i.test(url)) {
    return url.replace(/\d{1,2}-[a-z]+-\d{4}/i, `${d.getDate()}-${monthEn}-${yyyy}`);
  }

  if (url.includes("{DATE}")) {
    return url.replace(/\{DATE\}/g, `${dd}-${mm}-${yyyy}`);
  }

  return url;
}

/** Score YYYYMMDD from URL date segments — higher = more recent */
export function urlDateScore(url: string): number {
  const numMatch = url.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (numMatch) {
    const [, dd, mm, yyyy] = numMatch;
    return parseInt(`${yyyy}${mm}${dd}`, 10);
  }

  const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const txtMatch = url.match(/(\d{1,2})-([a-z]+)-(\d{4})/i);
  if (txtMatch) {
    const [, dd, mon, yyyy] = txtMatch;
    const mm = MONTHS[mon.toLowerCase()];
    if (mm) return parseInt(`${yyyy}${String(mm).padStart(2, "0")}${dd.padStart(2, "0")}`, 10);
  }

  const usMatch = url.match(/(\d{2})_(\d{2})_(\d{4})/);
  if (usMatch) {
    const [, dd, mm, yyyy] = usMatch;
    return parseInt(`${yyyy}${mm}${dd}`, 10);
  }

  return 0;
}

async function fetchHtml(url: string, referer?: string): Promise<string> {
  let ref = referer;
  if (!ref) {
    try {
      const u = new URL(url);
      ref = `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      ref = url;
    }
  }

  const res = await fetchWithTimeout(url, {
    timeoutMs: GRAB_TIMEOUT,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3",
      Referer: ref,
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return await res.text();
}

function normalizeLink(link: string, baseHost: string): string {
  const cleaned = link
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/[#?].*$/, "")
    .replace(/\/$/, "")
    .trim();

  if (cleaned.startsWith("http")) return cleaned;
  if (cleaned.startsWith("/")) return `${baseHost}${cleaned}`;
  return cleaned;
}

function extractInternalLinks(html: string, siteUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    return [];
  }

  const domain = parsed.hostname.replace(/^www\./, "");
  const baseHost = `${parsed.protocol}//${parsed.host}`;

  const abs = [...html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi)].map((m) =>
    normalizeLink(m[1], baseHost),
  );
  const rel = [...html.matchAll(/href=["'](\/[^"'\s>]+)["']/gi)].map((m) =>
    normalizeLink(m[1], baseHost),
  );

  const sameDomain = (url: string): boolean => {
    try {
      const d = new URL(url).hostname.replace(/^www\./, "");
      return d === domain || d.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  };

  return [...new Set([...abs, ...rel])].filter(
    (link) => link && sameDomain(link) && !EXCLUDE_LINK_PATTERNS.some((re) => re.test(link)),
  );
}

function topScoredLinks(
  links: string[],
  patterns: RegExp[],
  limit: number,
): string[] {
  const scored = links
    .filter((link) => patterns.some((re) => re.test(link)))
    .map((url) => ({ url, score: urlDateScore(url) }))
    .sort((a, b) => b.score - a.score);

  const bestScore = scored[0]?.score ?? 0;
  const sameDay = scored.filter((x) => x.score === bestScore);
  const rest = scored.filter((x) => x.score < bestScore);

  const picked: string[] = [];
  for (const item of sameDay) {
    if (picked.length >= limit) break;
    if (!picked.includes(item.url)) picked.push(item.url);
  }
  for (const item of rest) {
    if (picked.length >= limit) break;
    if (!picked.includes(item.url)) picked.push(item.url);
  }
  return picked;
}

/**
 * Scrape an aggregator homepage and find the freshest M3U / Xtream article pages.
 * Ported from iptv-project scrapeGenericSite + scrapeWorldIptvUrls.
 */
export async function scrapeAggregatorSite(siteUrl: string): Promise<AggregatorPages> {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error(`Invalid aggregator URL: ${siteUrl}`);
  }

  const domain = parsed.hostname.replace(/^www\./, "");
  const baseHost = `${parsed.protocol}//${parsed.host}`;
  const homeUrl = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;

  console.log(`[grab] Scanning aggregator ${homeUrl}...`);
  const html = await fetchHtml(homeUrl, baseHost);
  const links = extractInternalLinks(html, homeUrl);

  let m3u = topScoredLinks(links, M3U_LINK_PATTERNS, 3);
  let xtream = topScoredLinks(links, XTREAM_LINK_PATTERNS, 2);

  // Deep scrape: if homepage has few matches, follow sub-pages (1 level)
  if (m3u.length === 0 && links.length > 0) {
    const subPages = links.slice(0, 5);
    for (const subUrl of subPages) {
      try {
        const subHtml = await fetchHtml(subUrl, homeUrl);
        const subLinks = extractInternalLinks(subHtml, subUrl);
        const found = topScoredLinks(subLinks, M3U_LINK_PATTERNS, 3);
        if (found.length > 0) {
          m3u.push(...found);
          break;
        }
      } catch (err) {
        console.warn(`[grab] Sub-page failed ${subUrl}: ${err}`);
      }
    }
    m3u = [...new Set(m3u)].slice(0, 3);
  }

  if (xtream.length === 0 && links.length > 0) {
    const subPages = links.slice(0, 5);
    for (const subUrl of subPages) {
      try {
        const subHtml = await fetchHtml(subUrl, homeUrl);
        const subLinks = extractInternalLinks(subHtml, subUrl);
        const found = topScoredLinks(subLinks, XTREAM_LINK_PATTERNS, 2);
        if (found.length > 0) {
          xtream.push(...found);
          break;
        }
      } catch (err) {
        console.warn(`[grab] Sub-page failed ${subUrl}: ${err}`);
      }
    }
    xtream = [...new Set(xtream)].slice(0, 2);
  }

  console.log(
    `[grab] ${domain} → M3U pages: ${m3u.length}, Xtream pages: ${xtream.length}`,
  );

  return { m3u, xtream, domain };
}

/**
 * Extract M3U URLs from HTML.
 */
export function extractM3uUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>();

  const resolve = (u: string): string | null => {
    if (!u || u.startsWith("#") || u.startsWith("javascript")) return null;
    u = u.replace(/&amp;/g, "&").replace(/&#038;/g, "&").trim();
    if (u.startsWith("http")) return u;
    if (u.startsWith("/") && baseUrl) {
      try {
        const b = new URL(baseUrl);
        return `${b.protocol}//${b.host}${u}`;
      } catch {
        return null;
      }
    }
    return null;
  };

  let preprocessed = html
    .replace(/([^\s\n])(https?:\/\/)/g, "$1\n$2")
    .replace(/(get\.php\?[^\s\n]+)(https?:\/\/)/g, "$1\n$2")
    .replace(/(m3u_plus|m3u)(https?:\/\/)/gi, "$1\n$2")
    .replace(/<(code|pre)[^>]*>/gi, "\n$1>")
    .replace(/<\/(code|pre)>/gi, "</$1>\n");

  const patterns = [
    /https?:\/\/[^\s<>"'\)\(,\n]+\/get\.php\?(?:username=[^&\s]+&password=[^&\s]+|[^&\s]+=[^&\s]+&[^&\s]+=[^&\s]+)/gi,
    /https?:\/\/[^\s<>"'\)\(,\n]+\.m3u8?(?:\?[^\s<>"'\)\(,\n]*)?/gi,
    /https?:\/\/[^\s<>"'\)\(,\n]+[?&]type=m3u[^\s<>"'\)\(,\n]*/gi,
    /https?:\/\/[^\s<>"'\)\(,\n]+m3u_plus[^\s<>"'\)\(,\n]*/gi,
    /https?:\/\/[^\s<>"'\)\(,\n]+(?:playlist|iptv|channels)[^\s<>"'\)\(,\n]*\.m3u[8u]?/gi,
  ];

  for (const pattern of patterns) {
    for (const u of preprocessed.match(pattern) || []) {
      const cleaned = u
        .replace(/&amp;/g, "&")
        .replace(/&#038;/g, "&")
        .replace(/[<>"'\)\(,\s\n]+$/, "")
        .trim();
      if (cleaned.startsWith("http") && cleaned.length > 20) {
        found.add(cleaned);
      }
    }
  }

  const hrefRe = /(?:href|src|data-href|data-url)=["']([^"']*\.m3u[8u]?[^"']*)/gi;
  for (const match of preprocessed.matchAll(hrefRe)) {
    const resolved = resolve(match[1]);
    if (resolved) found.add(resolved);
  }

  const textContent = preprocessed.replace(/<[^>]+>/g, " ");
  const urlInText = /https?:\/\/[^\s<>"'\)\(,\n]+/g;
  for (const match of textContent.match(urlInText) || []) {
    if (match.includes(".m3u") || match.includes("get.php") || match.includes("type=m3u")) {
      const cleaned = match
        .replace(/&amp;/g, "&")
        .replace(/&#038;/g, "&")
        .replace(/[<>"'\)\(,\s\n]+$/, "")
        .trim();
      if (cleaned.startsWith("http") && cleaned.length > 20) {
        found.add(cleaned);
      }
    }
  }

  return Array.from(found);
}

/**
 * Extract Xtream Codes credentials from HTML.
 */
export function extractXtreamCredentials(
  html: string,
): Array<{ portal: string; username: string; password: string }> {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#?[0-9]+;/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ");

  const creds: Array<{ portal: string; username: string; password: string }> = [];
  const seen = new Set<string>();

  const push = (portal: string, username: string, password: string) => {
    if (!portal || !username || !password) return;
    portal = portal.trim().replace(/\/$/, "");
    username = username.trim();
    password = password.trim();

    try {
      const u = new URL(portal);
      portal = `${u.protocol}//${u.host}`;
    } catch {
      /* keep as-is */
    }

    const key = `${portal}|${username}`;
    if (seen.has(key)) return;
    seen.add(key);
    creds.push({ portal, username, password });
  };

  const getPhpPattern =
    /https?:\/\/[^\s<>"'\)\(,\n]+\/get\.php\?username=([^&\s]+)&password=([^&\s]+)/gi;
  for (const match of text.matchAll(getPhpPattern)) {
    try {
      const u = new URL(match[0]);
      push(`${u.protocol}//${u.host}`, match[1], match[2]);
    } catch {
      /* skip */
    }
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let currentPortal: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const portalMatch = line.match(/Portal\s*[:\|]\s*(https?:\/\/[^\s,]+)/i);
    if (portalMatch) {
      currentPortal = portalMatch[1];
      continue;
    }

    if (/^https?:\/\/[^\s]+$/.test(line) && !line.includes("Username") && !line.includes("Password")) {
      currentPortal = line;
      continue;
    }

    if (!currentPortal) continue;

    const inline = line.match(/Username\s*[:\|]\s*(\S+)\s*\|\s*Password\s*[:\|]\s*(\S+)/i);
    if (inline) {
      push(currentPortal, inline[1], inline[2]);
      continue;
    }

    const userMatch = line.match(/Username\s*[:\|]\s*(\S+)/i);
    if (userMatch) {
      const passSame = line.match(/Password\s*[:\|]\s*(\S+)/i);
      if (passSame) {
        push(currentPortal, userMatch[1], passSame[1]);
        continue;
      }

      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const passNext = lines[j].match(/Password\s*[:\|]\s*(\S+)/i);
        if (passNext) {
          push(currentPortal, userMatch[1], passNext[1]);
          i = j;
          break;
        }
      }
      continue;
    }

    if (/^https?:\/\//.test(line)) {
      currentPortal = line;
    }
  }

  const globalRe =
    /Portal\s*[:\|]\s*(https?:\/\/[^\s\n,]+)[\s\S]{0,300}?Username\s*[:\|]\s*(\S+)[\s\S]{0,100}?Password\s*[:\|]\s*(\S+)/gi;
  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(text)) !== null) {
    push(match[1], match[2], match[3]);
  }

  return creds;
}

export function buildXtreamM3uUrl(
  portal: string,
  username: string,
  password: string,
  outputTs = true,
): string {
  let base = portal.trim();
  try {
    const u = new URL(base);
    base = `${u.protocol}//${u.host}`;
  } catch {
    /* keep */
  }
  if (!base.startsWith("http")) base = `http://${base}`;
  const out = outputTs ? "&output=ts" : "";
  return `${base}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus${out}`;
}

interface PlaylistCandidate {
  m3uUrl: string;
  source: "direct" | "xtream";
  portal?: string;
  username?: string;
  password?: string;
}

/** Normalize playlist URL for dedup (same Xtream account with different params). */
function playlistKey(m3uUrl: string): string {
  try {
    const u = new URL(m3uUrl);
    const user = u.searchParams.get("username") ?? "";
    const pass = u.searchParams.get("password") ?? "";
    if (user && pass) return `${u.protocol}//${u.host}|${user}|${pass}`;
    return m3uUrl.replace(/[#?].*$/, "").trim();
  } catch {
    return m3uUrl;
  }
}

async function hasWorkingSampleStream(streamUrls: string[]): Promise<boolean> {
  for (const streamUrl of streamUrls.slice(0, SAMPLE_STREAMS_TO_TEST)) {
    if (!streamUrl.startsWith("http")) continue;
    const result = await validateStreamUrl(streamUrl);
    if (["ok", "slow", "geo_blocked"].includes(result.status)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that a playlist URL is fetchable, has enough channels,
 * and at least one sample stream responds.
 * Applies regional filtering (FR/AF/SN/AFR/France/EU/BE/CH/LU).
 */
export async function validatePlaylistUrl(
  m3uUrl: string,
): Promise<Omit<ValidatedPlaylist, "source" | "portal" | "username" | "password"> | null> {
  try {
    const response = await fetchWithTimeout(m3uUrl, {
      timeoutMs: PLAYLIST_VALIDATE_TIMEOUT,
      headers: { "User-Agent": M3U_USER_AGENT },
    });
    if (!response.ok) return null;

    const content = await response.text();
    if (!content.includes("#EXTINF") && !content.includes("#EXTM3U")) return null;

    const parsed = parseM3U(content);
    if (parsed.length < MIN_PLAYLIST_CHANNELS) return null;

    // Apply regional filtering: only accept playlists with 95%+ target channels
    const targetChannels = parsed.filter((ch) => isChannelFromTargetRegion(ch.name));
    const matchRate = targetChannels.length / parsed.length;
    if (matchRate < 0.95) {
      console.log(
        `[grab] Playlist rejected: only ${(matchRate * 100).toFixed(1)}% channels match target regions`,
      );
      return null;
    }

    const streamUrls = parsed.map((ch) => ch.url).filter((u) => u.startsWith("http"));
    if (streamUrls.length === 0) return null;

    const works = await hasWorkingSampleStream(streamUrls);
    if (!works) return null;

    return { m3uUrl, channelCount: parsed.length };
  } catch {
    return null;
  }
}

async function collectWorkingPlaylists(
  candidates: PlaylistCandidate[],
  maxPlaylists: number,
): Promise<{ playlists: ValidatedPlaylist[]; tested: number; rejected: number }> {
  const playlists: ValidatedPlaylist[] = [];
  const tried = new Set<string>();
  let tested = 0;
  let rejected = 0;

  for (const candidate of candidates) {
    if (playlists.length >= maxPlaylists) break;

    const key = playlistKey(candidate.m3uUrl);
    if (tried.has(key)) continue;
    tried.add(key);
    tested++;

    console.log(
      `[grab] Validating playlist ${tested} (${playlists.length}/${maxPlaylists} ok): ${candidate.m3uUrl.substring(0, 70)}...`,
    );

    const valid = await validatePlaylistUrl(candidate.m3uUrl);
    if (!valid) {
      rejected++;
      continue;
    }

    playlists.push({
      ...valid,
      source: candidate.source,
      portal: candidate.portal,
      username: candidate.username,
      password: candidate.password,
    });
    console.log(
      `[grab] ✓ Working playlist (${valid.channelCount} channels): ${candidate.m3uUrl.substring(0, 70)}...`,
    );
  }

  return { playlists, tested, rejected };
}

async function tryPlaylistCandidate(
  candidate: PlaylistCandidate,
  maxPlaylists: number,
  playlists: ValidatedPlaylist[],
  tried: Set<string>,
  stats: { tested: number; rejected: number },
): Promise<boolean> {
  if (playlists.length >= maxPlaylists) return false;

  const key = playlistKey(candidate.m3uUrl);
  if (tried.has(key)) return true;
  tried.add(key);
  stats.tested++;

  console.log(
    `[grab] Validating playlist ${stats.tested} (${playlists.length}/${maxPlaylists} ok): ${candidate.m3uUrl.substring(0, 70)}...`,
  );

  const valid = await validatePlaylistUrl(candidate.m3uUrl);
  if (!valid) {
    stats.rejected++;
    return true;
  }

  playlists.push({
    ...valid,
    source: candidate.source,
    portal: candidate.portal,
    username: candidate.username,
    password: candidate.password,
  });
  console.log(
    `[grab] ✓ Working playlist (${valid.channelCount} channels): ${candidate.m3uUrl.substring(0, 70)}...`,
  );
  return playlists.length < maxPlaylists;
}

/** Scrape article pages and validate candidates until maxPlaylists working ones are found. */
async function collectWorkingPlaylistsFromPages(
  m3uPages: string[],
  xtreamPages: string[],
  referer: string,
  maxPlaylists: number,
): Promise<{ playlists: ValidatedPlaylist[]; tested: number; rejected: number }> {
  const playlists: ValidatedPlaylist[] = [];
  const tried = new Set<string>();
  const stats = { tested: 0, rejected: 0 };

  for (const pageUrl of m3uPages) {
    if (playlists.length >= maxPlaylists) break;
    try {
      console.log(`[grab] M3U page: ${pageUrl.substring(0, 70)}...`);
      const html = await fetchHtml(pageUrl, referer);
      for (const m3uUrl of extractM3uUrls(html, pageUrl)) {
        const keepGoing = await tryPlaylistCandidate(
          { m3uUrl, source: "direct" },
          maxPlaylists,
          playlists,
          tried,
          stats,
        );
        if (!keepGoing) break;
      }
    } catch (err) {
      console.warn(`[grab] M3U page failed: ${err}`);
    }
  }

  for (const pageUrl of xtreamPages) {
    if (playlists.length >= maxPlaylists) break;
    try {
      console.log(`[grab] Xtream page: ${pageUrl.substring(0, 70)}...`);
      const html = await fetchHtml(pageUrl, referer);
      for (const cred of extractXtreamCredentials(html)) {
        for (const outputTs of [true, false]) {
          const keepGoing = await tryPlaylistCandidate(
            {
              m3uUrl: buildXtreamM3uUrl(cred.portal, cred.username, cred.password, outputTs),
              source: "xtream",
              portal: cred.portal,
              username: cred.username,
              password: cred.password,
            },
            maxPlaylists,
            playlists,
            tried,
            stats,
          );
          if (!keepGoing) break;
        }
        if (playlists.length >= maxPlaylists) break;
      }
    } catch (err) {
      console.warn(`[grab] Xtream page failed: ${err}`);
    }
  }

  return { playlists, tested: stats.tested, rejected: stats.rejected };
}

function grabResultFromValidated(
  validated: ValidatedPlaylist[],
  scrapedPages?: { m3u: string[]; xtream: string[] },
  stats?: { candidatesTested: number; candidatesRejected: number },
): GrabResult {
  const m3uUrls = validated.map((p) => p.m3uUrl);
  const xtreamCreds = dedupeCreds(
    validated
      .filter((p) => p.source === "xtream" && p.portal && p.username && p.password)
      .map((p) => ({
        portal: p.portal!,
        username: p.username!,
        password: p.password!,
      })),
  );

  return {
    validatedPlaylists: validated,
    m3uUrls,
    xtreamCreds,
    scrapedPages,
    stats,
  };
}

function dedupeCreds(
  creds: Array<{ portal: string; username: string; password: string }>,
): Array<{ portal: string; username: string; password: string }> {
  const seen = new Set<string>();
  return creds.filter((c) => {
    const key = `${c.portal}|${c.username}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Grab sources from a feed configuration.
 */
export async function grabFromUrl(feed: SourceFeed): Promise<GrabResult> {
  console.log(`[grab] Scraping ${feed.name} (${feed.type})...`);

  const maxPlaylists = feed.maxPlaylists ?? DEFAULT_MAX_PLAYLISTS;
  let scrapedPages: { m3u: string[]; xtream: string[] } | undefined;
  let candidates: PlaylistCandidate[] = [];
  let collection:
    | { playlists: ValidatedPlaylist[]; tested: number; rejected: number }
    | null = null;

  if (feed.type === "scrape_site") {
    const urlsToTry = [...new Set([feed.url, buildUrlForToday(feed.url)])];
    let pages: AggregatorPages | null = null;

    for (const tryUrl of urlsToTry) {
      try {
        pages = await scrapeAggregatorSite(tryUrl);
        if (pages.m3u.length > 0 || pages.xtream.length > 0) break;
      } catch (err) {
        console.warn(`[grab] Aggregator scan failed for ${tryUrl}: ${err}`);
      }
    }

    if (!pages || (pages.m3u.length === 0 && pages.xtream.length === 0)) {
      throw new Error("No M3U or Xtream pages found on aggregator site");
    }

    scrapedPages = { m3u: pages.m3u, xtream: pages.xtream };
    console.log(
      `[grab] Validating up to ${maxPlaylists} working playlist(s) from aggregator pages`,
    );
    collection = await collectWorkingPlaylistsFromPages(
      pages.m3u,
      pages.xtream,
      feed.url,
      maxPlaylists,
    );
  } else if (feed.type === "scrape_m3u") {
    const urlsToTry = [...new Set([feed.url, buildUrlForToday(feed.url)])];
    for (const tryUrl of urlsToTry) {
      try {
        const html = await fetchHtml(tryUrl);
        const found = extractM3uUrls(html, tryUrl);
        if (found.length > 0) {
          scrapedPages = { m3u: [tryUrl], xtream: [] };
          candidates = found.map((m3uUrl) => ({ m3uUrl, source: "direct" as const }));
          break;
        }
      } catch (err) {
        console.warn(`[grab] Failed ${tryUrl}: ${err}`);
      }
    }
  } else if (feed.type === "scrape_xtream") {
    const urlsToTry = [...new Set([feed.url, buildUrlForToday(feed.url)])];
    for (const tryUrl of urlsToTry) {
      try {
        const html = await fetchHtml(tryUrl);
        const found = extractXtreamCredentials(html);
        if (found.length > 0) {
          scrapedPages = { m3u: [], xtream: [tryUrl] };
          candidates = found.flatMap((cred) => [
            {
              m3uUrl: buildXtreamM3uUrl(cred.portal, cred.username, cred.password),
              source: "xtream" as const,
              portal: cred.portal,
              username: cred.username,
              password: cred.password,
            },
            {
              m3uUrl: buildXtreamM3uUrl(cred.portal, cred.username, cred.password, false),
              source: "xtream" as const,
              portal: cred.portal,
              username: cred.username,
              password: cred.password,
            },
          ]);
          break;
        }
      } catch (err) {
        console.warn(`[grab] Failed ${tryUrl}: ${err}`);
      }
    }
  } else {
    throw new Error(`Unsupported grab feed type: ${feed.type}`);
  }

  const { playlists, tested, rejected } =
    collection ?? (await collectWorkingPlaylists(candidates, maxPlaylists));

  const result = grabResultFromValidated(playlists, scrapedPages, {
    candidatesTested: tested,
    candidatesRejected: rejected,
  });

  console.log(
    `[grab] Kept ${result.validatedPlaylists.length}/${maxPlaylists} working playlists (tested ${tested}, rejected ${rejected})`,
  );

  return result;
}

/**
 * Run grab for all scrape-type feeds in source registry.
 */
export async function runGrab(): Promise<number> {
  const { readJsonFile, writeJsonFile } = await import("./utils");
  const { dataPath } = await import("./paths");

  const registry = readJsonFile<SourceFeed[]>(dataPath("source-registry.json"));
  const scrapeFeeds = registry.filter((f) => f.type.startsWith("scrape_"));

  if (scrapeFeeds.length === 0) {
    console.log("[grab] No scrape feeds found in registry");
    return 0;
  }

  console.log(`[grab] Processing ${scrapeFeeds.length} scrape feeds`);

  const results: Array<{
    feedId: string;
    feedName: string;
    scrapedPages?: { m3u: string[]; xtream: string[] };
    validatedPlaylists: ValidatedPlaylist[];
    stats?: { candidatesTested: number; candidatesRejected: number };
    m3uUrls: string[];
    xtreamCreds: Array<{ portal: string; username: string; password: string }>;
  }> = [];

  for (const feed of scrapeFeeds) {
    try {
      const result = await grabFromUrl(feed);
      results.push({
        feedId: feed.id,
        feedName: feed.name,
        scrapedPages: result.scrapedPages,
        validatedPlaylists: result.validatedPlaylists,
        stats: result.stats,
        m3uUrls: result.m3uUrls,
        xtreamCreds: result.xtreamCreds,
      });
    } catch (err) {
      console.error(`[grab] Failed for ${feed.id}:`, err);
    }
  }

  writeJsonFile(dataPath("grab-results.json"), {
    grabbedAt: new Date().toISOString(),
    feeds: results,
  });

  console.log(`[grab] Saved results for ${results.length} feeds`);

  return results.reduce((sum, r) => sum + r.validatedPlaylists.length, 0);
}

if (import.meta.url.startsWith("file:")) {
  const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
  if (scriptPath.endsWith("grab.ts") || scriptPath.endsWith("grab.js")) {
    runGrab().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
