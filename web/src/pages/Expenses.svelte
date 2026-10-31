<script lang="ts">
  import { onMount } from "svelte";
  import { addExpense, editExpense, EXPENSE_CATEGORIES, formatMonth, listExpenses, removeExpense, type Expense, type ExpenseCategory } from "../lib/insights";
  import { centsToInput, formatMoney, parseMoney } from "../lib/money";
  import { href } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { formatDay, todayLocal } from "../lib/status";

  // F22: costs not tied to one item, so reports can show net profit.
  let expenses = $state<Expense[]>([]);
  let loading = $state(true);
  let error = $state("");

  let editing = $state<Expense | null>(null);
  let spentOn = $state(todayLocal());
  let category = $state<ExpenseCategory>("rent");
  let amount = $state("");
  let note = $state("");
  let busy = $state(false);
  let formError = $state("");

  const currency = $derived(session.settings.currency);
  const amountCents = $derived(parseMoney(amount));
  const byMonth = $derived.by(() => {
    const groups = new Map<string, Expense[]>();
    for (const e of expenses) {
      const m = e.spentOn.slice(0, 7);
      groups.set(m, [...(groups.get(m) ?? []), e]);
    }
    return [...groups.entries()].map(([month, list]) => ({
      month,
      list,
      total: list.reduce((n, e) => n + e.amountCents, 0),
    }));
  });
  // The most recent rent entry, for a one-tap "same again this month".
  const lastRent = $derived(expenses.find((e) => e.category === "rent"));

  onMount(load);

  async function load() {
    try {
      expenses = await listExpenses();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function startEdit(e: Expense) {
    editing = e;
    spentOn = e.spentOn;
    category = e.category;
    amount = centsToInput(e.amountCents);
    note = e.note;
    formError = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    editing = null;
    spentOn = todayLocal();
    amount = "";
    note = "";
    formError = "";
  }

  function repeatRent() {
    if (!lastRent) return;
    reset();
    category = "rent";
    amount = centsToInput(lastRent.amountCents);
    note = lastRent.note;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    formError = "";
    if (typeof amountCents !== "number" || amountCents <= 0) return void (formError = "Enter an amount like 150 or 150.00.");
    if (!spentOn || spentOn > todayLocal()) return void (formError = "Pick a date that isn't in the future.");
    busy = true;
    try {
      const body = { spentOn, category, amountCents, note: note.trim() };
      if (editing) await editExpense(editing.id, body);
      else await addExpense(body);
      reset();
      await load();
    } catch (err) {
      formError = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!editing || !confirm("Delete this expense?")) return;
    await removeExpense(editing.id);
    reset();
    await load();
  }
</script>

<p><a href={href("/sales")}>‹ Sales & profit</a></p>
<h1>Expenses</h1>

<form class="card" onsubmit={save} novalidate>
  <h2>{editing ? "Edit expense" : "Add expense"}</h2>
  <div class="two">
    <div>
      <label for="x-amount">Amount</label>
      <input id="x-amount" bind:value={amount} inputmode="decimal" placeholder="0.00" autocomplete="off" />
    </div>
    <div>
      <label for="x-date">Date</label>
      <input id="x-date" type="date" bind:value={spentOn} max={todayLocal()} />
    </div>
  </div>
  <label for="x-cat">Category</label>
  <select id="x-cat" bind:value={category}>
    {#each Object.entries(EXPENSE_CATEGORIES) as [value, label]}<option {value}>{label}</option>{/each}
  </select>
  <label for="x-note">Note <span class="muted small">(optional)</span></label>
  <input id="x-note" bind:value={note} maxlength="500" placeholder="e.g. November booth" autocomplete="off" />
  {#if formError}<p class="error">{formError}</p>{/if}
  <div class="row actions">
    {#if editing}
      <button type="button" class="danger" onclick={remove}>Delete</button>
      <button type="button" class="grow" onclick={reset}>Cancel</button>
    {:else if lastRent}
      <button type="button" class="grow" onclick={repeatRent}>Rent again ({formatMoney(lastRent.amountCents, currency)})</button>
    {/if}
    <button type="submit" class="primary grow" disabled={busy}>{editing ? "Save" : "Add"}</button>
  </div>
</form>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

{#each byMonth as g (g.month)}
  <div class="row month">
    <h2 class="grow">{formatMonth(g.month)}</h2>
    <span class="muted">{formatMoney(g.total, currency)}</span>
  </div>
  <ul class="list">
    {#each g.list as e (e.id)}
      <li>
        <button class="rowbtn" onclick={() => startEdit(e)}>
          <span class="when">{formatDay(e.spentOn)}</span>
          <span class="grow">
            {EXPENSE_CATEGORIES[e.category]}{#if e.note}<span class="muted"> · {e.note}</span>{/if}
          </span>
          <span class="amt">{formatMoney(e.amountCents, currency)}</span>
        </button>
      </li>
    {/each}
  </ul>
{:else}
  {#if !loading}<p class="muted">No expenses yet. Add booth rent and fees here to see net profit.</p>{/if}
{/each}

<style>
  form h2 {
    margin-top: 0;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .small {
    font-size: 12px;
  }
  .actions {
    margin-top: 16px;
  }
  .month h2 {
    margin: 20px 0 4px;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .rowbtn {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    color: var(--fg);
    justify-content: flex-start;
    gap: 12px;
    padding: 0;
    text-align: left;
  }
  .when {
    color: var(--muted);
    min-width: 4em;
    font-size: 14px;
  }
  .amt {
    font-variant-numeric: tabular-nums;
  }
</style>
