<script lang="ts">
  let health = $state("checking…");
  fetch("/api/health")
    .then((r) => r.json())
    .then((j) => (health = `server ${j.status}`))
    .catch(() => (health = "server unreachable"));
</script>

<main>
  <h1>Store Manager</h1>
  <p>{health}</p>
</main>
