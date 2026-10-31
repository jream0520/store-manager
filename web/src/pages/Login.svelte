<script lang="ts">
  import { ApiError, post } from "../lib/api";
  import { session } from "../lib/session.svelte";

  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    busy = true;
    try {
      await post("/auth/login", { password });
      password = "";
      session.authenticated = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        error = `Too many attempts. Try again in ${Math.ceil((err.retryAfter ?? 900) / 60)} minutes.`;
      } else if (err instanceof ApiError && err.status === 401) {
        error = "Wrong password.";
      } else {
        error = (err as Error).message;
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width="72" height="72" />
  <h1>Store Manager</h1>

  {#if session.setupRequired}
    <p>No password has been set yet. On the server, run:</p>
    <pre>docker compose exec app node server/dist/cli.js set-password</pre>
    <p class="muted">Then reload this page.</p>
  {:else}
    <form onsubmit={submit}>
      <label for="pw">Password</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="pw" type="password" bind:value={password} autocomplete="current-password" autofocus />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit" disabled={busy || !password}>Sign in</button>
    </form>
  {/if}
</div>

<style>
  .login {
    max-width: 360px;
    margin: 12vh auto 0;
    text-align: center;
  }
  img {
    border-radius: 16px;
  }
  form {
    text-align: left;
  }
  button {
    width: 100%;
    margin-top: 16px;
  }
  pre {
    text-align: left;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface);
    padding: 12px;
    border-radius: var(--radius);
    font-size: 13px;
  }
</style>
