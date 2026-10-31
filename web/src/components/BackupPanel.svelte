<script lang="ts">
  import { onMount } from "svelte";
  import { get, post } from "../lib/api";

  // F29: shows backup health and lets the owner take a copy off the server.
  interface Backup {
    name: string;
    createdAt: string;
    counts: { items: number; sales: number; photos: number; expenses: number };
    dbBytes: number;
    photoBytes: number;
  }
  interface BackupState {
    backups: Backup[];
    intervalHours: number;
    keep: number;
    lastError: string | null;
  }

  let info = $state<BackupState | null>(null);
  let busy = $state(false);
  let error = $state("");

  const latest = $derived(info?.backups[0]);
  const ageHours = $derived(latest ? (Date.now() - new Date(latest.createdAt).getTime()) / 3600_000 : Infinity);
  const stale = $derived(!!info && info.intervalHours > 0 && ageHours > info.intervalHours * 2);

  onMount(load);

  async function load() {
    try {
      info = await get<BackupState>("/backups");
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function backupNow() {
    busy = true;
    error = "";
    try {
      await post("/backups");
      await load();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const size = (b: Backup) => `${((b.dbBytes + b.photoBytes) / 1024 / 1024).toFixed(1)} MB`;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const downloadUrl = (name: string) => `${import.meta.env.BASE_URL}api/backups/${name}/download`;
</script>

{#if info}
  {#if latest}
    <p class:warn={stale}>
      Last backup: <strong>{when(latest.createdAt)}</strong>
      ({plural(latest.counts.items, "item")}, {plural(latest.counts.sales, "sale")}, {size(latest)}).
      {#if stale}Automatic backups may not be running.{/if}
    </p>
  {:else}
    <p class="warn">No backups yet.</p>
  {/if}
  <p class="muted small">
    {#if info.intervalHours > 0}
      Automatic every {info.intervalHours} hours on the server; the last {info.keep} are kept.
    {:else}
      Automatic backups are off on the server.
    {/if}
    Download one now and then and keep it somewhere else, in case the server's disk fails.
  </p>
  {#if info.lastError}<p class="error small">Last automatic backup failed: {info.lastError}</p>{/if}

  <div class="row">
    <button onclick={backupNow} disabled={busy}>{busy ? "Backing up…" : "Back up now"}</button>
    {#if latest}<a class="button primary" href={downloadUrl(latest.name)} download>Download latest</a>{/if}
  </div>

  {#if info.backups.length > 1}
    <details>
      <summary>Older backups ({info.backups.length - 1})</summary>
      <ul>
        {#each info.backups.slice(1) as b (b.name)}
          <li><a href={downloadUrl(b.name)} download>{when(b.createdAt)}</a> <span class="muted">· {size(b)}</span></li>
        {/each}
      </ul>
    </details>
  {/if}
{/if}
{#if error}<p class="error">{error}</p>{/if}

<style>
  .warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 8px;
    padding: 6px 10px;
  }
  .small {
    font-size: 13px;
  }
  details {
    margin-top: 12px;
    font-size: 14px;
  }
  summary {
    color: var(--accent);
    cursor: pointer;
  }
  ul {
    padding-left: 18px;
  }
  li {
    margin: 6px 0;
  }
</style>
