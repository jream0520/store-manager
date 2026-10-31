<script lang="ts">
  import { post } from "../lib/api";
  import { formatMoney, parseMoney } from "../lib/money";
  import { href } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { itemNumber, type Item } from "../lib/types";

  // PRD F7: capture just a name and price now; fill in cost/category later (flagged incomplete).
  let name = $state("");
  let price = $state("");
  let busy = $state(false);
  let error = $state("");
  let added = $state<Item[]>([]);
  let nameEl = $state<HTMLInputElement>();

  const priceCents = $derived(parseMoney(price));
  const valid = $derived(name.trim().length > 0 && priceCents !== undefined);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    busy = true;
    error = "";
    try {
      const item = await post<Item>("/items", { name: name.trim(), priceCents });
      added = [item, ...added];
      name = "";
      price = "";
      nameEl?.focus();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<p><a href={href("/")}>‹ Items</a></p>
<h1>Quick add</h1>
<p class="muted">Name and price now; add cost and category later.</p>

<form onsubmit={submit} novalidate>
  <label for="qa-name">Name</label>
  <!-- svelte-ignore a11y_autofocus -->
  <input id="qa-name" bind:this={nameEl} bind:value={name} maxlength="120" autocomplete="off" autofocus />
  <label for="qa-price">Price</label>
  <input id="qa-price" bind:value={price} inputmode="decimal" placeholder="0.00" aria-invalid={priceCents === undefined} autocomplete="off" />
  {#if priceCents === undefined}<p class="error">Enter an amount like 12 or 12.50.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button class="primary" type="submit" disabled={busy || !valid}>{busy ? "Adding…" : "Add & next"}</button>
</form>

{#if added.length}
  <h2>Added this session</h2>
  <ul>
    {#each added as it (it.id)}
      <li>
        <a href={href(`/items/${it.id}`)}><strong>{itemNumber(it.number)}</strong> {it.name}</a>
        <span class="muted">{formatMoney(it.priceCents, session.settings.currency)}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  button {
    width: 100%;
    margin-top: 16px;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  li a {
    color: inherit;
    text-decoration: none;
  }
</style>
