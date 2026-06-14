/** Block SSRF targets: localhost, private/link-local IP ranges, cloud metadata. */
export function isBlockedProxyTarget(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return true;

    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "0.0.0.0" ||
      host === "[::]" ||
      host === "::1"
    ) {
      return true;
    }

    // IPv4 private / link-local / metadata
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [, a, b] = v4.map(Number);
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    }

    // cloud metadata endpoints
    if (host === "169.254.169.254" || host === "metadata.google.internal") {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}
