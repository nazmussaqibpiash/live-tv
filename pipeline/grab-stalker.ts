import { fetchWithTimeout } from "./utils";

/**
 * Stalker/STB portal support module.
 * Extracts MAC addresses from HTML pages and fetches live channels from Stalker portals.
 * Filters channels by FR/AF/SN regional genres.
 */

export interface StalkerEntry {
  portal: string;
  mac: string;
  expDate?: string;
  expired: boolean;
}

export interface StalkerChannel {
  id: string;
  name: string;
  tvgId: string;
  tvgLogo?: string;
  group: string;
  url: string;
  valid?: boolean;
}

/**
 * FR/AF/SN genre patterns for Stalker portals.
 * Detects genres in various formats: |FR|, FR |, |AF|, FRANCE, AFRIQUE, SENEGAL, etc.
 */
function isFrAfStalkerGenre(genreTitle: string): boolean {
  if (!genreTitle) return false;

  const g = genreTitle.toUpperCase();

  // Regional codes formatted
  if (/\|FR\|/.test(g) || /\bFR\b/.test(g)) return true;
  if (/\|AF\|/.test(g) || /\bAF\b/.test(g)) return true;
  if (/\|SN\|/.test(g) || /\bSN\b/.test(g)) return true;
  if (/\|AFR\|/.test(g) || /\bAFR\b/.test(g)) return true;

  // Additional African regions
  if (/\|BE\|/.test(g) || /\|MA\|/.test(g) || /\|DZ\|/.test(g) || /\|TN\|/.test(g)) return true;
  if (/\|CI\|/.test(g) || /\|CM\|/.test(g) || /\|ML\|/.test(g) || /\|BF\|/.test(g)) return true;
  if (/\|GN\|/.test(g) || /\|TG\|/.test(g) || /\|BJ\|/.test(g) || /\|GA\|/.test(g)) return true;

  // French language
  if (/FRANC[EO]|FRENCH|FRANCAIS|FRANÇAIS|FRANCOPHONE|FRANCO/.test(g)) return true;
  if (/TNT|TNT FR|TNT FRANCE/.test(g)) return true;

  // Africa — general
  if (/AFRIQUE|AFRICA|AFRICAIN|AFRICAN|AFRICAINES/.test(g)) return true;

  // African countries by name
  if (/SENEGAL|SÉNÉGAL|DAKAR/.test(g)) return true;
  if (/COTE.?IVOIRE|IVOIRIEN/.test(g)) return true;
  if (/CAMEROUN|CAMEROON/.test(g)) return true;
  if (/\bMALI\b|MALIEN/.test(g)) return true;
  if (/BURKINA|BURKINABE/.test(g)) return true;
  if (/GUINEE|GUINÉE/.test(g)) return true;
  if (/\bTOGO\b|TOGOLAIS/.test(g)) return true;
  if (/\bBENIN\b|\bBÉNIN\b/.test(g)) return true;
  if (/\bNIGER\b|NIGERIEN/.test(g)) return true;
  if (/\bCONGO\b|CONGOLAIS/.test(g)) return true;
  if (/\bGABON\b|GABONAIS/.test(g)) return true;
  if (/MADAGASCAR|MALGACHE/.test(g)) return true;

  // Maghreb
  if (/MAGHREB|MAROC|MAROCAIN/.test(g)) return true;
  if (/ALGERI|ALGÉR/.test(g)) return true;
  if (/TUNISI|TUNÉS/.test(g)) return true;

  // Francophone Europe
  if (/BELGI|BELGIUM/.test(g)) return true;
  if (/SUISS|SWISS/.test(g)) return true;
  if (/LUXEMB/.test(g)) return true;

  // Known bouquets
  if (/CINAF|TV5|CANAL.?AFRIQUE|AFRICA.?CANAL/.test(g)) return true;
  if (/INTERNATIONAL.*FR|FR.*INTERNATIONAL/.test(g)) return true;
  if (/AFRICA 24|RFI|TRACE/.test(g)) return true;

  return false;
}

/**
 * Extract Stalker portal MAC addresses and expiration dates from HTML.
 * Recognizes formats:
 *   http://line.plav.cc:80/c/
 *   00:1A:79:3F:C9:AF  2030. 10. 20
 *
 *   http://host:port/c/
 *   MAC: 00:1A:79:...   Exp: 2030-10-20
 */
export function extractStalkerEntries(html: string): StalkerEntry[] {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/\*\*([^*]+)\*\*/g, "$1") // remove **bold** markdown
    .replace(/\*([^*]+)\*/g, "$1") // remove *italic* markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#[0-9]+;/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ");

  const entries: StalkerEntry[] = [];
  const seen = new Set<string>();

  const MAC_RE = /([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/g;
  const PORTAL_RE = /https?:\/\/[^\s]+(?:\/c\/|\/stalker_portal\/c\/)/gi;

  const portalMatches = [...text.matchAll(new RegExp(PORTAL_RE.source, "gi"))];

  for (const pm of portalMatches) {
    let portal = pm[0].trim().replace(/[*,\s]+$/, "");
    const cIdx = portal.toLowerCase().indexOf("/c/");
    if (cIdx !== -1) portal = portal.substring(0, cIdx + 3);

    const afterPortal = text.substring(pm.index + pm[0].length, pm.index + pm[0].length + 3000);
    const macMatches = [...afterPortal.matchAll(new RegExp(MAC_RE.source, "gi"))];
    const nextPortalIdx = afterPortal.search(/https?:\/\/[^\s]+(?:\/c\/|\/stalker_portal\/c\/)/i);

    for (const mm of macMatches) {
      if (nextPortalIdx !== -1 && mm.index > nextPortalIdx) break;

      const mac = mm[1].toUpperCase();
      const key = `${portal}|${mac}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const afterMac = afterPortal.substring(mm.index + mm[0].length, mm.index + mm[0].length + 60);
      const expMatch = afterMac.match(/(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})/);
      const expDate = expMatch
        ? `${expMatch[1]}-${expMatch[2].padStart(2, "0")}-${expMatch[3].padStart(2, "0")}`
        : undefined;
      const expired = expDate ? new Date(expDate) < new Date() : false;

      entries.push({ portal, mac, expDate, expired });
    }
  }

  return entries;
}

/**
 * Perform Stalker handshake and obtain authentication token.
 */
export async function stalkerHandshake(
  portalUrl: string,
  mac: string,
): Promise<{ base: string; token: string; headers: Record<string, string> }> {
  // Normalize URL
  let base = portalUrl.replace(/\/c\/?$/, "").replace(/\/stalker_portal\/?$/, "");
  try {
    const u = new URL(base);
    base = `${u.protocol}//${u.host}`;
  } catch {
    /* keep as-is */
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
    "X-User-Agent": "Model: MAG270; Link: WiFi",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Cookie: `mac=${mac}; timezone=Africa/Dakar; adid=87072febfaa27239e0f45c7cf383d597`,
    Referer: `${base}/portal.php`,
  };

  const response = await fetchWithTimeout(`${base}/portal.php`, {
    timeoutMs: 10000,
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Handshake failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  const token = data?.js?.token;

  if (!token) {
    throw new Error("Token not received (invalid MAC or portal offline)");
  }

  return {
    base,
    token,
    headers: { ...headers, Authorization: `Bearer ${token}` },
  };
}

/**
 * Fetch live channels from Stalker portal.
 * Filters by FR/AF/SN genres and returns proxy URLs.
 */
export async function stalkerFetchLiveChannels(
  base: string,
  authHeaders: Record<string, string>,
  mac: string,
  portalId: string,
  baseUrl: string,
): Promise<StalkerChannel[]> {
  // Step 1: Get genres
  const genreMap: Record<string, string> = {};
  const frAfGenreIds = new Set<string>();

  try {
    const response = await fetchWithTimeout(`${base}/portal.php`, {
      timeoutMs: 10000,
      method: "GET",
      headers: authHeaders,
    });

    if (response.ok) {
      const data = await response.json();
      const genres = data?.js || [];
      genres.forEach((g: any) => {
        if (!g.id) return;
        const title = g.title || g.name || "";
        genreMap[String(g.id)] = title;
        if (isFrAfStalkerGenre(title)) {
          frAfGenreIds.add(String(g.id));
        }
      });
      console.log(
        `[grab-stalker] FR/AF genres identified (${frAfGenreIds.size}): ${[...frAfGenreIds]
          .slice(0, 5)
          .map((id) => genreMap[id])
          .join(", ")}`,
      );
    }
  } catch (e) {
    console.warn(`[grab-stalker] get_genres failed: ${e}`);
  }

  // Step 2: Get all channels
  const response = await fetchWithTimeout(`${base}/portal.php`, {
    timeoutMs: 60000,
    method: "GET",
    headers: authHeaders,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch channels: HTTP ${response.status}`);
  }

  const data = await response.json();
  const js = data?.js;
  let allChannels: any[] = [];

  if (js?.data && Array.isArray(js.data)) allChannels = js.data;
  else if (Array.isArray(js)) allChannels = js;
  else if (js && typeof js === "object") allChannels = Object.values(js).filter((v: any) => v?.id || v?.cmd);

  console.log(`[grab-stalker] ${allChannels.length} channels fetched`);

  // Step 3: Filter by FR/AF/SN genres
  let filtered: any[];
  if (frAfGenreIds.size > 0) {
    filtered = allChannels.filter((ch) => {
      const gid = String(ch.tv_genre_id || ch.genre_id || "");
      return frAfGenreIds.has(gid);
    });
    console.log(`[grab-stalker] Genre filter applied: ${filtered.length} / ${allChannels.length}`);
  } else {
    filtered = allChannels.filter((ch) => isFrAfStalkerGenre(ch.genre_title || ch.genre || ""));
    console.log(`[grab-stalker] Name filter applied: ${filtered.length} / ${allChannels.length}`);
  }

  // Step 4: Build proxy URLs
  const results: StalkerChannel[] = [];
  for (const ch of filtered) {
    const streamId = String(ch.id || "").split(":")[0];
    if (!streamId) continue;

    const genreId = String(ch.tv_genre_id || ch.genre_id || "");
    const genre = genreMap[genreId] || ch.genre_title || ch.genre || "Stalker Grab";
    const name = ch.name || `Channel ${streamId}`;
    const logo = ch.logo || "";

    // Proxy URL that resolves play_token at runtime
    const url = `${baseUrl}/stalker/play/${portalId}/live/${streamId}`;

    results.push({
      id: streamId,
      name,
      tvgId: streamId,
      tvgLogo: logo,
      group: genre,
      url,
      valid: true,
    });
  }

  console.log(`[grab-stalker] ${results.length} channels ready (proxy URLs generated)`);
  return results;
}

/**
 * Scrape Stalker portals from HTML and collect channels.
 */
export async function scrapeAndFetchStalkerChannels(
  html: string,
  baseUrl: string,
  maxPortals?: number,
): Promise<StalkerChannel[]> {
  const entries = extractStalkerEntries(html);
  const active = entries.filter((e) => !e.expired);
  const toTest = active.length > 0 ? active : entries;

  console.log(`[grab-stalker] ${entries.length} MAC(s) found — ${active.length} not expired`);

  const allChannels: StalkerChannel[] = [];
  let count = 0;

  for (let i = 0; i < toTest.length; i++) {
    if (maxPortals && count >= maxPortals) {
      console.log(`[grab-stalker] Max portals reached (${count}/${maxPortals})`);
      break;
    }

    const { portal, mac, expDate } = toTest[i];
    console.log(
      `[grab-stalker] Testing MAC ${i + 1}/${toTest.length}: ${mac} → ${portal}${expDate ? ` (exp: ${expDate})` : ""}`,
    );

    try {
      const { base, token, headers } = await stalkerHandshake(portal, mac);
      const portalId = `stalker_${mac.replace(/:/g, "_")}`;

      const channels = await stalkerFetchLiveChannels(base, headers, mac, portalId, baseUrl);

      if (channels.length === 0) {
        console.log(`[grab-stalker] No FR/AF channels found`);
        continue;
      }

      console.log(`[grab-stalker] ✓ ${channels.length} channels retrieved`);
      allChannels.push(...channels);
      count++;
    } catch (e) {
      console.warn(`[grab-stalker] Error: ${e}`);
    }
  }

  console.log(
    `[grab-stalker] Total: ${count} portals with FR/AF channels — ${allChannels.length} channels`,
  );
  return allChannels;
}
