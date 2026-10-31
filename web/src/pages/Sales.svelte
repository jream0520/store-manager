<script lang="ts">
  import { onMount } from "svelte";
  import DashboardPanel from "../components/DashboardPanel.svelte";
  import { formatMoney, parseMoney } from "../lib/money";
  import { href, navigate } from "../lib/router.svelte";
  import { createReport, listReports, type ShopReport } from "../lib/sales";
  import { session } from "../lib/session.svelte";
  import { formatDay, todayLocal } from "../lib/status";

  let reports = $state<ShopReport[]>([]);
  let loading = $state(true);
  let error = $state("");

  // New report form
  let creating = $state(false);
  let periodStart = $state("");
  let periodEnd = $state(todayLocal());
  let receivedOn = $state(todayLocal());
  let reportedCount = $state("");
  let reportedTotal = $state("");
  let formError = $state("");

  const currency = $derived(session.settings.currency);
  const reportedTotalCents = $derived(parseMoney(reportedTotal));

  onMount(async () => {
    try {
      reports = await listReports();
      // Default the next report to start the day after the latest one ended.
      if (reports.length) periodStart = nextDay(reports[0].periodEnd);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });

  function nextDay(day: string): string {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + 1);
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return s > todayLocal() ? todayLocal() : s;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    formError = "";
    if (!periodStart || !periodEnd) return void (formError = "Enter the report's start and end dates.");
    if (periodEnd < periodStart) return void (formError = "The period can't end before it starts.");
    if (reportedTotalCents === undefined) return void (formError = "Enter the total like 120 or 120.50.");
    if (reportedCount && !/^\d+$/.test(reportedCount)) return void (formError = "Item count must be a whole number.");
    try {
      const r = await createReport({
        periodStart,
        periodEnd,
        receivedOn: receivedOn || null,
        reportedCount: reportedCount ? Number(reportedCount) : null,
        reportedTotalCents: reportedTotalCents ?? null,
      });
      navigate(`/reports/${r.id}`);
    } catch (err) {
      formError = (err as Error).message;
    }
  }

  function balance(r: ShopReport): "ok" | "off" | "unknown" {
    if (r.reportedTotalCents === null && r.reportedCount === null) return "unknown";
    const totalOk = r.reportedTotalCents === null || r.reportedTotalCents === r.enteredTotalCents;
    const countOk = r.reportedCount === null || r.reportedCount === r.enteredCount;
    return totalOk && countOk ? "ok" : "off";
  }
</script>

<h1>Sales & profit</h1>

<DashboardPanel />

<div class="row head">
  <h2 class="grow">Shop reports</h2>
  {#if !creating}<button class="primary" onclick={() => (creating = true)}>+ New report</button>{/if}
</div>

{#if creating}
  <form class="card" onsubmit={create} novalidate>
    <p class="muted intro">Enter the dates and totals from the shop's report, then enter each sale by item number.</p>
    <div class="two">
      <div>
        <label for="r-start">Period start</label>
        <input id="r-start" type="date" bind:value={periodStart} max={todayLocal()} />
      </div>
      <div>
        <label for="r-end">Period end</label>
        <input id="r-end" type="date" bind:value={periodEnd} max={todayLocal()} />
      </div>
      <div>
        <label for="r-count">Items sold <span class="muted tiny">(optional)</span></label>
        <input id="r-count" bind:value={reportedCount} inputmode="numeric" autocomplete="off" />
      </div>
      <div>
        <label for="r-total">Report total <span class="muted tiny">(optional)</span></label>
        <input id="r-total" bind:value={reportedTotal} inputmode="decimal" placeholder="0.00" autocomplete="off" />
      </div>
    </div>
    <label for="r-recv">Received on</label>
    <input id="r-recv" type="date" bind:value={receivedOn} max={todayLocal()} />
    {#if formError}<p class="error">{formError}</p>{/if}
    <div class="row actions">
      <button type="button" class="grow" onclick={() => (creating = false)}>Cancel</button>
      <button type="submit" class="grow primary">Start entering sales</button>
    </div>
  </form>
{/if}

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

<ul class="reports">
  {#each reports as r (r.id)}
    {@const b = balance(r)}
    <li>
      <a href={href(`/reports/${r.id}`)}>
        <span class="main">
          <strong>{formatDay(r.periodStart)} – {formatDay(r.periodEnd)}</strong>
          <span class="muted">
            {r.enteredCount} entered · {formatMoney(r.enteredTotalCents, currency)}
            {#if r.reportedTotalCents !== null}of {formatMoney(r.reportedTotalCents, currency)}{/if}
          </span>
        </span>
        {#if r.reconciled}
          <span class="badge ok">Reconciled</span>
        {:else if b === "off"}
          <span class="badge warn">Doesn't match</span>
        {:else if b === "ok"}
          <span class="badge ok">Matches</span>
        {:else}
          <span class="badge">Open</span>
        {/if}
      </a>
    </li>
  {:else}
    {#if !loading && !creating}<li class="muted empty">No reports yet. When the shop sends one, tap “New report”.</li>{/if}
  {/each}
</ul>

<style>
  .tiny {
    font-size: 11px !important;
  }
  .head {
    margin-top: 16px;
  }
  .head h2 {
    margin: 8px 0;
  }
  .intro {
    margin-top: 0;
    font-size: 14px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 12px;
  }
  .actions {
    margin-top: 16px;
    flex-wrap: nowrap;
  }
  .reports {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
  }
  .reports a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .main .muted {
    font-size: 14px;
  }
  .badge.ok {
    background: transparent;
    border-color: var(--accent);
    color: var(--accent);
  }
  .empty {
    padding: 16px 0;
  }
</style>
