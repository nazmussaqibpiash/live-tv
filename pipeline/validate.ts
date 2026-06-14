import type { ValidationResult } from "./types";
import { fetchWithTimeout, runPool } from "./utils";

const VALIDATE_CONCURRENCY = Number(process.env.VALIDATE_CONCURRENCY ?? 25);
const VALIDATE_TIMEOUT_MS = Number(process.env.VALIDATE_TIMEOUT_MS ?? 8000);
const SLOW_THRESHOLD_MS = 5000;

export async function validateStreamUrl(url: string): Promise<ValidationResult> {
  const start = Date.now();

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      url,
      status: "invalid",
      latencyMs: 0,
      errorMsg: "Invalid URL scheme",
    };
  }

  try {
    let response = await fetchWithTimeout(url, {
      method: "HEAD",
      timeoutMs: VALIDATE_TIMEOUT_MS,
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(url, {
        method: "GET",
        timeoutMs: VALIDATE_TIMEOUT_MS,
        headers: { Range: "bytes=0-1024" },
      });
    }

    const latencyMs = Date.now() - start;

    if (response.status === 403 || response.status === 401) {
      return {
        url,
        status: "geo_blocked",
        latencyMs,
        httpCode: response.status,
        errorMsg: "Geo-blocked or forbidden",
      };
    }

    if (!response.ok) {
      return {
        url,
        status: "dead",
        latencyMs,
        httpCode: response.status,
        errorMsg: `HTTP ${response.status}`,
      };
    }

    const isHls = url.includes(".m3u8") || url.includes("m3u8");
    if (isHls) {
      const body = await fetchWithTimeout(url, {
        method: "GET",
        timeoutMs: VALIDATE_TIMEOUT_MS,
      }).then((r) => r.text());

      if (!body.includes("#EXTM3U") && !body.includes("#EXTINF")) {
        return {
          url,
          status: "invalid",
          latencyMs: Date.now() - start,
          errorMsg: "Not a valid HLS manifest",
        };
      }
    }

    if (latencyMs > SLOW_THRESHOLD_MS) {
      return {
        url,
        status: "slow",
        latencyMs,
        httpCode: response.status,
      };
    }

    return {
      url,
      status: "ok",
      latencyMs,
      httpCode: response.status,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("abort"));

    return {
      url,
      status: isTimeout ? "timeout" : "dead",
      latencyMs,
      errorMsg: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function validateUrls(
  urls: string[],
): Promise<Map<string, ValidationResult>> {
  const unique = [...new Set(urls)];
  console.log(
    `[validate] Checking ${unique.length} URLs (concurrency ${VALIDATE_CONCURRENCY})...`,
  );

  const results = await runPool(unique, VALIDATE_CONCURRENCY, (url) =>
    validateStreamUrl(url),
  );

  const map = new Map<string, ValidationResult>();
  for (const r of results) map.set(r.url, r);

  const ok = [...map.values()].filter((v) =>
    ["ok", "slow", "geo_blocked"].includes(v.status),
  ).length;
  console.log(`[validate] OK/slow/geo: ${ok}/${unique.length}`);

  return map;
}
