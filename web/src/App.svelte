<script lang="ts">
  import { onMount } from "svelte";
  import { resizeToJpeg } from "./lib/image";
  import * as api from "./lib/spikeApi";

  interface Shown extends api.SpikePhoto {
    url?: string;
  }

  let health = $state("checking…");
  let standalone = $state(false);
  let swState = $state("checking…");
  let launches = $state(0);

  let key = $state(api.getKey());
  let keyInput = $state("");
  let keyError = $state("");
  let keyOk = $state(false);

  let photos = $state<Shown[]>([]);
  let busy = $state("");
  let error = $state("");
  let last = $state<string[]>([]);

  let cameraInput = $state<HTMLInputElement>();
  let libraryInput = $state<HTMLInputElement>();

  onMount(() => {
    fetch(`${import.meta.env.BASE_URL}api/health`)
      .then((r) => r.json())
      .then((j) => (health = `ok (${j.migrations} migration${j.migrations === 1 ? "" : "s"})`))
      .catch(() => (health = "unreachable"));

    standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    checkServiceWorker();
    countLaunch();
    if (key) unlock(key);
  });

  function checkServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      swState = "not supported";
      return;
    }
    const timeout = setTimeout(() => (swState = "not active (yet)"), 5000);
    navigator.serviceWorker.ready.then(() => {
      clearTimeout(timeout);
      swState = navigator.serviceWorker.controller ? "active, controlling page" : "installed (reload to control)";
    });
  }

  // Verifies storage survives the app being backgrounded / relaunched from the Home Screen.
  function countLaunch() {
    try {
      launches = Number(localStorage.getItem("launches") ?? 0) + 1;
      localStorage.setItem("launches", String(launches));
    } catch {
      launches = -1;
    }
  }

  async function unlock(candidate: string) {
    keyError = "";
    try {
      const list = await api.listPhotos(candidate);
      api.setKey(candidate);
      key = candidate;
      keyOk = true;
      showPhotos(list);
    } catch (e) {
      keyOk = false;
      keyError = e instanceof api.ApiError && e.status === 401 ? "Wrong key" : (e as Error).message;
    }
  }

  function forgetKey() {
    api.setKey("");
    key = "";
    keyOk = false;
    clearPhotos();
  }

  function clearPhotos() {
    for (const p of photos) if (p.url) URL.revokeObjectURL(p.url);
    photos = [];
  }

  function showPhotos(list: api.SpikePhoto[]) {
    clearPhotos();
    photos = list.map((p) => ({ ...p }));
    for (const p of photos) loadThumb(p);
  }

  async function loadThumb(p: Shown) {
    try {
      const url = URL.createObjectURL(await api.fetchPhoto(p.id));
      const target = photos.find((x) => x.id === p.id);
      if (target) target.url = url;
      else URL.revokeObjectURL(url);
    } catch {
      // Leave the placeholder; the list still shows the entry.
    }
  }

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow picking the same file again
    if (!file) return;
    error = "";
    const started = performance.now();
    try {
      busy = "Resizing…";
      const r = await resizeToJpeg(file);
      busy = "Uploading…";
      const t0 = performance.now();
      const saved = await api.uploadPhoto(r.blob);
      const uploadMs = performance.now() - t0;
      last = [
        `Original: ${file.type || "unknown type"}, ${kb(file.size)}, ${r.sourceWidth}×${r.sourceHeight}`,
        `Uploaded: JPEG ${r.width}×${r.height}, ${kb(r.blob.size)}`,
        `Upload ${Math.round(uploadMs)} ms, total ${Math.round(performance.now() - started)} ms`,
      ];
      const shown: Shown = { ...saved, url: URL.createObjectURL(r.blob) };
      photos = [shown, ...photos];
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = "";
    }
  }

  async function remove(p: Shown) {
    if (!confirm("Delete this test photo?")) return;
    try {
      await api.deletePhoto(p.id);
      if (p.url) URL.revokeObjectURL(p.url);
      photos = photos.filter((x) => x.id !== p.id);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  function kb(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }
</script>

<main>
  <h1>Store Manager</h1>
  <p class="sub">Device check (milestone M1)</p>

  <section>
    <h2>Status</h2>
    <dl>
      <dt>Server</dt>
      <dd>{health}</dd>
      <dt>Launched from Home Screen</dt>
      <dd>{standalone ? "yes" : "no (browser tab)"}</dd>
      <dt>Service worker</dt>
      <dd>{swState}</dd>
      <dt>Launch count (storage check)</dt>
      <dd>{launches < 0 ? "storage unavailable" : launches}</dd>
    </dl>
  </section>

  {#if !keyOk}
    <section>
      <h2>Upload key</h2>
      <p>Enter the SPIKE_UPLOAD_KEY set on the server.</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          unlock(keyInput.trim());
        }}
      >
        <input type="password" bind:value={keyInput} autocomplete="off" aria-label="Upload key" />
        <button type="submit" disabled={!keyInput.trim()}>Unlock</button>
      </form>
      {#if keyError}<p class="error">{keyError}</p>{/if}
    </section>
  {:else}
    <section>
      <h2>Photo test</h2>
      <div class="actions">
        <button class="primary" onclick={() => cameraInput?.click()} disabled={!!busy}>Take photo</button>
        <button onclick={() => libraryInput?.click()} disabled={!!busy}>Choose from library</button>
      </div>
      <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" onchange={onPick} hidden />
      <input bind:this={libraryInput} type="file" accept="image/*" onchange={onPick} hidden />

      {#if busy}<p>{busy}</p>{/if}
      {#if error}<p class="error">{error}</p>{/if}
      {#if last.length}
        <ul class="details">
          {#each last as line}<li>{line}</li>{/each}
        </ul>
      {/if}

      <div class="grid">
        {#each photos as p (p.id)}
          <figure>
            {#if p.url}<img src={p.url} alt="Uploaded test" />{:else}<div class="placeholder"></div>{/if}
            <figcaption>
              {kb(p.size)}
              <button class="link" onclick={() => remove(p)}>Delete</button>
            </figcaption>
          </figure>
        {/each}
      </div>
      {#if !photos.length && !busy}<p class="muted">No test photos yet.</p>{/if}

      <button class="link" onclick={forgetKey}>Forget key</button>
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 640px;
    margin: 0 auto;
    padding-bottom: 32px;
  }
  h1 {
    margin-bottom: 0;
  }
  .sub,
  .muted {
    color: GrayText;
  }
  section {
    margin-top: 24px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
  }
  dt {
    color: GrayText;
  }
  dd {
    margin: 0;
  }
  form,
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  input[type="password"] {
    flex: 1;
    min-width: 0;
    font-size: 16px; /* prevents iOS zoom-on-focus */
    padding: 10px;
  }
  button {
    font-size: 16px;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 10px;
    border: 1px solid #1f6feb;
    background: transparent;
    color: #1f6feb;
  }
  button.primary {
    background: #1f6feb;
    color: white;
  }
  button:disabled {
    opacity: 0.5;
  }
  button.link {
    border: none;
    min-height: 32px;
    padding: 0;
  }
  .error {
    color: #d1242f;
  }
  .details {
    font-size: 14px;
    padding-left: 18px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
    margin: 16px 0;
  }
  figure {
    margin: 0;
  }
  img,
  .placeholder {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 8px;
    background: #8882;
    display: block;
  }
  figcaption {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
  }
</style>
