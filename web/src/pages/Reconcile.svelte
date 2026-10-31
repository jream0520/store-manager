<script lang="ts">
  import { onMount, tick } from "svelte";
  import { ApiError, get } from "../lib/api";
  import { centsToInput, formatMoney, parseMoney } from "../lib/money";
  import { photoUrl } from "../lib/photos";
  import { href, navigate } from "../lib/router.svelte";
  import {
    deleteReport,
    getReport,
    isProblem,
    listSales,
    sellItem,
    undoSale,
    updateReport,
    type Sale,
    type ShopReport,
  } from "../lib/sales";
  import { session } from "../lib/session.svelte";
  import { formatDay, todayLocal } from "../lib/status";
  import { itemNumber, STATUS_LABELS, type Item, type ItemList } from "../lib/types";

  // F16–F18: work through the shop's report line by line, entering each sale by item number.
  let { id }: { id: number } = $props();

  let report = $state<ShopReport | null>(null);
  let sales = $state<Sale[]>([]);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state("");

  // Entry
  let numberText = $state("");
  let candidate = $state<Item | null>(null);
  let lookupError = $state("");
  let price = $state("");
  let saleDate = $state("");
  let busy = $state(false);
  let numberEl = $state<HTMLInputElement>();

  // Fallback picker
  let picking = $state(false);
  let shopItems = $state<Item[]>([]);

  // Reported figures editor
  let editingTotals = $state(false);
  let repCount = $state("");
  let repTotal = $state("");

  const currency = $derived(session.settings.currency);
  const soldCents = $derived(parseMoney(price));
  const countDiff = $derived(report && report.reportedCount !== null ? sales.length - report.reportedCount : null);
  const totalDiff = $derived(
    report && report.reportedTotalCents !== null ? report.enteredTotalCents - report.reportedTotalCents : null,
  );
  const canSell = $derived(
    !!candidate && !candidate.sale && !candidate.archived && (candidate.status === "in_shop" || candidate.status === "in_studio"),
  );

  onMount(load);

  async function load() {
    try {
      const [r, s] = await Promise.all([getReport(id), listSales({ reportId: id })]);
      report = r;
      sales = s.sales;
      if (!saleDate) saleDate = r.periodEnd < todayLocal() ? r.periodEnd : todayLocal();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) notFound = true;
      else error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function lookup(e?: SubmitEvent) {
    e?.preventDefault();
    lookupError = "";
    candidate = null;
    const n = Number(numberText.trim().replace(/^#/, ""));
    if (!Number.isInteger(n) || n < 1) {
      lookupError = "Enter the item number from the report.";
      return;
    }
    try {
      showCandidate(await get<Item>(`/items/${n}`));
    } catch (err) {
      lookupError =
        err instanceof ApiError && err.status === 404
          ? `No item ${itemNumber(n)}. Check the number on the report.`
          : (err as Error).message;
    }
  }

  function showCandidate(item: Item) {
    candidate = item;
    price = centsToInput(item.priceCents);
    picking = false;
  }

  async function confirmSale() {
    if (!candidate || typeof soldCents !== "number" || !saleDate) return;
    busy = true;
    lookupError = "";
    try {
      const r = await sellItem({
        itemId: candidate.id,
        saleDate,
        soldCents,
        reportId: id,
        allowNotInShop: candidate.status !== "in_shop",
      });
      if (isProblem(r)) {
        lookupError = r.code === "duplicate" ? "That item was just sold elsewhere." : "That item can't be sold.";
        return;
      }
      sales = [r.sale, ...sales];
      report = await getReport(id);
      candidate = null;
      numberText = "";
      await tick();
      numberEl?.focus();
    } catch (err) {
      lookupError = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function removeSale(s: Sale) {
    if (!confirm(`Remove ${itemNumber(s.itemNumber)} ${s.itemName} from this report and undo the sale?`)) return;
    try {
      await undoSale(s.id);
      sales = sales.filter((x) => x.id !== s.id);
      report = await getReport(id);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function openPicker() {
    picking = !picking;
    if (picking) {
      const res = await get<ItemList>("/items?status=in_shop&sort=placed&limit=500");
      shopItems = res.items;
    }
  }

  function startEditTotals() {
    if (!report) return;
    repCount = report.reportedCount === null ? "" : String(report.reportedCount);
    repTotal = centsToInput(report.reportedTotalCents);
    editingTotals = true;
  }

  async function saveTotals(e: SubmitEvent) {
    e.preventDefault();
    const total = parseMoney(repTotal);
    if (total === undefined || (repCount && !/^\d+$/.test(repCount))) {
      error = "Enter whole numbers for the count and amounts like 120.50 for the total.";
      return;
    }
    error = "";
    report = await updateReport(id, { reportedCount: repCount ? Number(repCount) : null, reportedTotalCents: total });
    editingTotals = false;
  }

  async function setReconciled(reconciled: boolean) {
    report = await updateReport(id, { reconciled });
  }

  async function remove() {
    const msg = sales.length
      ? `Delete this report? Its ${sales.length} sale${sales.length === 1 ? "" : "s"} stay recorded but won't be linked to a report.`
      : "Delete this empty report?";
    if (!confirm(msg)) return;
    await deleteReport(id);
    navigate("/sales", { replace: true });
  }

  const signed = (cents: number) => (cents > 0 ? "+" : cents < 0 ? "−" : "") + formatMoney(Math.abs(cents), currency);
</script>

<p><a href={href("/sales")}>‹ Sales</a></p>

{#if loading}
  <p class="muted">Loading…</p>
{:else if notFound}
  <h1>Report not found</h1>
{:else if report}
  <h1>Report {formatDay(report.periodStart)} – {formatDay(report.periodEnd)}</h1>

  <div class="card summary" class:matched={countDiff === 0 && totalDiff === 0}>
    <div class="cols">
      <div>
        <span class="muted">Items</span>
        <strong>{sales.length}</strong>
        <span class="muted">{report.reportedCount === null ? "reported: —" : `of ${report.reportedCount} reported`}</span>
      </div>
      <div>
        <span class="muted">Total</span>
        <strong>{formatMoney(report.enteredTotalCents, currency)}</strong>
        <span class="muted">
          {report.reportedTotalCents === null ? "reported: —" : `of ${formatMoney(report.reportedTotalCents, currency)}`}
        </span>
      </div>
    </div>
    {#if (countDiff !== null && countDiff !== 0) || (totalDiff !== null && totalDiff !== 0)}
      <p class="diff">
        Not matching yet:
        {#if countDiff}{Math.abs(countDiff)} item{Math.abs(countDiff) === 1 ? "" : "s"} {countDiff < 0 ? "still to enter" : "more than reported"}{/if}
        {#if countDiff && totalDiff} · {/if}
        {#if totalDiff}{signed(totalDiff)} vs the report{/if}
      </p>
    {:else if countDiff === 0 && totalDiff === 0}
      <p class="ok">Matches the shop's report ✓</p>
    {/if}
    {#if editingTotals}
      <form class="row totals" onsubmit={saveTotals}>
        <input bind:value={repCount} inputmode="numeric" placeholder="Items" aria-label="Reported item count" />
        <input bind:value={repTotal} inputmode="decimal" placeholder="Total" aria-label="Reported total" />
        <button type="submit">Save</button>
      </form>
    {:else}
      <button class="link" onclick={startEditTotals}>Edit reported figures</button>
    {/if}
  </div>

  {#if report.reconciled}
    <p class="card done">Marked reconciled. <button class="link" onclick={() => setReconciled(false)}>Reopen</button></p>
  {:else}
    <section class="entry">
      <h2>Enter a sale</h2>
      <form class="row" onsubmit={lookup}>
        <input
          class="grow number"
          bind:this={numberEl}
          bind:value={numberText}
          inputmode="numeric"
          placeholder="Item #"
          aria-label="Item number"
          autocomplete="off"
        />
        <button type="submit" class="primary" disabled={!numberText.trim()}>Find</button>
      </form>
      <button class="link" onclick={openPicker}>{picking ? "Hide shop list" : "No number? Pick from what's in the shop"}</button>

      {#if lookupError}<p class="error" role="alert">{lookupError}</p>{/if}

      {#if picking}
        <ul class="pick">
          {#each shopItems as it (it.id)}
            <li>
              <button class="pick-row" onclick={() => showCandidate(it)}>
                <span class="num">{itemNumber(it.number)}</span>
                <span class="grow">{it.name}</span>
                <span>{formatMoney(it.priceCents, currency)}</span>
              </button>
            </li>
          {:else}
            <li class="muted">Nothing is in the shop.</li>
          {/each}
        </ul>
      {/if}

      {#if candidate}
        <div class="candidate card">
          <div class="row top">
            {#if candidate.coverPhotoId}
              <img src={photoUrl(candidate.coverPhotoId, "thumb")} alt="" width="72" height="72" />
            {/if}
            <div class="grow">
              <div><strong>{itemNumber(candidate.number)}</strong> {candidate.name}</div>
              <div class="muted">
                {STATUS_LABELS[candidate.status]}{#if candidate.location} · {candidate.location}{/if}
                · retail {formatMoney(candidate.priceCents, currency)}
              </div>
            </div>
          </div>

          {#if candidate.sale}
            <p class="warn">
              Already sold {formatDay(candidate.sale.saleDate)} for {formatMoney(candidate.sale.soldCents, currency)}
              {candidate.sale.reportId === id ? "on this report" : candidate.sale.reportId ? "on another report" : ""}.
              This may be a duplicate line or a misread number.
            </p>
          {:else if !canSell}
            <p class="warn">A {STATUS_LABELS[candidate.status].toLowerCase()}{candidate.archived ? ", archived" : ""} item can't be sold.</p>
          {:else}
            {#if candidate.status !== "in_shop"}
              <p class="warn">This item is recorded as in the studio, not the shop. Check the number before recording.</p>
            {/if}
            <div class="two">
              <div>
                <label for="rc-price">Sold for</label>
                <input id="rc-price" bind:value={price} inputmode="decimal" aria-invalid={soldCents === undefined} autocomplete="off" />
              </div>
              <div>
                <label for="rc-date">Sale date</label>
                <input id="rc-date" type="date" bind:value={saleDate} max={todayLocal()} />
              </div>
            </div>
            {#if typeof soldCents === "number" && candidate.priceCents !== null && soldCents !== candidate.priceCents}
              <p class="muted small">Different from the retail price; it will be flagged.</p>
            {/if}
          {/if}

          <div class="row actions">
            <button class="grow" onclick={() => { candidate = null; numberEl?.focus(); }}>Cancel</button>
            {#if canSell}
              <button class="grow primary" onclick={confirmSale} disabled={busy || typeof soldCents !== "number" || !saleDate}>
                {busy ? "Saving…" : candidate.status === "in_shop" ? "Record sale" : "Record anyway"}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}

  <h2>Entered ({sales.length})</h2>
  <ul class="entered">
    {#each sales as s (s.id)}
      <li>
        <a class="grow" href={href(`/items/${s.itemId}`)}>
          <span><strong>{itemNumber(s.itemNumber)}</strong> {s.itemName}</span>
          <span class="muted small">
            {formatDay(s.saleDate)}
            {#if s.priceDiffers}<span class="badge warn">retail {formatMoney(s.retailCents, currency)}</span>{/if}
            {#if s.notInShop}<span class="badge warn">wasn't in shop</span>{/if}
          </span>
        </a>
        <span class="amount">{formatMoney(s.soldCents, currency)}</span>
        {#if !report.reconciled}<button class="link del" onclick={() => removeSale(s)} aria-label="Remove sale">✕</button>{/if}
      </li>
    {:else}
      <li class="muted">Nothing entered yet.</li>
    {/each}
  </ul>

  <div class="footer row">
    {#if !report.reconciled}
      <button class="primary grow" onclick={() => setReconciled(true)} disabled={!sales.length}>Mark reconciled</button>
    {/if}
    <button class="danger" onclick={remove}>Delete report</button>
  </div>
{/if}

<style>
  h1 {
    font-size: 20px;
  }
  .summary .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .summary .cols div {
    display: flex;
    flex-direction: column;
  }
  .summary strong {
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }
  .summary .muted {
    font-size: 13px;
  }
  .summary.matched {
    outline: 2px solid var(--accent);
  }
  .diff {
    color: var(--warn-fg);
    background: var(--warn-bg);
    border-radius: 8px;
    padding: 6px 10px;
    margin: 10px 0 4px;
    font-size: 14px;
  }
  .ok {
    color: var(--accent);
    margin: 10px 0 4px;
    font-weight: 600;
  }
  .totals {
    margin-top: 8px;
    flex-wrap: nowrap;
  }
  .totals input {
    min-width: 0;
  }
  .done {
    margin-top: 12px;
  }
  .entry h2 {
    margin-top: 20px;
  }
  .number {
    font-size: 24px;
    letter-spacing: 0.05em;
    font-variant-numeric: tabular-nums;
  }
  .pick {
    list-style: none;
    padding: 0;
    margin: 8px 0;
    max-height: 40vh;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .pick-row {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    color: var(--fg);
    justify-content: flex-start;
    gap: 10px;
  }
  .num {
    font-weight: 600;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .candidate {
    margin-top: 12px;
  }
  .candidate .top {
    flex-wrap: nowrap;
    align-items: flex-start;
  }
  .candidate img {
    border-radius: 8px;
    object-fit: cover;
    flex: none;
  }
  .warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 14px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .small {
    font-size: 13px;
  }
  .actions {
    margin-top: 16px;
    flex-wrap: nowrap;
  }
  .entered {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .entered li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .entered a {
    display: flex;
    flex-direction: column;
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }
  .entered .badge {
    margin-left: 4px;
  }
  .amount {
    font-variant-numeric: tabular-nums;
  }
  .del {
    color: var(--danger);
    font-size: 18px;
    width: 32px;
  }
  .footer {
    margin: 24px 0 8px;
  }
</style>
