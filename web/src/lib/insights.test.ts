import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presetRange } from "./insights";

describe("presetRange", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("computes ranges mid-year", () => {
    vi.setSystemTime(new Date(2026, 9, 31, 12)); // Oct 31 2026, local time
    expect(presetRange("month")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("lastMonth")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("year")).toEqual({ from: "2026-01-01", to: "2026-10-31" });
    expect(presetRange("last12")).toEqual({ from: "2025-11-01", to: "2026-10-31" });
  });

  it("handles January and February edges", () => {
    vi.setSystemTime(new Date(2026, 0, 15, 12));
    expect(presetRange("lastMonth")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    vi.setSystemTime(new Date(2024, 2, 10, 12));
    expect(presetRange("lastMonth")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    vi.setSystemTime(new Date(2026, 11, 5, 12));
    expect(presetRange("last12")).toEqual({ from: "2026-01-01", to: "2026-12-05" });
  });
});
