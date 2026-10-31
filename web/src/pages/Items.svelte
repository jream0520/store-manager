<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "../lib/api";
  import { formatMoney } from "../lib/money";
  import { href, navigate, route } from "../lib/router.svelte";
  import { session } from "../lib/session.svelte";
  import { itemNumber, STATUS_LABELS, type Category, type Item, type ItemList, type Status } from "../lib/types";

  const PAGE = 100;

  // Filters live in the URL so Back from an item returns to the same list.
  const q0 = route.query;
  let q = $state(q0.get("q") ?? "");
  let status = $state(q0.get("status") ?? "");
  let categoryId = $state(q0.get("category") ?? "");
  let incomplete = $state(q0.get("incomplete") === "1");
  let archived = $state(q0.get("archived") === "1");
  let sort = $state(q0.get("sort") ?? "newest");

  let items = $state<Item[]>([]);
  let total = $state(0);
  let categories = $state<Category[]>([]);
  let loading = $state(true);
  let error = $state("");
  // Start with the filter panel open if the URL carried any filters.
  let filtersOpen = $state(["status", "category", "incomplete", "archived", "sort"].some((k) => q0.has(k)));

  const activeFilters = $derived([status, categoryId, incomplete, archived, sort !== "newest"].filter(Boolean).length);

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
    if (sort !== "newest") params.set("sort", sort);
    const qs = params.toString();
    clearTimeout(timer);
    timer = setTimeout(() => {
      navigate(`/${qs ? `?${qs}` : ""}`, { replace: true });
      load(false);
    }, q.trim() ? 250 : 0);
  });

  async function load(append: boolean) {
    const id = ++requestId;
    loading = true;
    error = "";
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(append ? items.length : 0), sort });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (incomplete) params.set("incomplete", "true");
    if (archived) params.set("archived", "only");
    try {
      const res = await get<ItemList>(`/items?${params}`);
      if (id !== requestId) return; // a newer search superseded this one
      items = append ? [...items, ...res.items] : res.items;
      total = res.total;
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
    sort = "newest";
  }
</script>

<div class="head row">
  <h1 class="grow">Items</h1>
  <a class="button" href={href("/items/quick")}>Quick add</a>
  <a class="button primary" href={href("/items/new")}>+ New</a>
</div>

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
      <div>
        <label for="f-status">Status</label>
        <select id="f-status" bind:value={status}>
          <option value="">Any</option>
          {#each Object.entries(STATUS_LABELS) as [value, label]}<option {value}>{label}</option>{/each}
        </select>
      </div>
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
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </div>
    </div>
    <div class="row checks">
      <label class="check"><input type="checkbox" bind:checked={incomplete} /> Incomplete only</label>
      <label class="check"><input type="checkbox" bind:checked={archived} /> Archived</label>
      {#if activeFilters}<button class="link" onclick={clearFilters}>Clear</button>{/if}
    </div>
  </div>
{/if}

{#if error}<p class="error">{error}</p>{/if}

<p class="muted count">
  {#if loading && !items.length}Loading…{:else}{total} item{total === 1 ? "" : "s"}{/if}
</p>

<ul class="list">
  {#each items as item (item.id)}
    <li>
      <a href={href(`/items/${item.id}`)}>
        <span class="num">{itemNumber(item.number)}</span>
        <span class="main">
          <span class="name">{item.name}</span>
          <span class="meta">
            {item.categoryName ?? "Uncategorized"}
            {#if item.status !== "in_studio"}· {STATUS_LABELS[item.status as Status]}{/if}
          </span>
        </span>
        <span class="side">
          <span class="price">{formatMoney(item.priceCents, session.settings.currency)}</span>
          {#if item.incomplete}<span class="badge warn">Incomplete</span>{/if}
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
    {:else}
      <p>No items yet.</p>
      <a class="button primary" href={href("/items/new")}>Add your first item</a>
    {/if}
  </div>
{/if}

{#if items.length < total}
  <button class="more" onclick={() => load(true)} disabled={loading}>Load more</button>
{/if}

<style>
  .head {
    margin-bottom: 8px;
  }
  .head h1 {
    margin: 0;
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
  .count {
    font-size: 14px;
    margin: 12px 0 4px;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .list a {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
    min-height: 56px;
  }
  .num {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--muted);
    min-width: 3.2em;
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
</style>
