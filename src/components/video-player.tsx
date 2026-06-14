"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls, { type Level } from "hls.js";
import {
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react";
import clsx from "clsx";
import type { ChannelSource, ChannelStatus } from "@/lib/types";
import { HLS_CONFIG, STARTUP_TIMEOUT_MS } from "@/lib/hls-config";
import { track } from "@/lib/analytics";

interface VideoPlayerProps {
  sources: ChannelSource[];
  title: string;
  poster?: string;
  channelId: string;
  proxyBase?: string;
  initialSourceIndex?: number;
  autoplay?: boolean;
  startMuted?: boolean;
  /** full-bleed (no rounding/ring) for immersive mobile hero */
  fullBleed?: boolean;
  /**
   * When false, the player is hidden/inactive (e.g. user switched to another
   * mobile tab). We pause playback so audio doesn't keep playing from a hidden
   * <video> ("sound only" bug). Defaults to true.
   */
  active?: boolean;
  /** preferred starting quality from settings */
  defaultQuality?: "auto" | "1080p" | "720p" | "480p";
  /** channel health — drives LIVE badge accuracy */
  channelStatus?: ChannelStatus;
  onSourceChange?: (source: ChannelSource, index: number) => void;
  onAllSourcesFailed?: () => void;
}

type PlayStatus = "idle" | "loading" | "playing" | "error";

function buildPlayUrl(src: string, proxyBase?: string): string {
  if (!proxyBase) return src;
  return `${proxyBase}?url=${encodeURIComponent(src)}`;
}

function isHlsUrl(url: string): boolean {
  return (
    url.includes(".m3u8") ||
    url.includes("m3u8") ||
    url.includes("/hls/") ||
    url.includes("playlist.m3u")
  );
}

function levelLabel(level: Level): string {
  if (level.height) return `${level.height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)}k`;
  return "auto";
}

/** Map settings pref to the closest HLS level index. */
function levelForQuality(
  levels: Level[],
  pref: "1080p" | "720p" | "480p",
): number {
  const target = { "1080p": 1080, "720p": 720, "480p": 480 }[pref];
  let best = -1;
  let bestDiff = Infinity;
  levels.forEach((lvl, i) => {
    const h = lvl.height ?? 0;
    if (h === 0) return;
    const diff = Math.abs(h - target);
    if (diff < bestDiff || (diff === bestDiff && h > (levels[best]?.height ?? 0))) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

export function VideoPlayer(props: VideoPlayerProps) {
  return <PlayerInner {...props} />;
}

function PlayerInner({
  sources,
  title,
  poster,
  channelId,
  proxyBase,
  initialSourceIndex = 0,
  autoplay = true,
  startMuted = false,
  onSourceChange,
  fullBleed = false,
  active = true,
  defaultQuality = "auto",
  channelStatus = "active",
  onAllSourcesFailed,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(true);
  const mediaRecoverRef = useRef(0);
  const hideControlsRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sourceIndex, setSourceIndex] = useState(initialSourceIndex);
  const [status, setStatus] = useState<PlayStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(startMuted);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [showQuality, setShowQuality] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [showUnmuteHint, setShowUnmuteHint] = useState(false);

  const activeSource = sources[sourceIndex];

  const sourceIndexRef = useRef(sourceIndex);
  const onAllSourcesFailedRef = useRef(onAllSourcesFailed);
  const onSourceChangeRef = useRef(onSourceChange);

  useEffect(() => {
    sourceIndexRef.current = sourceIndex;
    onAllSourcesFailedRef.current = onAllSourcesFailed;
    onSourceChangeRef.current = onSourceChange;
  });

  const reportFailure = useCallback(
    (source: ChannelSource, error: string) => {
      void fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, sourceId: source.id, error }),
      }).catch(() => undefined);
      track("play_error", { channelId, error });
    },
    [channelId],
  );

  const tryNextSource = useCallback(() => {
    const prev = sourceIndexRef.current;
    const next = prev + 1;
    if (next >= sources.length) {
      setStatus("error");
      setErrorMessage(
        "All sources failed to play. Try again or check back later.",
      );
      queueMicrotask(() => onAllSourcesFailedRef.current?.());
      return;
    }
    setSourceIndex(next);
  }, [sources.length]);

  const retry = useCallback(() => {
    mediaRecoverRef.current = 0;
    setErrorMessage(null);
    setStatus("loading");
    setSourceIndex(0);
    setRetryKey((k) => k + 1);
  }, []);

  // ---- core load + recovery lifecycle ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSource?.url) return;

    setStatus("loading");
    loadingRef.current = true;
    setErrorMessage(null);
    setIsPlaying(false);
    setLevels([]);
    setCurrentLevel(-1);
    video.muted = startMuted;
    setIsMuted(startMuted);

    const clearFailTimer = () => {
      if (failTimerRef.current) {
        clearTimeout(failTimerRef.current);
        failTimerRef.current = null;
      }
    };

    failTimerRef.current = setTimeout(() => {
      if (loadingRef.current) {
        reportFailure(activeSource, "Startup timeout");
        tryNextSource();
      }
    }, STARTUP_TIMEOUT_MS);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const src = buildPlayUrl(activeSource.url, proxyBase);
    queueMicrotask(() => {
      onSourceChangeRef.current?.(activeSource, sourceIndexRef.current);
    });

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onPlaying = () => {
      clearFailTimer();
      loadingRef.current = false;
      setStatus("playing");
    };
    const onWaiting = () => {
      if (status === "playing") setStatus("loading");
    };
    const onCanPlay = () => {
      if (loadingRef.current) {
        clearFailTimer();
        loadingRef.current = false;
        setStatus("playing");
      }
    };
    const onVideoError = () => {
      clearFailTimer();
      reportFailure(activeSource, "Video element error");
      tryNextSource();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onVideoError);

    const startPlayback = () => {
      const p = video.play();
      if (p) {
        p.catch(() => {
          video.muted = true;
          setIsMuted(true);
          setShowUnmuteHint(true);
          void video.play().catch(() => setStatus("idle"));
        });
      }
    };

    const useHlsJs = isHlsUrl(activeSource.url) && Hls.isSupported();

    if (useHlsJs) {
      const hls = new Hls(HLS_CONFIG);
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        const lvls = data.levels ?? [];
        setLevels(lvls);
        if (defaultQuality !== "auto" && lvls.length > 0) {
          const idx = levelForQuality(lvls, defaultQuality);
          if (idx >= 0) {
            hls.currentLevel = idx;
            setCurrentLevel(idx);
          }
        }
        if (autoplay) startPlayback();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setCurrentLevel(hls.autoLevelEnabled ? -1 : data.level);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoverRef.current === 0) {
            mediaRecoverRef.current = 1;
            hls.recoverMediaError();
          } else if (mediaRecoverRef.current === 1) {
            mediaRecoverRef.current = 2;
            hls.swapAudioCodec();
            hls.recoverMediaError();
          } else {
            clearFailTimer();
            reportFailure(activeSource, `HLS media fatal`);
            tryNextSource();
          }
        } else {
          clearFailTimer();
          reportFailure(activeSource, `HLS fatal: ${data.type}`);
          tryNextSource();
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener(
        "loadedmetadata",
        () => autoplay && startPlayback(),
        { once: true },
      );
    } else {
      video.src = src;
      video.addEventListener(
        "loadeddata",
        () => autoplay && startPlayback(),
        { once: true },
      );
    }

    return () => {
      clearFailTimer();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onVideoError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, proxyBase, sourceIndex, retryKey]);

  // ---- fullscreen state sync ----
  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Pause when the player becomes inactive (hidden behind another mobile tab)
  // so we never have a hidden <video> playing audio only. Resume when active
  // again unless the user had paused manually.
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      wasPlayingRef.current = !video.paused;
      video.pause();
    } else if (wasPlayingRef.current) {
      void video.play().catch(() => undefined);
    }
  }, [active]);

  // Live drift recovery: after the tab is backgrounded, a live stream keeps
  // buffering and the user returns far behind the live edge. On re-focus, jump
  // back to the live edge (and resume if it wasn't a manual pause).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const video = videoRef.current;
      const hls = hlsRef.current;
      if (!video) return;
      try {
        if (hls?.liveSyncPosition != null) {
          video.currentTime = hls.liveSyncPosition;
        } else if (video.seekable.length) {
          video.currentTime = video.seekable.end(video.seekable.length - 1);
        }
      } catch {
        /* seeking not allowed yet */
      }
      if (active && wasPlayingRef.current) {
        void video.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active]);

  // ---- auto-hide controls ----
  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideControlsRef.current) clearTimeout(hideControlsRef.current);
    hideControlsRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const changeVolume = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
    setVolume(v);
    setIsMuted(v === 0);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen().catch(() => undefined);
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      /* PiP not available */
    }
  }, []);

  // Track PiP state so the UI can offer a clear "Return to player" affordance
  // (users often trigger PiP by accident and can't find their way back).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  const selectLevel = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (hls) {
      hls.currentLevel = index;
      setCurrentLevel(index);
    }
    setShowQuality(false);
  }, []);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "p":
          void togglePip();
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min(1, video.volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max(0, video.volume - 0.1));
          break;
      }
      bumpControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleMute, toggleFullscreen, togglePip, changeVolume, bumpControls]);

  const qualityText = useMemo(() => {
    if (currentLevel === -1) return "Auto";
    const lvl = levels[currentLevel];
    return lvl ? levelLabel(lvl) : "Auto";
  }, [currentLevel, levels]);

  if (!sources.length) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl bg-black text-sm text-fg-subtle">
        No source available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={clsx(
        "group relative aspect-video w-full overflow-hidden bg-black",
        fullBleed
          ? "rounded-none"
          : "rounded-2xl shadow-[var(--shadow)] ring-1 ring-[var(--border)]",
      )}
      onMouseMove={bumpControls}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onTouchStart={bumpControls}
    >
      <video
        ref={videoRef}
        className="h-full w-full bg-black object-contain"
        poster={poster}
        playsInline
        controls={false}
        title={title}
        onClick={togglePlay}
      />

      {/* LIVE badge (top-left) — only for active/degraded channels */}
      {channelStatus !== "offline" && (
      <div
        className={clsx(
          "pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-md bg-black/55 px-2.5 py-1 backdrop-blur-sm transition-opacity duration-300",
          showControls || !isPlaying ? "opacity-100" : "opacity-0",
        )}
      >
        <span
          className={clsx(
            "h-1.5 w-1.5 rounded-full",
            channelStatus === "active" && status === "playing"
              ? "animate-pulse bg-[var(--live)]"
              : channelStatus === "degraded"
                ? "bg-[var(--degraded)]"
                : "bg-zinc-400",
          )}
        />
        <span className="text-[11px] font-bold uppercase tracking-wide text-white">
          {channelStatus === "active" ? "Live" : channelStatus === "degraded" ? "Unstable" : "Offline"}
        </span>
      </div>
      )}

      {showUnmuteHint && isMuted && (
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (v) {
              v.muted = false;
              setIsMuted(false);
              setShowUnmuteHint(false);
              void v.play();
            }
          }}
          className="absolute inset-x-4 top-1/2 z-30 -translate-y-1/2 rounded-xl bg-black/75 px-4 py-3 text-center text-sm font-semibold text-white backdrop-blur-sm"
        >
          Tap to unmute
        </button>
      )}

      {/* PiP active: the <video> is detached to a floating window, so the inline
          area is blank. Offer a clear way back so users aren't stranded. */}
      {isPip && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <PictureInPicture2 className="h-10 w-10 text-accent" />
          <p className="text-sm font-medium text-white">
            Playing in Picture-in-Picture
          </p>
          <button
            type="button"
            onClick={togglePip}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)]"
          >
            <PictureInPicture2 className="h-4 w-4" />
            Return to player
          </button>
        </div>
      )}

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
          <p className="text-sm text-zinc-200">
            Loading… source {sourceIndex + 1}/{sources.length}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center">
          <p className="text-sm font-medium text-[var(--offline)]">
            Playback error
          </p>
          <p className="max-w-sm text-xs text-zinc-400">{errorMessage}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-1 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)]"
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
        </div>
      )}

      {/* Quality menu */}
      {showQuality && levels.length > 0 && (
        <div className="absolute bottom-20 right-4 z-20 w-32 overflow-hidden rounded-xl border border-[var(--border)] bg-black/90 backdrop-blur-md">
          <button
            type="button"
            onClick={() => selectLevel(-1)}
            className={clsx(
              "flex w-full items-center justify-between px-3 py-2 text-xs",
              currentLevel === -1 ? "text-accent" : "text-zinc-300 hover:bg-white/10",
            )}
          >
            Auto
          </button>
          {levels.map((lvl, i) => (
            <button
              key={i}
              type="button"
              onClick={() => selectLevel(i)}
              className={clsx(
                "flex w-full items-center justify-between px-3 py-2 text-xs",
                currentLevel === i ? "text-accent" : "text-zinc-300 hover:bg-white/10",
              )}
            >
              {levelLabel(lvl)}
            </button>
          ))}
        </div>
      )}

      <div
        className={clsx(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-4 pt-12 transition-opacity duration-300",
          showControls || !isPlaying ? "opacity-100" : "opacity-0",
        )}
      >
        <p className="mb-3 truncate text-sm font-semibold text-white md:text-base">
          {title}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="h-5 w-5 fill-current pl-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={toggleMute}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
            className="hidden h-1 w-20 cursor-pointer accent-[var(--accent)] sm:block"
          />

          <div className="flex-1" />

          {levels.length > 0 && (
            <button
              type="button"
              onClick={() => setShowQuality((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/20"
              aria-label="Quality"
            >
              <Settings2 className="h-4 w-4" />
              {qualityText}
            </button>
          )}

          {typeof document !== "undefined" && "pictureInPictureEnabled" in document && (
            <button
              type="button"
              onClick={togglePip}
              aria-label="Picture in picture"
              aria-pressed={isPip}
              className={clsx(
                "hidden h-11 w-11 items-center justify-center rounded-full transition sm:flex",
                isPip
                  ? "bg-accent text-[var(--accent-contrast)]"
                  : "bg-white/10 text-white hover:bg-white/20",
              )}
            >
              <PictureInPicture2 className="h-5 w-5" />
            </button>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            aria-label="Fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="h-5 w-5" />
            ) : (
              <Maximize2 className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
