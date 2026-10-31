import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

// URL prefix the app is served under, e.g. "/store/" behind a path-based proxy.
// The proxy strips the prefix, so only the client needs to know it.
const base = normalizeBase(process.env.BASE_PATH ?? "/");

export default defineConfig({
  base,
  plugins: [
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Store Manager",
        short_name: "Store",
        display: "standalone",
        start_url: base,
        scope: base,
        background_color: "#ffffff",
        theme_color: "#1f6feb",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: { navigateFallbackDenylist: [new RegExp(`^${base}api/`)] },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:3000" } },
});

function normalizeBase(p: string): string {
  const withLead = p.startsWith("/") ? p : `/${p}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}
