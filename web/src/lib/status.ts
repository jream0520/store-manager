import { post } from "./api";
import type { Item, Status } from "./types";

// Mirrors server/src/status.ts ACTIONS. Selling arrives in M5.
export const ACTIONS = {
  place: { from: ["in_studio"], label: "Place in shop", done: "Placed in shop" },
  pull: { from: ["in_shop"], label: "Pull back to studio", done: "Pulled back to studio" },
  write_off: { from: ["in_studio", "in_shop"], label: "Write off", done: "Written off" },
  restore: { from: ["written_off"], label: "Restore to studio", done: "Restored to studio" },
} as const satisfies Record<string, { from: readonly Status[]; label: string; done: string }>;

export type Action = keyof typeof ACTIONS;

export const WRITE_OFF_REASONS = {
  lost: "Lost",
  damaged: "Damaged",
  gifted: "Gifted",
  kept: "Kept for myself",
  other: "Other",
} as const;

export type WriteOffReason = keyof typeof WRITE_OFF_REASONS;

export interface ActionDetails {
  date: string;
  location?: string;
  reason?: WriteOffReason;
  note?: string;
}

/** Actions every one of these statuses allows (for a mixed bulk selection). */
export function actionsFor(statuses: Status[]): Action[] {
  if (!statuses.length) return [];
  return (Object.keys(ACTIONS) as Action[]).filter((a) =>
    statuses.every((s) => (ACTIONS[a].from as readonly Status[]).includes(s)),
  );
}

export async function applyAction(ids: number[], action: Action, d: ActionDetails): Promise<Item[]> {
  const body: Record<string, unknown> = { ids, action, date: d.date };
  if (action === "place" && d.location?.trim()) body.location = d.location.trim();
  if (action === "write_off") {
    body.reason = d.reason;
    if (d.note?.trim()) body.note = d.note.trim();
  }
  return (await post<{ items: Item[] }>("/items/status", body)).items;
}

/** Today's date on this device, as YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Oct 1" (this year) or "Oct 1, 2025". */
export function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Whole days from a YYYY-MM-DD date to today on this device. */
export function daysSince(day: string): number {
  const ms = new Date(`${todayLocal()}T12:00:00`).getTime() - new Date(`${day}T12:00:00`).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
