// Minimal history router that understands the app's BASE_URL (e.g. "/store/").

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const route = $state({ path: currentPath(), query: new URLSearchParams(location.search) });

function currentPath(): string {
  const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  return p || "/";
}

/** Full URL for an app path, for use in href attributes. */
export const href = (path: string) => `${BASE}${path}`;

export function navigate(path: string, { replace = false } = {}) {
  const url = href(path);
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  sync();
  if (!replace) window.scrollTo(0, 0);
}

function sync() {
  route.path = currentPath();
  route.query = new URLSearchParams(location.search);
}

/** Handles back/forward and turns same-app <a> clicks into client-side navigation. */
export function startRouter() {
  window.addEventListener("popstate", sync);
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest("a");
    if (!a || a.target || a.origin !== location.origin || !a.pathname.startsWith(BASE + "/")) return;
    e.preventDefault();
    navigate(a.pathname.slice(BASE.length) + a.search);
  });
}

/** Matches "/items/:id"-style patterns; returns params or null. */
export function match(pattern: string, path = route.path): Record<string, string> | null {
  const p = pattern.split("/");
  const s = path.split("/");
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
