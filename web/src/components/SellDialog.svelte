<script lang="ts">
  import { centsToInput, formatMoney, parseMoney } from "../lib/money";
  import { isProblem, sellItem, updateSale, type Sale } from "../lib/sales";
  import { session } from "../lib/session.svelte";
  import { STATUS_LABELS, type Item } from "../lib/types";
  import { formatDay, todayLocal } from "../lib/status";

  // Records a sale for one item (F15), or edits an existing one when `sale` is given.
  let {
    item,
    sale,
    ondone,
    oncancel,
  }: {
    item: Item;
    sale?: Sale | null;
    ondone: () => void;
    oncancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let date = $state(sale?.saleDate ?? todayLocal());
  // svelte-ignore state_referenced_locally
  let price = $state(centsToInput(sale?.soldCents ?? item.priceCents));
  // svelte-ignore state_referenced_locally
  let note = $state(sale?.note ?? "");
  let busy = $state(false);
  let error = $state("");

  const soldCents = $derived(parseMoney(price));
  const notInShop = $derived(!sale && item.status !== "in_shop");
  const valid = $derived(!!date && date <= todayLocal() && typeof soldCents === "number");
  const currency = $derived(session.settings.currency);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || typeof soldCents !== "number") return;
    busy = true;
    error = "";
    try {
      if (sale) {
        await updateSale(sale.id, { saleDate: date, soldCents, note });
      } else {
        const r = await sellItem({ itemId: item.id, saleDate: date, soldCents, note, allowNotInShop: notInShop });
        if (isProblem(r)) {
          error =
            r.code === "duplicate"
              ? `Already sold on ${formatDay(r.sale.saleDate)}.`
              : r.code === "not_sellable"
                ? `A ${STATUS_LABELS[r.status].toLowerCase()} item can't be sold.`
                : "Item not found.";
          busy = false;
          return;
        }
      }
      ondone();
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && oncancel()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sell-title">
    <form onsubmit={submit} novalidate>
      <h2 id="sell-title">{sale ? "Edit sale" : "Mark sold"}: {item.name}</h2>

      {#if notInShop}
        <p class="warn card">This item is recorded as {STATUS_LABELS[item.status].toLowerCase()}, not in the shop.</p>
      {/if}

      <div class="two">
        <div>
          <label for="sell-price">Sold for</label>
          <input id="sell-price" bind:value={price} inputmode="decimal" aria-invalid={soldCents === undefined} autocomplete="off" />
        </div>
        <div>
          <label for="sell-date">Sale date</label>
          <input id="sell-date" type="date" bind:value={date} max={todayLocal()} required />
        </div>
      </div>
      {#if typeof soldCents === "number" && item.priceCents !== null && soldCents !== item.priceCents}
        <p class="muted small">Retail price is {formatMoney(item.priceCents, currency)}.</p>
      {/if}
      {#if soldCents === null || soldCents === undefined}<p class="error small">Enter the amount it sold for.</p>{/if}

      <label for="sell-note">Note <span class="muted small">(optional)</span></label>
      <input id="sell-note" bind:value={note} maxlength="500" autocomplete="off" />

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <div class="row actions">
        <button type="button" class="grow" onclick={oncancel} disabled={busy}>Cancel</button>
        <button type="submit" class="grow primary" disabled={busy || !valid}>
          {busy ? "Saving…" : sale ? "Save" : notInShop ? "Record sale anyway" : "Mark sold"}
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgb(0 0 0 / 0.45);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .sheet {
    width: 100%;
    max-width: 520px;
    background: var(--bg);
    border-radius: 16px 16px 0 0;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  }
  h2 {
    margin-top: 0;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .small {
    font-size: 13px;
    margin: 6px 0 0;
  }
  .actions {
    margin-top: 20px;
    flex-wrap: nowrap;
  }
</style>
