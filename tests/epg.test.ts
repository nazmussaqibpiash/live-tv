import { describe, it, expect } from "vitest";
import { nowNext, type EpgPayload } from "../src/lib/epg";

const base = 1_000_000_000_000;
const epg: EpgPayload = {
  updatedAt: new Date().toISOString(),
  programs: {
    ch1: [
      { t: "Morning Show", s: base - 1000, e: base + 1000 }, // airing now
      { t: "Noon News", s: base + 1000, e: base + 2000 }, // next
      { t: "Evening", s: base + 2000, e: base + 3000 },
    ],
    ch2: [
      { t: "Future Only", s: base + 5000, e: base + 6000 }, // only future
    ],
    ch3: [
      { t: "Past Only", s: base - 5000, e: base - 4000 }, // only past
    ],
  },
};

describe("nowNext", () => {
  it("returns the currently airing program as now", () => {
    const nn = nowNext(epg, "ch1", base);
    expect(nn?.now?.t).toBe("Morning Show");
  });

  it("returns the soonest upcoming program as next", () => {
    const nn = nowNext(epg, "ch1", base);
    expect(nn?.next?.t).toBe("Noon News");
  });

  it("handles channels with only a future program (no now)", () => {
    const nn = nowNext(epg, "ch2", base);
    expect(nn?.now).toBeNull();
    expect(nn?.next?.t).toBe("Future Only");
  });

  it("returns null when only past programs remain", () => {
    const nn = nowNext(epg, "ch3", base);
    expect(nn).toBeNull();
  });

  it("returns null for unknown channel", () => {
    expect(nowNext(epg, "nope", base)).toBeNull();
  });
});
