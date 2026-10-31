// Probes the local server; used by Docker HEALTHCHECK and deploy.ps1.
const port = process.env.PORT ?? "3000";

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  console.log(await res.text());
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
