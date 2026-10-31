<script lang="ts">
  import { onMount } from "svelte";
  import { exportUrl, getDashboard, type Dashboard, type Summary } from "../lib/insights";
  import { formatMoney } from "../lib/money";
  import { href } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { formatDay } from "../lib/status";
  import { itemNumber, STATUS_LABELS, type Status } from "../lib/types";

  // F23: the at-a-glance view at the top of the Sales tab.
  let d = $state<Dashboard | null>(null);
  let error = $state("");
  let period = $state<"month" | "year">("month");

  const currency = $derived(session.settings.currency);
  const s = $derived<Summary | null>(d ? d[period] : null);

  onMount(async () => {
    try {
      d = await getDashboard();
    } catch (e) {
      error = (e as Error).message;
    }
  });

  const money = (c: number) => formatMoney(c, currency);

  function activity(r: Dashboard["recent"][number]): string {
    if (r.kind === "price") return `price ${money(r.oldCents ?? 0)} → ${money(r.newCents ?? 0)}`;
    if (r.to === "sold") return "sold";
    if (r.from === "sold") return "sale undone";
    if (r.to === "in_shop") return "placed in shop";
    if (r.from === "in_shop" && r.to === "in_studio") return "pulled back";
    return `${STATUS_LABELS[r.from as Status]?.toLowerCase()} → ${STATUS_LABELS[r.to as Status]?.toLowerCase()}`;
  }
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if d && s}
  <div class="seg" role="tablist" aria-label="Period">
    <button role="tab" aria-selected={period === "month"} class:on={period === "month"} onclick={() => (period = "month")}>This month</button>
    <button role="tab" aria-selected={period === "year"} class:on={period === "year"} onclick={() => (period = "year")}>This year</button>
  </div>

  <div class="tiles">
    <div class="tile"><span>Sales</span><strong>{money(s.salesCents)}</strong><small>{s.salesCount} item{s.salesCount === 1 ? "" : "s"}</small></div>
    <div class="tile"><span>Profit</span><strong>{money(s.profitCents)}</strong><small>after materials</small></div>
    <div class="tile"><span>Expenses</span><strong>{money(s.expensesCents)}</strong><small>rent, fees…</small></div>
    <div class="tile net" class:neg={s.netCents < 0}><span>Net</span><strong>{money(s.netCents)}</strong><small>profit − expenses</small></div>
  </div>
  {#if s.missingCostCount}
    <p class="warn small">
      {s.missingCostCount} sale{s.missingCostCount === 1 ? " has" : "s have"} no materials cost, so profit may be high.
      <a href={href("/?incomplete=1&status=sold")}>Fill in costs</a>
    </p>
  {/if}

  <h2>Stock</h2>
  <div class="tiles stock">
    <a class="tile" href={href("/?status=in_studio")}><span>In studio</span><strong>{d.counts.inStudio}</strong></a>
    <a class="tile" href={href("/shop")}><span>In shop</span><strong>{d.counts.inShop}</strong><small>{money(d.shop.valueCents)} retail</small></a>
    <a class="tile" href={href("/?status=sold")}><span>Sold</span><strong>{d.counts.sold}</strong></a>
  </div>
  {#if d.shop.over60Days || d.counts.incomplete}
    <ul class="alerts">
      {#if d.shop.over60Days}
        <li>
          <a href={href("/shop")}>
            {d.shop.over60Days} item{d.shop.over60Days === 1 ? "" : "s"} in the shop over 60 days{#if d.shop.over90Days}
              ({d.shop.over90Days} over 90){/if}
          </a>
        </li>
      {/if}
      {#if d.counts.incomplete}
        <li><a href={href("/?incomplete=1")}>{d.counts.incomplete} unsold item{d.counts.incomplete === 1 ? "" : "s"} missing price, cost or category</a></li>
      {/if}
    </ul>
  {/if}

  <div class="links row">
    <a class="button grow" href={href("/analysis")}>Profit report</a>
    <a class="button grow" href={href("/expenses")}>Expenses</a>
  </div>
  <details class="export">
    <summary>Export to spreadsheet (CSV)</summary>
    <div class="row">
      <a class="button" href={exportUrl("items")} download>Items</a>
      <a class="button" href={exportUrl("sales")} download>Sales</a>
      <a class="button" href={exportUrl("expenses")} download>Expenses</a>
    </div>
  </details>

  {#if d.recent.length}
    <h2>Recent activity</h2>
    <ul class="recent">
      {#each d.recent as r}
        <li>
          <span class="when">{formatDay(r.on)}</span>
          <a href={href(`/items/${r.itemId}`)}><strong>{itemNumber(r.itemNumber)}</strong> {r.itemName}</a>
          <span class="muted">{activity(r)}</span>
        </li>
      {/each}
    </ul>
  {/if}
{:else if !error}
  <p class="muted">Loading…</p>
{/if}

<style>
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px;
    margin-bottom: 10px;
  }
  .seg button {
    border: none;
    min-height: 34px;
    border-radius: 999px;
    color: var(--muted);
    font-size: 14px;
  }
  .seg button.on {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .tiles.stock {
    grid-template-columns: repeat(3, 1fr);
  }
  .tile {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    color: inherit;
    text-decoration: none;
  }
  .tile span,
  .tile small {
    font-size: 12px;
    color: var(--muted);
  }
  .tile strong {
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }
  .tile.net {
    outline: 1px solid var(--accent);
  }
  .tile.neg strong {
    color: var(--danger);
  }
  .warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 8px;
    padding: 6px 10px;
  }
  .small {
    font-size: 13px;
  }
  .alerts {
    margin: 10px 0 0;
    padding-left: 18px;
    font-size: 14px;
  }
  .alerts li {
    margin: 4px 0;
  }
  .links {
    margin-top: 16px;
    flex-wrap: nowrap;
  }
  .export {
    margin-top: 12px;
    font-size: 14px;
  }
  .export summary {
    color: var(--accent);
    cursor: pointer;
    padding: 6px 0;
  }
  .export .row {
    margin-top: 6px;
  }
  .recent {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 14px;
  }
  .recent li {
    display: flex;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    align-items: baseline;
  }
  .recent a {
    color: inherit;
    text-decoration: none;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    color: var(--muted);
    min-width: 4em;
  }
</style>
