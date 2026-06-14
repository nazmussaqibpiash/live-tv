import type { HlsConfig } from "hls.js";

/**
 * hls.js best-practice config for live IPTV:
 * - capLevelToPlayerSize: never pull 4K into a small box
 * - conservative ABR upshift (0.7) to avoid rebuffers
 * - generous fragment/manifest retries for flaky public streams
 * - lowLatencyMode for LL-HLS where supported
 */
export const HLS_CONFIG: Partial<HlsConfig> = {
  enableWorker: true,
  lowLatencyMode: true,
  capLevelToPlayerSize: true,
  abrBandWidthFactor: 0.95,
  abrBandWidthUpFactor: 0.7,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  backBufferLength: 30,
  fragLoadingMaxRetry: 4,
  manifestLoadingMaxRetry: 3,
  levelLoadingMaxRetry: 4,
  fragLoadingRetryDelay: 800,
  manifestLoadingRetryDelay: 800,
};

export const STARTUP_TIMEOUT_MS = 14000;
