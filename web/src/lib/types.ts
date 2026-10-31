export type Status = "in_studio" | "in_shop" | "sold" | "returned" | "written_off";

export const STATUS_LABELS: Record<Status, string> = {
  in_studio: "In studio",
  in_shop: "In shop",
  sold: "Sold",
  returned: "Returned",
  written_off: "Written off",
};

export interface Item {
  id: number;
  number: number;
  name: string;
  description: string;
  categoryId: number | null;
  categoryName: string | null;
  tags: string[];
  costCents: number | null;
  priceCents: number | null;
  status: Status;
  notes: string;
  archived: boolean;
  incomplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemList {
  items: Item[];
  total: number;
}

export interface Category {
  id: number;
  name: string;
  itemCount: number;
}

export interface Settings {
  shopName: string;
  currency: string;
}

/** Tag-number display, e.g. 42 → "0042". */
export const itemNumber = (n: number) => String(n).padStart(4, "0");
