import { NextRequest, NextResponse } from "next/server";
import { isBlockedProxyTarget } from "@/lib/proxy-security";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const FETCH_TIMEOUT_MS = 25_000;

const REFERER_RULES: Record<string, { Referer: string; Origin?: string }> = {
  "akamaized.net": { Referer: "https://www.akamai.com/", Origin: "https://www.akamai.com" },
  "cloudfront.net": { Referer: "https://www.google.com/", Origin: "https://www.google.com" },
  "fastly.net": { Referer: "https://www.google.com/" },
  "youtube.com": { Referer: "https://www.youtube.com/", Origin: "https://www.youtube.com" },
  "googlevideo.com": { Referer: "https://www.youtube.com/", Origin: "https://www.youtube.com" },
  "twitch.tv": { Referer: "https://www.twitch.tv/", Origin: "https://www.twitch.tv" },
};

function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return ALLOWED_PROTOCOLS.has(u.protocol) && !isBlockedProxyTarget(raw);
  } catch {
    return false;
  }
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

function headersForUrl(target: string): HeadersInit {
  const host = new URL(target).hostname;
  const base = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "*/*",
  };

  for (const [domain, extra] of Object.entries(REFERER_RULES)) {
    if (host.includes(domain)) {
      return { ...base, ...extra };
    }
  }

  const origin = new URL(target).origin;
  return {
    ...base,
    Referer: `${origin}/`,
    Origin: origin,
  };
}

function rewriteM3u8(content: string, streamUrl: string, proxyOrigin: string): string {
  const base = streamUrl.includes("/")
    ? streamUrl.substring(0, streamUrl.lastIndexOf("/") + 1)
    : streamUrl;

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_, uri: string) => {
            const absolute = resolveUrl(base, uri);
            return `URI="${proxyOrigin}/api/hls-proxy?url=${encodeURIComponent(absolute)}"`;
          });
        }
        return line;
      }
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return `${proxyOrigin}/api/hls-proxy?url=${encodeURIComponent(trimmed)}`;
      }
      const absolute = resolveUrl(base, trimmed);
      return `${proxyOrigin}/api/hls-proxy?url=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}

async function fetchUpstream(target: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let response = await fetch(target, {
      signal: controller.signal,
      headers: headersForUrl(target),
      redirect: "follow",
    });

    if (response.status === 403 || response.status === 401) {
      response = await fetch(target, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "*/*",
          Referer: "https://www.google.com/",
        },
        redirect: "follow",
      });
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const limited = rateLimit(`hls:${ip}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const target = request.nextUrl.searchParams.get("url");

  if (!target || !isAllowedUrl(target)) {
    return NextResponse.json({ error: "Valid url parameter required" }, { status: 400 });
  }

  try {
    const upstream = await fetchUpstream(target);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream HTTP ${upstream.status}` },
        { status: upstream.status === 403 ? 403 : 502 },
      );
    }

    const contentType =
      upstream.headers.get("Content-Type") ?? "application/octet-stream";
    const isManifest =
      target.includes(".m3u8") ||
      target.includes("m3u8") ||
      target.includes(".m3u") ||
      contentType.includes("mpegurl") ||
      contentType.includes("m3u");

    if (isManifest) {
      const text = await upstream.text();
      const origin = request.nextUrl.origin;
      const rewritten = rewriteM3u8(text, target, origin);

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store",
        },
      });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=120",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Upstream timeout"
        : "Proxy fetch failed";
    return NextResponse.json({ error: message }, { status: 504 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
