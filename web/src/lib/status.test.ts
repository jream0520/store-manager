import { describe, expect, it } from "vitest";
import { actionsFor, daysSince, todayLocal } from "./status";

describe("actionsFor", () => {
  it("offers only actions every selected status allows", () => {
    expect(actionsFor(["in_studio"])).toEqual(["place", "write_off"]);
    expect(actionsFor(["in_shop"])).toEqual(["pull", "write_off"]);
    expect(actionsFor(["in_studio", "in_shop"])).toEqual(["write_off"]);
    expect(actionsFor(["written_off"])).toEqual(["restore"]);
    expect(actionsFor(["sold"])).toEqual([]);
    expect(actionsFor([])).toEqual([]);
  });
});

describe("daysSince", () => {
  it("counts whole days to today", () => {
    expect(daysSince(todayLocal())).toBe(0);
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(daysSince(day)).toBe(30);
  });
});
