import fs from "node:fs";
import { parseM3U } from "../src/lib/m3u-parser";
import type { RawStreamEntry, SourceFeed } from "./types";
import { sanitizeName, fetchWithTimeout, writeJsonFile, readJsonFile } from "./utils";
import { dataPath, pipelinePath } from "./paths";
import { grabFromUrl } from "./grab";

export async function discoverStreams(): Promise<RawStreamEntry[]> {
  const feeds = readJsonFile<SourceFeed[]>(dataPath("source-registry.json"));
  const all: RawStreamEntry[] = [];
  const seenUrls = new Set<string>();

  for (const feed of feeds) {
    // Handle grab-type feeds
    if (feed.type.startsWith('scrape_')) {
      console.log(`[discover] Grabbing from ${feed.name}...`);
      try {
        const grabResult = await grabFromUrl(feed);
        const playlists = grabResult.validatedPlaylists;

        if (playlists.length === 0) {
          console.warn(`[discover] ${feed.id}: no working playlists found`);
          continue;
        }

        console.log(
          `[discover] ${feed.id}: using ${playlists.length} validated playlist(s)`,
        );

        for (const playlist of playlists) {
          if (seenUrls.has(playlist.m3uUrl)) continue;

          try {
            const response = await fetchWithTimeout(playlist.m3uUrl, { timeoutMs: 30000 });
            if (!response.ok) continue;

            const content = await response.text();
            if (!content.includes("#EXTINF")) continue;

            const parsed = parseM3U(content);
            const limit = feed.maxChannels ?? parsed.length;
            const isBdix = feed.region === "bdix";
            const groupLabel =
              playlist.source === "xtream" && playlist.portal
                ? `Xtream: ${playlist.portal}`
                : `Grab: ${feed.name}`;

            for (const ch of parsed.slice(0, limit)) {
              if (seenUrls.has(ch.url)) continue;
              seenUrls.add(ch.url);

              all.push({
                name: sanitizeName(ch.name),
                url: ch.url,
                logo: ch.logo,
                group: ch.group || groupLabel,
                tvgId: ch.tvgId,
                feedId: feed.id,
                feedRegion: feed.region,
                isBdix,
              });
            }

            seenUrls.add(playlist.m3uUrl);
            console.log(
              `[discover] ${feed.id} (${playlist.source}): ${Math.min(limit, parsed.length)} streams from validated playlist`,
            );
          } catch {
            console.warn(
              `[discover] Failed to fetch validated playlist ${playlist.m3uUrl.substring(0, 50)}...`,
            );
          }
        }
        
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[discover] ${feed.id} grab failed: ${msg}`);
      }
      
      continue;
    }
    
    // Handle regular M3U feeds
    console.log(`[discover] Fetching ${feed.name}...`);
    try {
      const response = await fetchWithTimeout(feed.url, { timeoutMs: 45000 });
      if (!response.ok) {
        console.warn(`[discover] ${feed.id} HTTP ${response.status}`);
        continue;
      }

      const content = await response.text();
      if (!content.includes("#EXTINF")) {
        console.warn(`[discover] ${feed.id} invalid M3U`);
        continue;
      }

      const parsed = parseM3U(content);
      const limit = feed.maxChannels ?? parsed.length;
      const isBdix = feed.region === "bdix";

      for (const ch of parsed.slice(0, limit)) {
        if (seenUrls.has(ch.url)) continue;
        seenUrls.add(ch.url);

        all.push({
          name: sanitizeName(ch.name),
          url: ch.url,
          logo: ch.logo,
          group: ch.group,
          tvgId: ch.tvgId,
          feedId: feed.id,
          feedRegion: feed.region,
          isBdix,
        });
      }

      console.log(
        `[discover] ${feed.id}: ${Math.min(limit, parsed.length)} streams`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[discover] ${feed.id} failed: ${msg}`);
    }
  }

  return all;
}

export async function runDiscover(): Promise<number> {
  fs.mkdirSync(pipelinePath(), { recursive: true });
  const streams = await discoverStreams();
  writeJsonFile(pipelinePath("raw-streams.json"), {
    discoveredAt: new Date().toISOString(),
    count: streams.length,
    streams,
  });
  console.log(`[discover] Saved ${streams.length} raw streams`);
  return streams.length;
}

if (import.meta.url.startsWith("file:")) {
  const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
  if (scriptPath.endsWith("discover.ts") || scriptPath.endsWith("discover.js")) {
    runDiscover().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
