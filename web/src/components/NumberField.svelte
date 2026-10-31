<script lang="ts">
  import { ApiError, get } from "../lib/api";
  import { href } from "../lib/router.svelte";
  import { itemNumber, type Item } from "../lib/types";

  // The tag number on the item's price tag. Owners often have pre-printed tags, so it's
  // editable; we check it's free as they type (the server enforces it again on save).
  let {
    value = $bindable(""),
    itemId,
    ok = $bindable(true),
    id = "number",
  }: { value?: string; itemId?: number; ok?: boolean; id?: string } = $props();

  let taken = $state<Pick<Item, "id" | "number" | "name"> | null>(null);
  let checking = $state(false);

  const parsed = $derived(/^#?\d{1,6}$/.test(value.trim()) ? Number(value.trim().replace("#", "")) : NaN);
  const formatOk = $derived(Number.isInteger(parsed) && parsed >= 1);

  let timer: ReturnType<typeof setTimeout>;
  let seq = 0;
  $effect(() => {
    const n = parsed;
    const valid = formatOk;
    clearTimeout(timer);
    taken = null;
    if (!valid) {
      ok = false;
      return;
    }
    checking = true;
    ok = false;
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const found = await get<Item>(`/items/by-number/${n}`);
        if (mine !== seq) return;
        taken = found.id === itemId ? null : found;
      } catch (e) {
        if (mine !== seq) return;
        if (!(e instanceof ApiError && e.status === 404)) taken = null;
      } finally {
        if (mine === seq) {
          checking = false;
          ok = !taken;
        }
      }
    }, 250);
  });

  /** Lets the parent show a server-side duplicate (e.g. a number taken between check and save). */
  export function markTaken(item: Pick<Item, "id" | "number" | "name">) {
    taken = item;
    ok = false;
  }
</script>

<label for={id}>Tag number</label>
<input
  {id}
  bind:value
  inputmode="numeric"
  autocomplete="off"
  class="number"
  aria-invalid={!formatOk || !!taken}
  aria-describedby={`${id}-msg`}
/>
<p id={`${id}-msg`} class="msg" aria-live="polite">
  {#if value.trim() && !formatOk}
    <span class="error">Use a whole number, up to 6 digits.</span>
  {:else if taken}
    <span class="error">
      {itemNumber(taken.number)} is already used by
      <a href={href(`/items/${taken.id}`)}>{taken.name}</a>.
    </span>
  {:else if checking}
    <span class="muted">Checking…</span>
  {:else if formatOk}
    <span class="muted">Shown as {itemNumber(parsed)}</span>
  {/if}
</p>

<style>
  .number {
    font-size: 20px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    max-width: 200px;
  }
  .msg {
    font-size: 13px;
    margin: 4px 0 0;
    min-height: 1.3em;
  }
</style>
