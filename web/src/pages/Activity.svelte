<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "../lib/api";
  import { EXPENSE_CATEGORIES } from "../lib/insights";
  import { formatMoney } from "../lib/money";
  import { href } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { itemNumber, STATUS_LABELS, type Status } from "../lib/types";

  // F30: everything that changed, newest first.
  interface Entry {
    id: number;
    at: string;
    entity: string;
    entityId: number | null;
    action: string;
    item: { id: number; number: number; name: string } | null;
    changes: { field: string; from: unknown; to: unknown }[];
  }

  const FILTERS: [string, string][] = [
    ["", "Everything"],
    ["items", "Items"],
    ["sales", "Sales"],
    ["expenses", "Expenses"],
    ["shop_reports", "Reports"],
    ["auth", "Sign-ins"],
  ];
  const ENTITY: Record<string, string> = {
    items: "Item",
    categories: "Category",
    settings: "Setting",
    sales: "Sale",
    shop_reports: "Shop report",
    expenses: "Expense",
    photos: "Photo",
    placements: "Shop placement",
  };
  const AUTH: Record<string, string> = {
    login: "Signed in",
    login_failed: "Failed sign-in attempt",
    logout: "Signed out",
    password_changed: "Password changed",
    signed_out_everywhere: "Signed out everywhere",
  };
  const FIELD: Record<string, string> = {
    price_cents: "price",
    cost_cents: "materials cost",
    sold_cents: "sold for",
    amount_cents: "amount",
    reported_total_cents: "reported total",
    category_id: "category",
    archived_at: "archived",
    sale_date: "sale date",
    spent_on: "date",
    placed_on: "placed",
    removed_on: "removed",
    reconciled_at: "reconciled",
    period_start: "period start",
    period_end: "period end",
    received_on: "received",
    reported_count: "reported count",
    item_id: "item",
    report_id: "report",
  };

  let entries = $state<Entry[]>([]);
  let filter = $state("");
  let loading = $state(false);
  let done = $state(false);
  let error = $state("");

  const currency = $derived(session.settings.currency);

  onMount(() => load(true));

  async function load(reset: boolean) {
    loading = true;
    error = "";
    const p = new URLSearchParams({ limit: "50" });
    if (filter) p.set("entity", filter);
    if (!reset && entries.length) p.set("before", String(entries[entries.length - 1].id));
    try {
      const page = await get<Entry[]>(`/audit?${p}`);
      entries = reset ? page : [...entries, ...page];
      done = page.length < 50;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function setFilter(f: string) {
    filter = f;
    load(true);
  }

  function value(field: string, v: unknown): string {
    if (v === null || v === undefined || v === "") return "—";
    if (field.endsWith("_cents") && typeof v === "number") return formatMoney(v, currency);
    if (field === "status") return STATUS_LABELS[v as Status] ?? String(v);
    if (field === "category" && typeof v === "string" && v in EXPENSE_CATEGORIES) {
      return EXPENSE_CATEGORIES[v as keyof typeof EXPENSE_CATEGORIES];
    }
    if (field === "tags" && typeof v === "string") return (JSON.parse(v) as string[]).join(", ") || "—";
    if (field === "number" && typeof v === "number") return itemNumber(v);
    const s = String(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  }

  function title(e: Entry): string {
    if (e.entity === "auth") return AUTH[e.action] ?? e.action;
    const what = ENTITY[e.entity] ?? e.entity;
    const verb = e.action === "create" ? "added" : e.action === "delete" ? "removed" : "changed";
    return `${what} ${verb}`;
  }

  const when = (at: string) =>
    new Date(`${at.replace(" ", "T")}Z`).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
</script>

<p><a href={href("/settings")}>‹ Settings</a></p>
<h1>Activity log</h1>

<div class="filters row">
  {#each FILTERS as [f, label]}
    <button class:on={filter === f} onclick={() => setFilter(f)}>{label}</button>
  {/each}
</div>

{#if error}<p class="error">{error}</p>{/if}

<ul class="log">
  {#each entries as e (e.id)}
    <li>
      <div class="row top">
        <strong class="grow">{title(e)}</strong>
        <span class="muted when">{when(e.at)}</span>
      </div>
      {#if e.item}
        <a href={href(`/items/${e.item.id}`)}>{itemNumber(e.item.number)} {e.item.name}</a>
      {/if}
      {#if e.entity === "auth"}
        <div class="muted small">{String(e.changes.find((c) => c.field === "ip")?.to ?? "")}</div>
      {:else if e.changes.length}
        <ul class="changes">
          {#each e.changes.filter((c) => !(e.entity === "items" && e.action === "create" && ["status", "tags", "description", "notes"].includes(c.field))) as c}
            <li>
              <span class="muted">{FIELD[c.field] ?? c.field}:</span>
              {#if e.action === "update"}
                {value(c.field, c.from)} → {value(c.field, c.to)}
              {:else}
                {value(c.field, e.action === "delete" ? c.from : c.to)}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {:else}
    {#if !loading}<li class="muted">Nothing yet.</li>{/if}
  {/each}
</ul>

{#if !done && entries.length}
  <button class="more" onclick={() => load(false)} disabled={loading}>Older</button>
{/if}

<style>
  .filters {
    gap: 6px;
    margin-bottom: 8px;
  }
  .filters button {
    min-height: 32px;
    font-size: 13px;
    padding: 0 10px;
    border-radius: 999px;
  }
  .filters button.on {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .log {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .log > li {
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .top {
    flex-wrap: nowrap;
  }
  .when {
    font-size: 12px;
    white-space: nowrap;
  }
  .changes {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
  }
  .changes li {
    margin: 2px 0;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 12px;
  }
  .more {
    width: 100%;
    margin-top: 12px;
  }
</style>
