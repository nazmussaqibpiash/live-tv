import { describe, it, expect } from "vitest";
import { filterCatalog } from "../src/lib/catalog";
import type { ApiChannel, CatalogPayload } from "../src/lib/types";

function ch(
  id: string,
  name: string,
  extra: Partial<ApiChannel> = {},
): ApiChannel {
  return {
    id,
    name,
    category: extra.category ?? "entertainment",
    status: extra.status ?? "active",
    isBdix: extra.isBdix ?? false,
    sources: extra.sources ?? [
      {
        id: `${id}-s`,
        url: `http://x/${id}.m3u8`,
        rankScore: 50,
        isPrimary: true,
      },
    ],
    group: extra.group,
    tvgId: extra.tvgId,
  };
}

function catalog(channels: ApiChannel[]): CatalogPayload {
  return {
    version: "test",
    generatedAt: new Date().toISOString(),
    stats: {
      totalChannels: channels.length,
      activeChannels: channels.length,
      degradedChannels: 0,
      totalSources: channels.length,
      validatedSources: channels.length,
    },
    categories: [],
    channels,
  };
}

describe("filterCatalog search ranking", () => {
  const cat = catalog([
    ch("a", "Sports"), // exact
    ch("b", "Star Sports 1"), // word-boundary
    ch("c", "ESPN Sports News"), // contains
    ch("d", "Comedy Central"), // no match
    ch("e", "PlaySportz"), // contains (sports inside)
  ]);

  it("ranks exact match first, then starts-with/word-boundary, then contains", () => {
    const res = filterCatalog(cat, null, "sports");
    expect(res[0].name).toBe("Sports"); // exact wins
    // "Star Sports 1" (word boundary) should outrank plain contains
    const names = res.map((c) => c.name);
    expect(names).toContain("Star Sports 1");
    expect(names).not.toContain("Comedy Central"); // non-match dropped
  });

  it("supports fuzzy subsequence for longer terms", () => {
    // "esspn" is a subsequence-ish typo of "ESPN Sports News"
    const res = filterCatalog(catalog([ch("c", "ESPN Sports News")]), null, "espnnews");
    expect(res.length).toBe(1);
  });

  it("does not fuzzy-match very short noise terms", () => {
    const res = filterCatalog(catalog([ch("d", "Comedy Central")]), null, "xz");
    expect(res.length).toBe(0);
  });

  it("filters by category and bdix", () => {
    const c = catalog([
      ch("a", "A", { category: "news" }),
      ch("b", "B", { category: "sports" }),
      ch("c", "C", { isBdix: true, category: "news" }),
    ]);
    expect(filterCatalog(c, "news", null).map((x) => x.id)).toEqual(["a", "c"]);
    expect(filterCatalog(c, "bdix", null).map((x) => x.id)).toEqual(["c"]);
  });

  it("excludes offline channels", () => {
    const c = catalog([
      ch("a", "Live", { status: "active" }),
      ch("b", "Dead", { status: "offline" }),
    ]);
    expect(filterCatalog(c, null, null).map((x) => x.id)).toEqual(["a"]);
  });
});
