import { describe, expect, it } from "vitest";
import { centsToInput, parseMoney } from "./money";

describe("parseMoney", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["0.99", 99],
    [".5", 50],
    ["$1,200.00", 120000],
    ["  7 ", 700],
  ])("%s → %d cents", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it("treats blank as no value", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
  });

  it.each(["abc", "1.234", "-5", "1.2.3", "."])("rejects %s", (input) => {
    expect(parseMoney(input)).toBeUndefined();
  });

  it("round-trips through the input format", () => {
    for (const c of [0, 5, 99, 1250, 120000]) expect(parseMoney(centsToInput(c))).toBe(c);
    expect(centsToInput(null)).toBe("");
  });
});
