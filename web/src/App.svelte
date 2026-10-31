<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "./lib/api";
  import { href, match, route, startRouter } from "./lib/router.svelte";
  import { session } from "./lib/session.svelte";
  import type { Settings } from "./lib/types";
  import Analysis from "./pages/Analysis.svelte";
  import Expenses from "./pages/Expenses.svelte";
  import ItemEditor from "./pages/ItemEditor.svelte";
  import Items from "./pages/Items.svelte";
  import Login from "./pages/Login.svelte";
  import QuickAdd from "./pages/QuickAdd.svelte";
  import Reconcile from "./pages/Reconcile.svelte";
  import Sales from "./pages/Sales.svelte";
  import SettingsPage from "./pages/Settings.svelte";

  let loadError = $state("");

  onMount(() => {
    startRouter();
    checkAuth();
  });

  async function checkAuth() {
    try {
      const state = await get<{ authenticated: boolean; setupRequired: boolean }>("/auth/state");
      session.authenticated = state.authenticated;
      session.setupRequired = state.setupRequired;
    } catch (e) {
      loadError = `Can't reach the server: ${(e as Error).message}`;
    } finally {
      session.checked = true;
    }
  }

  // Load settings whenever we become signed in (initial load or after login).
  $effect(() => {
    if (session.authenticated) get<Settings>("/settings").then((s) => (session.settings = s));
  });

  const itemParams = $derived(match("/items/:id"));
  const reportParams = $derived(match("/reports/:id"));
  const tab = $derived(
    route.path === "/settings" ? "settings" : route.path === "/items/new" ? "new" : route.path === "/shop" ? "shop" : ["/sales", "/expenses", "/analysis"].includes(route.path) || route.path.startsWith("/reports/") ? "sales" : "items",
  );
</script>

{#if !session.checked}
  <p class="center muted">Loading…</p>
{:else if loadError}
  <div class="center">
    <p class="error">{loadError}</p>
    <button onclick={() => location.reload()}>Retry</button>
  </div>
{:else if !session.authenticated}
  <main><Login /></main>
{:else}
  <main>
    {#key route.path}
      {#if route.path === "/"}
        <Items />
      {:else if route.path === "/shop"}
        <Items view="shop" />
      {:else if route.path === "/items/new"}
        <ItemEditor />
      {:else if route.path === "/items/quick"}
        <QuickAdd />
      {:else if itemParams && /^\d+$/.test(itemParams.id)}
        <ItemEditor id={Number(itemParams.id)} />
      {:else if route.path === "/sales"}
        <Sales />
      {:else if route.path === "/expenses"}
        <Expenses />
      {:else if route.path === "/analysis"}
        <Analysis />
      {:else if reportParams && /^\d+$/.test(reportParams.id)}
        <Reconcile id={Number(reportParams.id)} />
      {:else if route.path === "/settings"}
        <SettingsPage />
      {:else}
        <h1>Not found</h1>
        <p><a href={href("/")}>Go to items</a></p>
      {/if}
    {/key}
  </main>

  <nav aria-label="Main">
    <a href={href("/")} aria-current={tab === "items" ? "page" : undefined}>
      <span class="icon" aria-hidden="true">☰</span>Items
    </a>
    <a href={href("/shop")} aria-current={tab === "shop" ? "page" : undefined}>
      <span class="icon" aria-hidden="true">⌂</span>In shop
    </a>
    <a href={href("/sales")} aria-current={tab === "sales" ? "page" : undefined}>
      <span class="icon" aria-hidden="true">＄</span>Sales
    </a>
    <a href={href("/items/new")} aria-current={tab === "new" ? "page" : undefined}>
      <span class="icon" aria-hidden="true">＋</span>Add
    </a>
    <a href={href("/settings")} aria-current={tab === "settings" ? "page" : undefined}>
      <span class="icon" aria-hidden="true">⚙</span>Settings
    </a>
  </nav>
{/if}

<style>
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 8px) 16px calc(88px + env(safe-area-inset-bottom));
  }
  .center {
    text-align: center;
    margin-top: 30vh;
    padding: 0 16px;
  }
  nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  nav a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 0;
    min-height: 56px;
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
  }
  nav a[aria-current="page"] {
    color: var(--accent);
  }
  .icon {
    font-size: 20px;
    line-height: 1;
  }
</style>
