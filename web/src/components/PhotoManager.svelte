<script lang="ts" module>
  import type { ProcessedPhoto } from "../lib/image";

  /** A photo taken before its item exists (new-item and quick-add flows). */
  export interface PendingPhoto {
    key: string;
    photo: ProcessedPhoto;
    url: string;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { processPhoto } from "../lib/image";
  import { deletePhoto, listPhotos, photoUrl, reorderPhotos, uploadPhoto } from "../lib/photos";
  import { MAX_PHOTOS_PER_ITEM, type Photo } from "../lib/types";

  // With itemId, photos are uploaded and managed on the server immediately.
  // Without it, they are kept in `pending` for the parent to upload after creating the item.
  let {
    itemId,
    pending = $bindable([]),
    max = MAX_PHOTOS_PER_ITEM,
    onchange,
  }: {
    itemId?: number;
    pending?: PendingPhoto[];
    max?: number;
    onchange?: () => void;
  } = $props();

  let photos = $state<Photo[]>([]);
  let busy = $state("");
  let errors = $state<string[]>([]);
  let viewing = $state<{ src: string; index: number } | null>(null);
  let cameraInput = $state<HTMLInputElement>();
  let libraryInput = $state<HTMLInputElement>();

  const count = $derived(itemId ? photos.length : pending.length);
  const room = $derived(max - count);

  onMount(async () => {
    if (itemId) {
      try {
        photos = await listPhotos(itemId);
      } catch (e) {
        errors = [(e as Error).message];
      }
    }
  });

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = ""; // allow picking the same file again
    if (!files.length) return;
    errors = [];
    const take = files.slice(0, Math.max(0, room));
    if (files.length > take.length) errors.push(`Only ${max} photos per item; skipped ${files.length - take.length}.`);

    for (const [i, file] of take.entries()) {
      const n = take.length > 1 ? ` ${i + 1} of ${take.length}` : "";
      try {
        busy = `Preparing photo${n}…`;
        const processed = await processPhoto(file);
        if (itemId) {
          busy = `Uploading photo${n}…`;
          photos = [...photos, await uploadPhoto(itemId, processed)];
        } else {
          const url = URL.createObjectURL(processed.thumb);
          pending = [...pending, { key: crypto.randomUUID(), photo: processed, url }];
        }
        onchange?.();
      } catch (err) {
        errors = [...errors, `${file.name || "Photo"}: ${(err as Error).message}`];
      }
    }
    busy = "";
  }

  async function move(index: number, to: number) {
    if (to < 0 || to >= count) return;
    if (itemId) {
      const ids = photos.map((p) => p.id);
      const [id] = ids.splice(index, 1);
      ids.splice(to, 0, id);
      try {
        photos = await reorderPhotos(itemId, ids);
        onchange?.();
      } catch (e) {
        errors = [(e as Error).message];
      }
    } else {
      const next = [...pending];
      const [p] = next.splice(index, 1);
      next.splice(to, 0, p);
      pending = next;
    }
  }

  async function remove(index: number) {
    if (!confirm("Delete this photo?")) return;
    if (itemId) {
      try {
        await deletePhoto(photos[index].id);
        photos = photos.filter((_, i) => i !== index);
        onchange?.();
      } catch (e) {
        errors = [(e as Error).message];
      }
    } else {
      URL.revokeObjectURL(pending[index].url);
      pending = pending.filter((_, i) => i !== index);
    }
    viewing = null;
  }

  function view(index: number) {
    const src = itemId ? photoUrl(photos[index].id, "full") : URL.createObjectURL(pending[index].photo.full);
    viewing = { src, index };
  }

  function closeViewer() {
    if (viewing && !itemId) URL.revokeObjectURL(viewing.src);
    viewing = null;
  }

  const thumbs = $derived(
    itemId ? photos.map((p) => ({ key: p.id, src: photoUrl(p.id, "thumb") })) : pending.map((p) => ({ key: p.key, src: p.url })),
  );
</script>

<div class="photos">
  {#if thumbs.length}
    <ul class="grid">
      {#each thumbs as t, i (t.key)}
        <li>
          <button class="thumb" onclick={() => view(i)} aria-label={`View photo ${i + 1}`}>
            <img src={t.src} alt="" loading="lazy" />
            {#if i === 0}<span class="cover">Cover</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if room > 0}
    <div class="row add">
      <button type="button" class="primary grow" onclick={() => cameraInput?.click()} disabled={!!busy}>📷 Take photo</button>
      <button type="button" class="grow" onclick={() => libraryInput?.click()} disabled={!!busy}>Choose photos</button>
    </div>
  {:else}
    <p class="muted small">Photo limit reached ({max}).</p>
  {/if}
  <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" onchange={onPick} hidden />
  <input bind:this={libraryInput} type="file" accept="image/*" multiple={max > 1} onchange={onPick} hidden />

  {#if busy}<p class="muted small" aria-live="polite">{busy}</p>{/if}
  {#each errors as err}<p class="error small">{err}</p>{/each}
</div>

{#if viewing}
  <div class="viewer" role="dialog" aria-modal="true" aria-label="Photo">
    <img src={viewing.src} alt="" />
    <div class="viewer-bar row">
      <button onclick={closeViewer}>Close</button>
      <span class="grow"></span>
      {#if viewing.index > 0}
        <button onclick={async () => { const i = viewing!.index; closeViewer(); await move(i, 0); }}>Make cover</button>
        <button onclick={async () => { const i = viewing!.index; closeViewer(); await move(i, i - 1); }} aria-label="Move earlier">◀</button>
      {/if}
      {#if viewing.index < count - 1}
        <button onclick={async () => { const i = viewing!.index; closeViewer(); await move(i, i + 1); }} aria-label="Move later">▶</button>
      {/if}
      <button class="danger" onclick={() => remove(viewing!.index)}>Delete</button>
    </div>
  </div>
{/if}

<style>
  .grid {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
  }
  .thumb {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover {
    position: absolute;
    left: 4px;
    bottom: 4px;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.6);
    color: white;
  }
  .add button {
    min-width: 0;
  }
  .small {
    font-size: 14px;
    margin: 6px 0;
  }
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: black;
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  }
  .viewer img {
    flex: 1;
    min-height: 0;
    width: 100%;
    object-fit: contain;
  }
  .viewer-bar {
    padding: 12px 16px;
    flex-wrap: nowrap;
    overflow-x: auto;
  }
  .viewer-bar button {
    background: rgb(255 255 255 / 0.1);
    color: white;
    border-color: rgb(255 255 255 / 0.3);
    flex: none;
  }
  .viewer-bar button.danger {
    color: #ff8a8a;
    border-color: #ff8a8a;
  }
</style>
