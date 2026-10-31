<script lang="ts">
  import { ACTIONS, todayLocal, WRITE_OFF_REASONS, type Action, type ActionDetails, type WriteOffReason } from "../lib/status";

  let {
    action,
    count,
    onconfirm,
    oncancel,
  }: {
    action: Action;
    count: number;
    onconfirm: (d: ActionDetails) => Promise<void>;
    oncancel: () => void;
  } = $props();

  let date = $state(todayLocal());
  let location = $state("");
  let reason = $state<WriteOffReason | "">("");
  let note = $state("");
  let busy = $state(false);
  let error = $state("");

  const what = $derived(count === 1 ? "this item" : `${count} items`);
  const valid = $derived(!!date && date <= todayLocal() && (action !== "write_off" || !!reason));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    busy = true;
    error = "";
    try {
      await onconfirm({ date, location, reason: reason || undefined, note });
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && oncancel()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sd-title">
  <form onsubmit={submit}>
    <h2 id="sd-title">{ACTIONS[action].label}: {what}</h2>

    <label for="sd-date">Date</label>
    <input id="sd-date" type="date" bind:value={date} max={todayLocal()} required />

    {#if action === "place"}
      <label for="sd-loc">Where in the shop <span class="muted">(optional)</span></label>
      <input id="sd-loc" bind:value={location} maxlength="100" placeholder="e.g. Front table" autocomplete="off" />
    {:else if action === "write_off"}
      <label for="sd-reason">Reason</label>
      <select id="sd-reason" bind:value={reason} required>
        <option value="" disabled>Choose…</option>
        {#each Object.entries(WRITE_OFF_REASONS) as [value, label]}<option {value}>{label}</option>{/each}
      </select>
      <label for="sd-note">Note <span class="muted">(optional)</span></label>
      <input id="sd-note" bind:value={note} maxlength="500" autocomplete="off" />
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="row actions">
      <button type="button" class="grow" onclick={oncancel} disabled={busy}>Cancel</button>
      <button type="submit" class="grow {action === 'write_off' ? 'danger' : 'primary'}" disabled={busy || !valid}>
        {busy ? "Saving…" : ACTIONS[action].label}
      </button>
    </div>
  </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgb(0 0 0 / 0.45);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .sheet {
    width: 100%;
    max-width: 520px;
    background: var(--bg);
    border-radius: 16px 16px 0 0;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  }
  h2 {
    margin-top: 0;
  }
  .actions {
    margin-top: 20px;
    flex-wrap: nowrap;
  }
  .muted {
    font-size: 12px;
  }
</style>
