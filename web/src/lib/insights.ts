import { del, get, patch, post } from "./api";
import { todayLocal } from "./status";

export const EXPENSE_CATEGORIES = {
  rent: "Booth rent",
  fees: "Fees",
  supplies: "Supplies",
  marketing: "Marketing",
  other: "Other",
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export interface Summary {
  salesCount: number;
  salesCents: number;
  materialsCents: number;
  profitCents: number;
  missingCostCount: number;
  expensesCents: number;
  expensesByCategory: Record<ExpenseCategory, number>;
  netCents: number;
}

export interface Dashboard {
  counts: { inStudio: number; inShop: number; sold: number; writtenOff: number; incomplete: number };
  shop: { count: number; valueCents: number; over60Days: number; over90Days: number };
  month: Summary;
  year: Summary;
  recent: {
    kind: "status" | "price";
    from: string | null;
    to: string | null;
    on: string;
    oldCents: number | null;
    newCents: number | null;
    itemId: number;
    itemNumber: number;
    itemName: string;
  }[];
}

export interface Analysis {
  from: string;
  to: string;
  summary: Summary;
  byCategory: { category: string; count: number; salesCents: number; profitCents: number; avgDaysToSell: number | null }[];
  topItems: { itemId: number; itemNumber: number; itemName: string; saleDate: string; soldCents: number; profitCents: number | null }[];
  avgDaysToSell: number | null;
  daysToSellSampleSize: number;
  byMonth: { month: string; salesCents: number; profitCents: number; expensesCents: number; netCents: number }[];
}

export interface Expense {
  id: number;
  spentOn: string;
  category: ExpenseCategory;
  amountCents: number;
  note: string;
  createdAt: string;
}

export const getDashboard = () => get<Dashboard>(`/dashboard?today=${todayLocal()}`);
export const getAnalysis = (from: string, to: string) => get<Analysis>(`/analysis?from=${from}&to=${to}`);

export const listExpenses = (from?: string, to?: string) => {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  return get<Expense[]>(`/expenses?${p}`);
};
export const addExpense = (e: Omit<Expense, "id" | "createdAt">) => post<Expense>("/expenses", e);
export const editExpense = (id: number, e: Partial<Omit<Expense, "id" | "createdAt">>) => patch<Expense>(`/expenses/${id}`, e);
export const removeExpense = (id: number) => del(`/expenses/${id}`);

export const exportUrl = (what: "items" | "sales" | "expenses") => `${import.meta.env.BASE_URL}api/export/${what}.csv`;

/** Date-range presets for reports, computed in the device's calendar. */
export function presetRange(preset: "month" | "lastMonth" | "year" | "last12"): { from: string; to: string } {
  const today = todayLocal();
  const [y, m] = today.split("-").map(Number);
  const fmt = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  switch (preset) {
    case "month":
      return { from: fmt(y, m, 1), to: today };
    case "lastMonth": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: fmt(ly, lm, 1), to: fmt(ly, lm, new Date(ly, lm, 0).getDate()) };
    }
    case "year":
      return { from: fmt(y, 1, 1), to: today };
    case "last12": {
      const start = m === 12 ? fmt(y, 1, 1) : fmt(y - 1, m + 1, 1);
      return { from: start, to: today };
    }
  }
}

/** "2026-10" → "Oct 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 15).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
