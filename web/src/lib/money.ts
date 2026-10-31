/**
 * Parses a typed amount ("12", "12.5", "$1,200.00") into integer cents.
 * Returns null for blank input and undefined for anything unparseable.
 */
export function parseMoney(input: string): number | null | undefined {
  const s = input
    .trim()
    .replace(/^\p{Sc}\s*/u, "") // one leading currency symbol, e.g. "$"
    .replace(/,/g, "");
  if (!s) return null;
  if (!/^\d*(\.\d{0,2})?$/.test(s) || s === ".") return undefined;
  const [whole, frac = ""] = s.split(".");
  return Number(whole || 0) * 100 + Number(frac.padEnd(2, "0"));
}

/** Plain editable form of cents, e.g. 1250 → "12.50", null → "". */
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}
