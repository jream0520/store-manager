<script lang="ts">
  import { formatMonth, getAnalysis, presetRange, type Analysis } from "../lib/insights";
  import { formatMoney } from "../lib/money";
  import { href } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { formatDay, todayLocal } from "../lib/status";
  import { itemNumber } from "../lib/types";

  // F24: sales and profit for a chosen period, by month and category, with best sellers.
  type Preset = "month" | "lastMonth" | "year" | "last12" | "custom";
  const PRESETS: [Preset, string][] = [
    ["month", "This month"],
    ["lastMonth", "Last month"],
    ["year", "This year"],
    ["last12", "Last 12 months"],
    ["custom", "Custom"],
  ];

  let preset = $state<Preset>("year");
  let from = $state(presetRange("year").from);
  let to = $state(presetRange("year").to);
  let a = $state<Analysis | null>(null);
  let error = $state("");
  let loading = $state(false);

  const currency = $derived(session.settings.currency);
  const money = (c: number) => formatMoney(c, currency);
  const maxMonth = $derived(Math.max(1, ...(a?.byMonth.map((m) => Math.max(m.salesCents, m.expensesCents)) ?? [1])));

  function choose(p: Preset) {
    preset = p;
    if (p !== "custom") ({ from, to } = presetRange(p));
  }

  let seq = 0;
  $effect(() => {
    const f = from;
    const t = to;
    if (!f || !t || t < f) return;
    const mine = ++seq;
    loading = true;
    error = "";
    getAnalysis(f, t)
      .then((res) => mine === seq && (a = res))
      .catch((e) => mine === seq && (error = (e as Error).message))
      .finally(() => mine === seq && (loading = false));
  });
</script>

<p><a href={href("/sales")}>‹ Sales & profit</a></p>
<h1>Profit report</h1>

<div class="presets row">
  {#each PRESETS as [p, label]}
    <button class:on={preset === p} onclick={() => choose(p)}>{label}</button>
  {/each}
</div>
{#if preset === "custom"}
  <div class="two">
    <div><label for="an-from">From</label><input id="an-from" type="date" bind:value={from} max={todayLocal()} /></div>
    <div><label for="an-to">To</label><input id="an-to" type="date" bind:value={to} max={todayLocal()} /></div>
  </div>
  {#if to < from}<p class="error">The end date is before the start.</p>{/if}
{/if}

{#if error}<p class="error">{error}</p>{/if}

{#if a}
  {@const s = a.summary}
  <p class="muted range">{formatDay(a.from)} – {formatDay(a.to)}{loading ? " · updating…" : ""}</p>

  <table class="pl">
    <tbody>
      <tr><td>Sales ({s.salesCount} item{s.salesCount === 1 ? "" : "s"})</td><td>{money(s.salesCents)}</td></tr>
      <tr><td>Materials</td><td>−{money(s.materialsCents)}</td></tr>
      <tr class="sub"><td>Profit</td><td>{money(s.profitCents)}</td></tr>
      {#each Object.entries(s.expensesByCategory).filter(([, v]) => v > 0) as [cat, v]}
        <tr><td>{cat === "rent" ? "Booth rent" : cat.charAt(0).toUpperCase() + cat.slice(1)}</td><td>−{money(v)}</td></tr>
      {/each}
      <tr class="total" class:neg={s.netCents < 0}><td>Net</td><td>{money(s.netCents)}</td></tr>
    </tbody>
  </table>
  {#if s.missingCostCount}
    <p class="warn">{s.missingCostCount} sale{s.missingCostCount === 1 ? " has" : "s have"} no materials cost, counted as zero.</p>
  {/if}

  {#if a.byMonth.length}
    <h2>By month</h2>
    <ul class="months">
      {#each a.byMonth as m (m.month)}
        <li>
          <div class="row mhead">
            <strong class="grow">{formatMonth(m.month)}</strong>
            <span class:neg={m.netCents < 0}>net {money(m.netCents)}</span>
          </div>
          <div class="bar sales" style={`width:${(m.salesCents / maxMonth) * 100}%`}></div>
          <div class="bar exp" style={`width:${(m.expensesCents / maxMonth) * 100}%`}></div>
          <div class="muted small">sales {money(m.salesCents)} · profit {money(m.profitCents)} · expenses {money(m.expensesCents)}</div>
        </li>
      {/each}
    </ul>
    <p class="muted small legend"><span class="key sales"></span> sales <span class="key exp"></span> expenses</p>
  {/if}

  {#if a.byCategory.length}
    <h2>By category</h2>
    <table class="cats">
      <thead><tr><th>Category</th><th>Sold</th><th>Sales</th><th>Profit</th><th>Days</th></tr></thead>
      <tbody>
        {#each a.byCategory as c}
          <tr>
            <td>{c.category}</td>
            <td>{c.count}</td>
            <td>{money(c.salesCents)}</td>
            <td>{money(c.profitCents)}</td>
            <td>{c.avgDaysToSell ?? "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="muted small">
      Days = average days from going into the shop to selling.
      {#if a.avgDaysToSell !== null}Overall: <strong>{a.avgDaysToSell} days</strong> ({a.daysToSellSampleSize} sales).{/if}
    </p>
  {/if}

  {#if a.topItems.length}
    <h2>Top sales</h2>
    <ol class="top">
      {#each a.topItems as t}
        <li>
          <a href={href(`/items/${t.itemId}`)}><strong>{itemNumber(t.itemNumber)}</strong> {t.itemName}</a>
          <span>{money(t.soldCents)}</span>
        </li>
      {/each}
    </ol>
  {/if}

  {#if !s.salesCount && !s.expensesCents}<p class="muted">No sales or expenses in this period.</p>{/if}
{:else if loading}
  <p class="muted">Loading…</p>
{/if}

<style>
  .presets {
    gap: 6px;
  }
  .presets button {
    min-height: 34px;
    font-size: 14px;
    padding: 0 12px;
    border-radius: 999px;
  }
  .presets button.on {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .range {
    font-size: 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  .pl td {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .pl td:last-child,
  .cats td:not(:first-child),
  .cats th:not(:first-child) {
    text-align: right;
  }
  .pl .sub td {
    font-weight: 600;
  }
  .pl .total td {
    font-weight: 700;
    font-size: 18px;
    border-bottom: none;
  }
  .neg {
    color: var(--danger);
  }
  .warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 13px;
  }
  .months {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .months li {
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .mhead {
    font-size: 15px;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    margin-top: 4px;
    min-width: 2px;
  }
  .bar.sales,
  .key.sales {
    background: var(--accent);
  }
  .bar.exp,
  .key.exp {
    background: var(--muted);
  }
  .key {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin: 0 4px 0 8px;
  }
  .small {
    font-size: 13px;
  }
  .cats th {
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
    text-align: left;
    padding-bottom: 4px;
  }
  .cats td {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .top {
    padding-left: 22px;
  }
  .top li {
    padding: 4px 0;
  }
  .top li a {
    color: inherit;
    text-decoration: none;
  }
  .top li span {
    float: right;
    font-variant-numeric: tabular-nums;
  }
</style>
