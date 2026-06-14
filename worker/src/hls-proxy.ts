/** HLS proxy helpers for the Cloudflare Worker (mirrors Next.js route logic). */

export function isBlockedProxyTarget(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return true;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1")
      return true;
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const a = Number(v4[1]);
      const b = Number(v4[2]);
      if (a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
    }
    if (host === "169.254.169.254") return true;
    return false;
  } catch {
    return true;
  }
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

export function rewriteM3u8(
  content: string,
  streamUrl: string,
  proxyOrigin: string,
): string {
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

export function isManifestUrl(url: string, contentType: string): boolean {
  return (
    url.includes(".m3u8") ||
    url.includes("m3u8") ||
    url.includes(".m3u") ||
    contentType.includes("mpegurl") ||
    contentType.includes("m3u")
  );
}
