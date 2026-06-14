"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Clock, Search, X } from "lucide-react";
import { usePrefs } from "@/lib/store";

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function SearchInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Search channels…",
  className,
  inputClassName,
}: SearchInputProps) {
  const recentSearches = usePrefs((s) => s.recentSearches);
  const clearRecentSearches = usePrefs((s) => s.clearRecentSearches);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const showRecents = open && !value.trim() && recentSearches.length > 0;

  return (
    <div ref={wrapRef} className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit?.(value.trim());
        }}
        placeholder={placeholder}
        className={clsx(
          "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] pl-9 pr-8 text-sm text-fg placeholder:text-fg-subtle outline-none transition focus:border-[var(--accent)] md:focus:w-64",
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {showRecents && (
        <div
          id="recent-searches-list"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-xl"
        >
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              <Clock className="h-3 w-3" />
              Recent
            </span>
            <button
              type="button"
              onClick={clearRecentSearches}
              className="text-[10px] font-medium text-accent hover:underline"
            >
              Clear
            </button>
          </div>
          {recentSearches.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => {
                onChange(term);
                onSubmit?.(term);
                setOpen(false);
              }}
              className="block w-full truncate px-3 py-2 text-left text-sm text-fg hover:bg-white/5"
            >
              {term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
