"use client";

import { useRef } from "react";
import clsx from "clsx";
import type { CategoryInfo } from "@/lib/types";

interface CategoryTabsProps {
  categories: CategoryInfo[];
  active: string;
  onChange: (id: string) => void;
}

export function CategoryTabs({
  categories,
  active,
  onChange,
}: CategoryTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; scrollLeft: number; moved: boolean } | null>(
    null,
  );

  // wheel: translate vertical scroll into horizontal so a mouse/trackpad can
  // navigate the chip bar.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  // pointer drag-to-scroll (desktop + touch)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !drag.current) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    el.scrollLeft = drag.current.scrollLeft - dx;
  };
  const endDrag = () => {
    drag.current = null;
  };
  const tabs = [
    { id: "all", label: "All", order: -1, count: 0 },
    { id: "bdix", label: "BDIX", order: 0, count: 0 },
    ...categories,
  ];

  return (
    <div
      ref={scrollRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      className="no-scrollbar -mx-1 flex cursor-grab items-center gap-2 overflow-x-auto px-1 py-1 active:cursor-grabbing"
    >
      {tabs.map((cat) => {
        const isActive = active === cat.id;
        const count =
          "count" in cat && cat.id !== "all" && cat.id !== "bdix" && cat.count > 0
            ? cat.count
            : null;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => {
              if (drag.current?.moved) return;
              onChange(cat.id);
            }}
            aria-pressed={isActive}
            className={clsx(
              "focusable inline-flex shrink-0 items-center gap-2 rounded-full py-2 pl-4 text-sm font-medium transition-all duration-200",
              count !== null ? "pr-2" : "pr-4",
              isActive
                ? "bg-accent text-[var(--accent-contrast)] shadow-[0_2px_12px_var(--accent-soft)]"
                : "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-[var(--border)] hover:bg-white/10 hover:text-fg",
            )}
          >
            <span className="whitespace-nowrap leading-none">{cat.label}</span>
            {count !== null && (
              <span
                className={clsx(
                  "inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
                  isActive
                    ? "bg-black/15 text-[var(--accent-contrast)]"
                    : "bg-white/10 text-fg-subtle",
                )}
              >
                {count > 999 ? `${(count / 1000).toFixed(1)}k` : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
