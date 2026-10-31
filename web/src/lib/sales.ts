import { ApiError, del, get, patch, post } from "./api";
import type { Item } from "./types";

export interface Sale {
  id: number;
  itemId: number;
  itemNumber: number;
  itemName: string;
  coverPhotoId: string | null;
  saleDate: string;
  soldCents: number;
  retailCents: number | null;
  costCents: number | null;
  profitCents: number | null;
  reportId: number | null;
  note: string;
  priceDiffers: boolean;
  notInShop: boolean;
  createdAt: string;
}

export interface SalesList {
  sales: Sale[];
  count: number;
  totalCents: number;
  profitCents: number;
  missingCostCount: number;
}

export interface ShopReport {
  id: number;
  periodStart: string;
  periodEnd: string;
  receivedOn: string | null;
  reportedCount: number | null;
  reportedTotalCents: number | null;
  note: string;
  reconciled: boolean;
  enteredCount: number;
  enteredTotalCents: number;
  createdAt: string;
}

export interface SellInput {
  itemId: number;
  saleDate: string;
  soldCents: number;
  reportId?: number | null;
  note?: string;
  allowNotInShop?: boolean;
}

/** Why a sale was refused, with what the UI needs to explain it. */
export type SellProblem =
  | { code: "not_found" }
  | { code: "duplicate"; sale: Sale }
  | { code: "not_in_shop" | "not_sellable"; status: Item["status"] };

export async function sellItem(input: SellInput): Promise<{ sale: Sale; item: Item } | SellProblem> {
  try {
    return await post<{ sale: Sale; item: Item }>("/sales", input);
  } catch (e) {
    const code = e instanceof ApiError ? (e.data.code as string | undefined) : undefined;
    if (code === "not_found") return { code };
    if (code === "duplicate") return { code, sale: (e as ApiError).data.sale as Sale };
    if (code === "not_in_shop" || code === "not_sellable") {
      return { code, status: (e as ApiError).data.status as Item["status"] };
    }
    throw e;
  }
}

export const isProblem = (r: { sale: Sale; item: Item } | SellProblem): r is SellProblem => "code" in r;

export const updateSale = (id: number, body: Partial<Pick<Sale, "saleDate" | "soldCents" | "note">>) =>
  patch<Sale>(`/sales/${id}`, body);

export const getSale = (id: number) => get<Sale>(`/sales/${id}`);

export const undoSale = (id: number) => del(`/sales/${id}`);

export function listSales(q: { from?: string; to?: string; reportId?: number }): Promise<SalesList> {
  const p = new URLSearchParams();
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.reportId) p.set("reportId", String(q.reportId));
  return get<SalesList>(`/sales?${p}`);
}

export const listReports = () => get<ShopReport[]>("/reports");
export const getReport = (id: number) => get<ShopReport>(`/reports/${id}`);
export const createReport = (body: Partial<ShopReport>) => post<ShopReport>("/reports", body);
export const updateReport = (id: number, body: Partial<ShopReport>) => patch<ShopReport>(`/reports/${id}`, body);
export const deleteReport = (id: number) => del(`/reports/${id}`);
