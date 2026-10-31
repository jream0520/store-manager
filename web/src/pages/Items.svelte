<script lang="ts">
  import { onMount } from "svelte";
  import StatusDialog from "../components/StatusDialog.svelte";
  import { get } from "../lib/api";
  import { formatMoney } from "../lib/money";
  import { photoUrl } from "../lib/photos";
  import { href, navigate, route } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { ACTIONS, actionsFor, applyAction, daysSince, formatDay, type Action, type ActionDetails } from "../lib/status";
  import { itemNumber, STATUS_LABELS, type Category, type Item, type ItemList, type Status } from "../lib/types";

  // "all": the full catalog. "shop": only what's on display now (F13), oldest placement first.
  let { view = "all" }: { view?: "all" | "shop" } = $props();

  const PAGE = 100;
  // App remounts this page per route, so reading the prop once is correct.
  // svelte-ignore state_referenced_locally
  const shop = view === "shop";
  const basePath = shop ? "/shop" : "/";
  const defaultSort = shop ? "placed" : "newest";

  // Filters live in the URL so Back from an item returns to the same list.
  const q0 = route.query;
  let q = $state(q0.get("q") ?? "");
  let status = $state(q0.get("status") ?? "");
  let categoryId = $state(q0.get("category") ?? "");
  let incomplete = $state(q0.get("incomplete") === "1");
  let archived = $state(q0.get("archived") === "1");
  let sort = $state(q0.get("sort") ?? defaultSort);

  let items = $state<Item[]>([]);
  let total = $state(0);
  let totalPriceCents = $state(0);
  let categories = $state<Category[]>([]);
  let loading = $state(true);
  let error = $state("");
  let notice = $state("");
  // Start with the filter panel open if the URL carried any filters.
  let filtersOpen = $state(["status", "category", "incomplete", "archived", "sort"].some((k) => q0.has(k)));

  // Bulk selection (F12, F14).
  let selecting = $state(false);
  let selected = $state<number[]>([]);
  let dialog = $state<Action | null>(null);

  const activeFilters = $derived(
    [status, categoryId, incomplete, archived, sort !== defaultSort].filter(Boolean).length,
  );
  const selectedStatuses = $derived([...new Set(items.filter((i) => selected.includes(i.id)).map((i) => i.status))]);
  const bulkActions = $derived(actionsFor(selectedStatuses));
  const currency = $derived(session.settings.currency);

  onMount(() => {
    get<Category[]>("/categories").then((c) => (categories = c));
  });

  let timer: ReturnType<typeof setTimeout>;
  let requestId = 0;
  $effect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (categoryId) params.set("category", categoryId);
    if (incomplete) params.set("incomplete", "1");
    if (archived) params.set("archived", "1");
    if (sort !== defaultSort) params.set("sort", sort);
    const qs = params.toString();
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        navigate(`${basePath}${qs ? `?${qs}` : ""}`, { replace: true });
        load(false);
      },
      q.trim() ? 250 : 0,
    );
  });

  async function load(append: boolean) {
    const id = ++requestId;
    loading = true;
    error = "";
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(append ? items.length : 0), sort });
    if (q.trim()) params.set("q", q.trim());
    if (shop) params.set("status", "in_shop");
    else if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (incomplete && !shop) params.set("incomplete", "true");
    if (archived && !shop) params.set("archived", "only");
    try {
      const res = await get<ItemList>(`/items?${params}`);
      if (id !== requestId) return; // a newer search superseded this one
      items = append ? [...items, ...res.items] : res.items;
      total = res.total;
      totalPriceCents = res.totalPriceCents;
      if (!append) selected = selected.filter((s) => items.some((i) => i.id === s));
    } catch (e) {
      if (id === requestId) error = (e as Error).message;
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function clearFilters() {
    status = "";
    categoryId = "";
    incomplete = false;
    archived = false;
    sort = defaultSort;
  }

  function toggleSelecting() {
    selecting = !selecting;
    selected = [];
    notice = "";
  }

  function toggle(id: number) {
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  }

  function toggleAll() {
    selected = selected.length === items.length ? [] : items.map((i) => i.id);
  }

  async function runBulk(d: ActionDetails) {
    if (!dialog) return;
    const done = await applyAction(selected, dialog, d);
    notice = `${ACTIONS[dialog].done}: ${done.length} item${done.length === 1 ? "" : "s"}.`;
    dialog = null;
    selecting = false;
    selected = [];
    await load(false);
  }

  function rowMeta(item: Item): string {
    if (shop && item.placedOn) {
      const parts = [`${daysSince(item.placedOn)}d · since ${formatDay(item.placedOn)}`];
      if (item.location) parts.push(item.location);
      return parts.join(" · ");
    }
    const parts = [item.categoryName ?? "Uncategorized"];
    if (item.status !== "in_studio") parts.push(STATUS_LABELS[item.status as Status]);
    return parts.join(" · ");
  }
</script>

<div class="head row">
  <h1 class="grow">{shop ? "In shop" : "Items"}</h1>
  {#if items.length}
    <button onclick={toggleSelecting}>{selecting ? "Done" : "Select"}</button>
  {/if}
  {#if !selecting && !shop}
    <a class="button" href={href("/items/quick")}>Quick add</a>
    <a class="button primary" href={href("/items/new")}>+ New</a>
  {/if}
</div>

{#if shop}
  <p class="summary card">
    <strong>{total}</strong> item{total === 1 ? "" : "s"} on display ·
    <strong>{formatMoney(totalPriceCents, currency)}</strong> retail value
  </p>
{/if}

<div class="row">
  <input
    class="grow"
    type="search"
    bind:value={q}
    placeholder="Search name, tag, or number"
    aria-label="Search items"
    autocomplete="off"
    inputmode="search"
  />
  <button onclick={() => (filtersOpen = !filtersOpen)} aria-expanded={filtersOpen}>
    Filters{activeFilters ? ` (${activeFilters})` : ""}
  </button>
</div>

{#if filtersOpen}
  <div class="filters card">
    <div class="grid">
      {#if !shop}
        <div>
          <label for="f-status">Status</label>
          <select id="f-status" bind:value={status}>
            <option value="">Any</option>
            {#each Object.entries(STATUS_LABELS) as [value, label]}<option {value}>{label}</option>{/each}
          </select>
        </div>
      {/if}
      <div>
        <label for="f-cat">Category</label>
        <select id="f-cat" bind:value={categoryId}>
          <option value="">Any</option>
          <option value="none">Uncategorized</option>
          {#each categories as c}<option value={String(c.id)}>{c.name}</option>{/each}
        </select>
      </div>
      <div>
        <label for="f-sort">Sort</label>
        <select id="f-sort" bind:value={sort}>
          {#if shop}<option value="placed">Longest in shop</option>{/if}
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </div>
    </div>
    <div class="row checks">
      {#if !shop}
        <label class="check"><input type="checkbox" bind:checked={incomplete} /> Incomplete only</label>
        <label class="check"><input type="checkbox" bind:checked={archived} /> Archived</label>
      {/if}
      {#if activeFilters}<button class="link" onclick={clearFilters}>Clear</button>{/if}
    </div>
  </div>
{/if}

{#if error}<p class="error">{error}</p>{/if}
{#if notice}<p class="notice card" role="status">{notice}</p>{/if}

<div class="row count">
  <p class="muted grow">
    {#if loading && !items.length}Loading…{:else}{total} item{total === 1 ? "" : "s"}{/if}
  </p>
  {#if selecting}
    <button class="link" onclick={toggleAll}>{selected.length === items.length ? "Select none" : "Select all"}</button>
  {/if}
</div>

<ul class="list" class:selecting>
  {#each items as item (item.id)}
    {@const isSel = selected.includes(item.id)}
    <li>
      <a
        href={href(`/items/${item.id}`)}
        role={selecting ? "checkbox" : undefined}
        aria-checked={selecting ? isSel : undefined}
        onclick={(e) => {
          if (selecting) {
            e.preventDefault();
            toggle(item.id);
          }
        }}
      >
        {#if selecting}<span class="check-box" class:on={isSel} aria-hidden="true">{isSel ? "✓" : ""}</span>{/if}
        {#if item.coverPhotoId}
          <img class="thumb" src={photoUrl(item.coverPhotoId, "thumb")} alt="" loading="lazy" width="52" height="52" />
        {:else}
          <span class="thumb none" aria-hidden="true"></span>
        {/if}
        <span class="main">
          <span class="name"><span class="num">{itemNumber(item.number)}</span> {item.name}</span>
          <span class="meta">{rowMeta(item)}</span>
        </span>
        <span class="side">
          <span class="price">{formatMoney(item.priceCents, currency)}</span>
          {#if item.incomplete && !shop}<span class="badge warn">Incomplete</span>{/if}
          {#if item.archived}<span class="badge">Archived</span>{/if}
        </span>
      </a>
    </li>
  {/each}
</ul>

{#if !loading && !items.length && !error}
  <div class="empty">
    {#if q || activeFilters}
      <p>No items match.</p>
    {:else if shop}
      <p>Nothing is in the shop yet.</p>
      <p class="muted">On the Items tab, tap Select, choose items, then “Place in shop”.</p>
    {:else}
      <p>No items yet.</p>
      <a class="button primary" href={href("/items/new")}>Add your first item</a>
    {/if}
  </div>
{/if}

{#if items.length < total}
  <button class="more" onclick={() => load(true)} disabled={loading}>Load more</button>
{/if}

{#if selecting}
  <div class="bulkbar">
    <span class="muted">{selected.length} selected</span>
    {#if selected.length && !bulkActions.length}
      <span class="muted small">No action fits all of these.</span>
    {/if}
    <div class="row">
      {#each bulkActions as a}
        <button class={a === "write_off" ? "danger" : "primary"} onclick={() => (dialog = a)}>{ACTIONS[a].label}</button>
      {/each}
    </div>
  </div>
{/if}

{#if dialog}
  <StatusDialog action={dialog} count={selected.length} onconfirm={runBulk} oncancel={() => (dialog = null)} />
{/if}

<style>
  .head {
    margin-bottom: 8px;
  }
  .head h1 {
    margin: 0;
  }
  .summary {
    margin: 0 0 12px;
  }
  .filters {
    margin-top: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0 12px;
  }
  .grid label {
    margin-top: 4px;
  }
  .checks {
    margin-top: 12px;
    gap: 16px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--fg);
    font-size: 16px;
  }
  .check input {
    width: 20px;
    height: 20px;
  }
  .notice {
    margin: 12px 0 0;
  }
  .count {
    margin: 12px 0 4px;
  }
  .count p {
    font-size: 14px;
    margin: 0;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .list.selecting {
    padding-bottom: 120px;
  }
  .list a {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
    min-height: 56px;
  }
  .check-box {
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--border);
    display: grid;
    place-items: center;
    font-size: 14px;
    color: var(--accent-fg);
  }
  .check-box.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .thumb {
    width: 52px;
    height: 52px;
    flex: none;
    border-radius: 8px;
    object-fit: cover;
    background: var(--surface);
  }
  .num {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--muted);
    margin-right: 4px;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 13px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .price {
    font-variant-numeric: tabular-nums;
  }
  .empty {
    text-align: center;
    padding: 32px 0;
  }
  .more {
    width: 100%;
    margin-top: 12px;
  }
  .bulkbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(57px + env(safe-area-inset-bottom));
    z-index: 5;
    background: var(--bg);
    border-top: 1px solid var(--border);
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bulkbar .row button {
    flex: 1 1 auto;
  }
  .small {
    font-size: 13px;
  }
</style>
