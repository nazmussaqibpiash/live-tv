"use client";

import { useEffect, useRef } from "react";
import { Check, Monitor, Moon, Sun, Trash2, X } from "lucide-react";
import clsx from "clsx";
import {
  usePrefs,
  type AccentColor,
  type ThemeMode,
} from "@/lib/store";

const THEMES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "dark", label: "Dark", icon: Moon },
  { id: "oled", label: "OLED", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
];

const ACCENTS: { id: AccentColor; color: string; label: string }[] = [
  { id: "cyan", color: "#22d3ee", label: "Cyan" },
  { id: "violet", color: "#a78bfa", label: "Violet" },
  { id: "emerald", color: "#34d399", label: "Emerald" },
  { id: "rose", color: "#fb7185", label: "Rose" },
  { id: "amber", color: "#fbbf24", label: "Amber" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
        {title}
      </h3>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 ease-out",
        "ring-1 ring-inset",
        checked
          ? "bg-accent ring-transparent shadow-[0_0_0_3px_var(--accent-soft)]"
          : "bg-[var(--bg)] ring-[var(--border-strong)]",
      )}
    >
      <span
        className={clsx(
          "absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-300 ease-out",
          checked
            ? "left-1 translate-x-5 scale-100"
            : "left-1 translate-x-0 scale-90",
        )}
      />
    </button>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const {
    theme,
    accent,
    contrast,
    player,
    history,
    favorites,
    setTheme,
    setAccent,
    setContrast,
    setPlayerPref,
    clearHistory,
  } = usePrefs();

  // close on Escape + lock body scroll
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[400px] flex-col bg-[var(--bg-elevated)] shadow-2xl animate-fade-in outline-none"
      >
        {/* header */}
        <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 id="settings-title" className="text-lg font-bold">
              Settings
            </h2>
            <p className="text-xs text-fg-subtle">
              {favorites.length} favorites · {history.length} recent
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-fg-muted transition hover:bg-white/10 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* scrollable body */}
        <div className="flex-1 overflow-y-auto scroll-area px-4 py-4">
          <Section title="Appearance">
            <Row label="Theme">
              <div className="flex gap-1 rounded-xl bg-[var(--bg)] p-1">
                {THEMES.map((t) => {
                  const Icon = t.icon;
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTheme(t.id)}
                      className={clsx(
                        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                        active
                          ? "bg-accent text-[var(--accent-contrast)]"
                          : "text-fg-muted hover:text-fg",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Row>

            <Row label="Accent color">
              <div className="flex gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAccent(a.id)}
                    aria-label={a.label}
                    className={clsx(
                      "flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-[var(--bg-elevated)] transition",
                      accent === a.id ? "ring-white" : "ring-transparent",
                    )}
                    style={{ background: a.color }}
                  >
                    {accent === a.id && (
                      <Check className="h-4 w-4 text-black/70" />
                    )}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="High contrast" hint="Better visibility & accessibility">
              <Toggle
                checked={contrast === "high"}
                onChange={(v) => setContrast(v ? "high" : "normal")}
                label="High contrast"
              />
            </Row>
          </Section>

          <Section title="Player">
            <Row label="Default quality">
              <select
                value={player.defaultQuality}
                onChange={(e) =>
                  setPlayerPref(
                    "defaultQuality",
                    e.target.value as typeof player.defaultQuality,
                  )
                }
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs font-medium text-fg outline-none focus:border-[var(--accent)]"
              >
                <option value="auto">Auto</option>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>
            </Row>
            <Row label="Autoplay" hint="Start playing on channel select">
              <Toggle
                checked={player.autoplay}
                onChange={(v) => setPlayerPref("autoplay", v)}
                label="Autoplay"
              />
            </Row>
            <Row label="Start muted">
              <Toggle
                checked={player.startMuted}
                onChange={(v) => setPlayerPref("startMuted", v)}
                label="Start muted"
              />
            </Row>
            <Row label="Remember last source" hint="Resume from working stream">
              <Toggle
                checked={player.rememberSource}
                onChange={(v) => setPlayerPref("rememberSource", v)}
                label="Remember last source"
              />
            </Row>
          </Section>

          <Section title="Data">
            <Row label="Watch history" hint={`${history.length} channels remembered`}>
              <button
                type="button"
                onClick={clearHistory}
                disabled={history.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-fg-muted transition enabled:hover:bg-[var(--offline)]/15 enabled:hover:text-[var(--offline)] disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            </Row>
          </Section>
        </div>

        <footer className="border-t border-[var(--border)] px-5 py-3 text-center text-[10px] text-fg-subtle">
          Live TV · Auto-maintained catalog
        </footer>
      </aside>
    </div>
  );
}
