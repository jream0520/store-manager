<script lang="ts">
  import { onMount } from "svelte";
  import { del, get, patch, post } from "../lib/api";
  import { session } from "../lib/session.svelte";
  import type { Category, Settings } from "../lib/types";

  const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD"];

  // Shop
  let shopName = $state(session.settings.shopName);
  let currency = $state(session.settings.currency);
  let shopMsg = $state("");

  // Categories
  let categories = $state<Category[]>([]);
  let newCategory = $state("");
  let catError = $state("");

  // Password
  let current = $state("");
  let next = $state("");
  let repeat = $state("");
  let pwMsg = $state("");
  let pwError = $state("");

  onMount(loadCategories);

  async function loadCategories() {
    categories = await get<Category[]>("/categories");
  }

  async function saveShop(e: SubmitEvent) {
    e.preventDefault();
    shopMsg = "";
    try {
      session.settings = await patch<Settings>("/settings", { shopName, currency });
      shopMsg = "Saved.";
    } catch (err) {
      shopMsg = (err as Error).message;
    }
  }

  async function addCategory(e: SubmitEvent) {
    e.preventDefault();
    catError = "";
    try {
      await post("/categories", { name: newCategory.trim() });
      newCategory = "";
      await loadCategories();
    } catch (err) {
      catError = (err as Error).message;
    }
  }

  async function rename(c: Category) {
    const name = prompt("Rename category", c.name)?.trim();
    if (!name || name === c.name) return;
    catError = "";
    try {
      await patch(`/categories/${c.id}`, { name });
      await loadCategories();
    } catch (err) {
      catError = (err as Error).message;
    }
  }

  async function remove(c: Category) {
    const note = c.itemCount ? ` ${c.itemCount} item${c.itemCount === 1 ? "" : "s"} will become uncategorized.` : "";
    if (!confirm(`Delete category “${c.name}”?${note}`)) return;
    catError = "";
    try {
      await del(`/categories/${c.id}`);
      await loadCategories();
    } catch (err) {
      catError = (err as Error).message;
    }
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    pwMsg = pwError = "";
    if (next.length < 10) return void (pwError = "New password must be at least 10 characters.");
    if (next !== repeat) return void (pwError = "New passwords don't match.");
    try {
      await post("/auth/password", { current, next });
      current = next = repeat = "";
      pwMsg = "Password changed. Other devices were signed out.";
    } catch (err) {
      pwError = (err as Error).message;
    }
  }

  async function signOut() {
    await post("/auth/logout").catch(() => {});
    session.authenticated = false;
  }
</script>

<h1>Settings</h1>

<section>
  <h2>Shop</h2>
  <form onsubmit={saveShop}>
    <label for="shop">Shop name</label>
    <input id="shop" bind:value={shopName} maxlength="100" autocomplete="off" />
    <label for="cur">Currency</label>
    <select id="cur" bind:value={currency}>
      {#each CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES] as c}<option>{c}</option>{/each}
    </select>
    <div class="row actions">
      <button class="primary" type="submit">Save</button>
      {#if shopMsg}<span class="muted">{shopMsg}</span>{/if}
    </div>
  </form>
</section>

<section>
  <h2>Categories</h2>
  <ul>
    {#each categories as c (c.id)}
      <li class="row">
        <span class="grow">{c.name} <span class="muted">({c.itemCount})</span></span>
        <button class="link" onclick={() => rename(c)}>Rename</button>
        <button class="link del" onclick={() => remove(c)}>Delete</button>
      </li>
    {:else}
      <li class="muted">No categories yet.</li>
    {/each}
  </ul>
  <form class="row" onsubmit={addCategory}>
    <input class="grow" bind:value={newCategory} placeholder="New category" maxlength="60" aria-label="New category name" autocomplete="off" />
    <button type="submit" disabled={!newCategory.trim()}>Add</button>
  </form>
  {#if catError}<p class="error">{catError}</p>{/if}
</section>

<section>
  <h2>Password</h2>
  <form onsubmit={changePassword}>
    <input type="text" autocomplete="username" value="owner" hidden readonly />
    <label for="pw-cur">Current password</label>
    <input id="pw-cur" type="password" bind:value={current} autocomplete="current-password" />
    <label for="pw-new">New password (10+ characters)</label>
    <input id="pw-new" type="password" bind:value={next} autocomplete="new-password" />
    <label for="pw-rep">Repeat new password</label>
    <input id="pw-rep" type="password" bind:value={repeat} autocomplete="new-password" />
    {#if pwError}<p class="error">{pwError}</p>{/if}
    {#if pwMsg}<p class="muted">{pwMsg}</p>{/if}
    <div class="actions"><button type="submit" disabled={!current || !next}>Change password</button></div>
  </form>
</section>

<section>
  <button class="danger signout" onclick={signOut}>Sign out</button>
</section>

<style>
  section {
    margin-bottom: 28px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
  }
  li {
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    gap: 16px;
  }
  .del {
    color: var(--danger);
  }
  .actions {
    margin-top: 16px;
  }
  .signout {
    width: 100%;
  }
</style>
