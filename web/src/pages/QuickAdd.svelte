<script lang="ts">
  import { onMount } from "svelte";
  import NumberField from "../components/NumberField.svelte";
  import PhotoManager, { type PendingPhoto } from "../components/PhotoManager.svelte";
  import { ApiError, get, post } from "../lib/api";
  import { uploadPending } from "../lib/photos";
  import { formatMoney, parseMoney } from "../lib/money";
  import { href } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { itemNumber, type Item } from "../lib/types";

  // PRD F7: capture a photo, name and price now; fill in cost/category later (flagged incomplete).
  let numberText = $state("");
  let numberOk = $state(false);
  let numberField = $state<ReturnType<typeof NumberField>>();
  let name = $state("");
  let price = $state("");
  let busy = $state(false);
  let error = $state("");
  let added = $state<(Item & { hasPhoto: boolean; photoFailed: boolean })[]>([]);
  let pending = $state<PendingPhoto[]>([]);
  // Remounts the photo picker after each add so it starts empty.
  let round = $state(0);
  let nameEl = $state<HTMLInputElement>();

  const priceCents = $derived(parseMoney(price));
  const valid = $derived(numberOk && name.trim().length > 0 && priceCents !== undefined);

  onMount(suggestNumber);

  async function suggestNumber() {
    numberText = String((await get<{ number: number }>("/items/next-number")).number);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    busy = true;
    error = "";
    try {
      const number = Number(numberText.trim().replace("#", ""));
      const item = await post<Item>("/items", { number, name: name.trim(), priceCents });
      const hadPhoto = pending.length > 0;
      const photoFailed = (await uploadPending(item.id, pending)) > 0;
      pending = [];
      round++;
      added = [{ ...item, hasPhoto: hadPhoto && !photoFailed, photoFailed }, ...added];
      name = "";
      price = "";
      await suggestNumber();
      nameEl?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.data.code === "duplicate_number") {
        numberField?.markTaken(err.data.item as Item);
        error = "That tag number is already used.";
      } else {
        error = (err as Error).message;
      }
    } finally {
      busy = false;
    }
  }
</script>

<p><a href={href("/")}>‹ Items</a></p>
<h1>Quick add</h1>
<p class="muted">Photo, name and price now; add cost and category later.</p>

{#key round}<PhotoManager bind:pending max={1} />{/key}

<form onsubmit={submit} novalidate>
  <NumberField id="qa-number" bind:this={numberField} bind:value={numberText} bind:ok={numberOk} />
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
        {#if it.photoFailed}<span class="error">photo failed</span>{:else if it.hasPhoto}<span class="muted">📷</span>{/if}
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
