<script lang="ts">
  import { onMount } from "svelte";
  import PhotoManager, { type PendingPhoto } from "../components/PhotoManager.svelte";
  import StatusDialog from "../components/StatusDialog.svelte";
  import { get, patch, post } from "../lib/api";
  import { centsToInput, formatMoney, parseMoney } from "../lib/money";
  import { uploadPending } from "../lib/photos";
  import { href, navigate } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { ACTIONS, actionsFor, applyAction, daysSince, formatDay, type Action, type ActionDetails } from "../lib/status";
  import { itemNumber, STATUS_LABELS, type Category, type HistoryEntry, type Item } from "../lib/types";

  let { id }: { id?: number } = $props();

  let item = $state<Item | null>(null);
  let categories = $state<Category[]>([]);
  let loading = $state(true);
  let notFound = $state(false);

  let name = $state("");
  let price = $state("");
  let cost = $state("");
  let categoryId = $state("");
  let tags = $state("");
  let description = $state("");
  let notes = $state("");

  let busy = $state(false);
  let busyLabel = $state("");
  let pendingPhotos = $state<PendingPhoto[]>([]);
  let dialog = $state<Action | null>(null);
  let events = $state<HistoryEntry[]>([]);
  let error = $state("");
  let saved = $state(false);
  let tried = $state(false);

  const priceCents = $derived(parseMoney(price));
  const costCents = $derived(parseMoney(cost));
  const nameOk = $derived(name.trim().length > 0);
  const valid = $derived(nameOk && priceCents !== undefined && costCents !== undefined);
  const profit = $derived(
    typeof priceCents === "number" && typeof costCents === "number" ? priceCents - costCents : null,
  );
  const currency = $derived(session.settings.currency);

  onMount(async () => {
    try {
      const [cats, existing] = await Promise.all([
        get<Category[]>("/categories"),
        id ? get<Item>(`/items/${id}`) : Promise.resolve(null),
      ]);
      categories = cats;
      if (existing) {
        fill(existing);
        loadHistory();
      }
      else if (id) notFound = true;
    } catch (e) {
      if ((e as { status?: number }).status === 404) notFound = true;
      else error = (e as Error).message;
    } finally {
      loading = false;
    }
  });

  function fill(it: Item) {
    item = it;
    name = it.name;
    price = centsToInput(it.priceCents);
    cost = centsToInput(it.costCents);
    categoryId = it.categoryId ? String(it.categoryId) : "";
    tags = it.tags.join(", ");
    description = it.description;
    notes = it.notes;
  }

  async function onCategoryChange() {
    if (categoryId !== "__new") return;
    const n = prompt("New category name")?.trim();
    if (!n) {
      categoryId = item?.categoryId ? String(item.categoryId) : "";
      return;
    }
    try {
      const existing = categories.find((c) => c.name.toLowerCase() === n.toLowerCase());
      const c = existing ?? (await post<Category>("/categories", { name: n }));
      if (!existing) categories = [...categories, c].sort((a, b) => a.name.localeCompare(b.name));
      categoryId = String(c.id);
    } catch (e) {
      error = (e as Error).message;
      categoryId = "";
    }
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    tried = true;
    if (!valid) return;
    busy = true;
    error = "";
    const body = {
      name: name.trim(),
      priceCents,
      costCents,
      categoryId: categoryId ? Number(categoryId) : null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      description,
      notes,
    };
    try {
      if (item) {
        fill(await patch<Item>(`/items/${item.id}`, body));
        flashSaved();
        loadHistory();
      } else {
        busyLabel = "Saving…";
        const created = await post<Item>("/items", body);
        const failed = await uploadPending(created.id, pendingPhotos, (done, total) => {
          busyLabel = `Uploading photo ${done + 1} of ${total}…`;
        });
        pendingPhotos = [];
        navigate(`/items/${created.id}?created=1${failed ? `&failed=${failed}` : ""}`, { replace: true });
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function setArchived(archived: boolean) {
    if (!item) return;
    if (archived && !confirm(`Archive “${item.name}”? It will be hidden from the list but not deleted.`)) return;
    try {
      fill(await patch<Item>(`/items/${item.id}`, { archived }));
    } catch (err) {
      error = (err as Error).message;
    }
  }

  let savedTimer: ReturnType<typeof setTimeout>;
  function flashSaved() {
    saved = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved = false), 2000);
  }

  const justCreated = new URLSearchParams(location.search).get("created") === "1";
  const failedUploads = Number(new URLSearchParams(location.search).get("failed") ?? 0);

  async function refreshItem() {
    if (item) item = await get<Item>(`/items/${item.id}`);
  }

  async function loadHistory() {
    if (item) events = await get<HistoryEntry[]>(`/items/${item.id}/history`).catch(() => events);
  }

  async function runAction(d: ActionDetails) {
    if (!item || !dialog) return;
    const [updated] = await applyAction([item.id], dialog, d);
    item = updated;
    dialog = null;
    loadHistory();
  }

  async function editLocation() {
    if (!item) return;
    const loc = prompt("Where is it in the shop?", item.location ?? "");
    if (loc === null) return;
    try {
      item = await patch<Item>(`/items/${item.id}/placement`, { location: loc });
      error = "";
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function describe(h: HistoryEntry): string {
    if (h.type === "price") {
      return `Price ${formatMoney(h.oldCents, currency)} → ${formatMoney(h.newCents, currency)}`;
    }
    const base =
      h.to === "in_shop" ? "Placed in shop" :
      h.from === "in_shop" && h.to === "in_studio" ? "Pulled back to studio" :
      h.to === "written_off" ? "Written off" :
      h.from === "written_off" ? "Restored to studio" :
      `${STATUS_LABELS[h.from]} → ${STATUS_LABELS[h.to]}`;
    return h.note ? `${base} · ${h.note}` : base;
  }
</script>

<p><a href={href("/")} onclick={(e) => { if (history.length > 1 && !justCreated) { e.preventDefault(); history.back(); } }}>‹ Items</a></p>

{#if loading}
  <p class="muted">Loading…</p>
{:else if notFound}
  <h1>Item not found</h1>
  <p>There's no item with that number.</p>
{:else}
  {#if item}
    <div class="numhead">
      <span class="tag" aria-label="Tag number">{itemNumber(item.number)}</span>
      <span class="badge">{STATUS_LABELS[item.status]}</span>
      {#if item.incomplete}<span class="badge warn">Incomplete</span>{/if}
      {#if item.archived}<span class="badge">Archived</span>{/if}
    </div>
    {#if justCreated}<p class="created card">Saved. Write <strong>{itemNumber(item.number)}</strong> on the price tag.</p>{/if}
    {#if failedUploads}<p class="error">{failedUploads} photo{failedUploads === 1 ? "" : "s"} didn't upload. Add {failedUploads === 1 ? "it" : "them"} again below.</p>{/if}
    <PhotoManager itemId={item.id} onchange={refreshItem} />

    <div class="status card">
      <div>
        <strong>{STATUS_LABELS[item.status]}</strong>
        {#if item.status === "in_shop" && item.placedOn}
          <span class="muted">since {formatDay(item.placedOn)} ({daysSince(item.placedOn)} days)</span>
          <div class="muted loc">
            {item.location || "No location noted"}
            <button type="button" class="link" onclick={editLocation}>{item.location ? "Change" : "Add"}</button>
          </div>
        {/if}
      </div>
      {#if !item.archived}
        <div class="row status-actions">
          {#each actionsFor([item.status]) as a}
            <button type="button" class={a === "write_off" ? "danger" : a === "place" ? "primary" : ""} onclick={() => (dialog = a)}>
              {ACTIONS[a].label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <h1>New item</h1>
    <PhotoManager bind:pending={pendingPhotos} />
  {/if}

  <form onsubmit={save} novalidate>
    <label for="name">Name</label>
    <input id="name" bind:value={name} maxlength="120" aria-invalid={tried && !nameOk} autocomplete="off" />
    {#if tried && !nameOk}<p class="error">Name is required.</p>{/if}

    <div class="two">
      <div>
        <label for="price">Price</label>
        <input id="price" bind:value={price} inputmode="decimal" placeholder="0.00" aria-invalid={priceCents === undefined} autocomplete="off" />
      </div>
      <div>
        <label for="cost">Materials cost</label>
        <input id="cost" bind:value={cost} inputmode="decimal" placeholder="0.00" aria-invalid={costCents === undefined} autocomplete="off" />
      </div>
    </div>
    {#if priceCents === undefined || costCents === undefined}
      <p class="error">Enter amounts like 12 or 12.50.</p>
    {:else if profit !== null}
      <p class="muted profit">Profit if sold at this price: {formatMoney(profit, currency)}</p>
    {/if}

    <label for="cat">Category</label>
    <select id="cat" bind:value={categoryId} onchange={onCategoryChange}>
      <option value="">Uncategorized</option>
      {#each categories as c}<option value={String(c.id)}>{c.name}</option>{/each}
      <option value="__new">+ New category…</option>
    </select>

    <label for="tags">Tags <span class="hint">(comma separated)</span></label>
    <input id="tags" bind:value={tags} placeholder="silk, blue, hand-dyed" autocomplete="off" autocapitalize="none" />

    <label for="desc">Description</label>
    <textarea id="desc" bind:value={description} maxlength="4000"></textarea>

    <label for="notes">Private notes</label>
    <textarea id="notes" bind:value={notes} maxlength="4000"></textarea>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="actions row">
      <button class="primary grow" type="submit" disabled={busy}>
        {busy ? busyLabel || "Saving…" : saved ? "Saved ✓" : item ? "Save changes" : "Create item"}
      </button>
    </div>
  </form>

  {#if item && events.length}
    <h2>History</h2>
    <ul class="history">
      {#each events as h}
        <li>
          <span class="when">{h.type === "status" ? formatDay(h.on) : formatDay(h.recordedAt.slice(0, 10))}</span>
          <span>{describe(h)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if item}
    <div class="archive">
      {#if item.archived}
        <button onclick={() => setArchived(false)}>Restore from archive</button>
      {:else}
        <button class="danger" onclick={() => setArchived(true)}>Archive item</button>
      {/if}
    </div>
  {/if}
{/if}

{#if dialog && item}
  <StatusDialog action={dialog} count={1} onconfirm={runAction} oncancel={() => (dialog = null)} />
{/if}

<style>
  .numhead {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 8px 0 4px;
  }
  .tag {
    font-size: 32px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    margin-right: 4px;
  }
  .created {
    margin: 8px 0;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .profit {
    font-size: 14px;
    margin: 6px 0 0;
  }
  .hint {
    font-size: 12px;
  }
  .actions {
    margin-top: 20px;
    position: sticky;
    bottom: calc(68px + env(safe-area-inset-bottom));
  }
  .status {
    margin: 12px 0 4px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .loc {
    font-size: 14px;
    margin-top: 2px;
  }
  .loc .link {
    font-size: 14px;
    min-height: 0;
    margin-left: 6px;
  }
  .status-actions button {
    flex: 1 1 auto;
  }
  .history {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 14px;
  }
  .history li {
    display: flex;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .when {
    color: var(--muted);
    min-width: 4.5em;
    font-variant-numeric: tabular-nums;
  }
  .archive {
    margin: 32px 0 16px;
  }
</style>
