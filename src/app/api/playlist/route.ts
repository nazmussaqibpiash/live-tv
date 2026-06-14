import { NextRequest, NextResponse } from "next/server";
import { parseM3U } from "@/lib/m3u-parser";
import { isBlockedProxyTarget } from "@/lib/proxy-security";
import type { ParsedPlaylist } from "@/lib/types";

const FETCH_TIMEOUT_MS = 30_000;

function isValidPlaylistUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !isBlockedProxyTarget(url)
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url || !isValidPlaylistUrl(url)) {
    return NextResponse.json(
      { error: "Valid playlist URL is required." },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "LiveTV-Web/1.0",
        Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Playlist fetch failed (${response.status}).` },
        { status: 502 },
      );
    }

    const content = await response.text();

    if (!content.includes("#EXTM3U") && !content.includes("#EXTINF:")) {
      return NextResponse.json(
        { error: "Invalid M3U playlist format." },
        { status: 422 },
      );
    }

    const channels = parseM3U(content);

    const payload: ParsedPlaylist = {
      channels,
      playlistUrl: url,
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Playlist fetch timed out."
        : "Could not load playlist.";

    return NextResponse.json({ error: message }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}
