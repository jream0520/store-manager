import { session } from "./session.svelte";

const BASE = `${import.meta.env.BASE_URL}api`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
    /** The full error body, for endpoints that return details (e.g. the existing sale on a duplicate). */
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** JSON request to the app's API. A 401 on a protected route signs the UI out. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      // Required by the server on writes (CSRF guard).
      "x-requested-with": "store-manager",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) session.authenticated = false;
    throw new ApiError(res.status, friendly(res.status, data.error ?? res.statusText), data.retryAfter, data);
  }
  return data as T;
}

// Forms validate before sending, so a 400 here is unexpected; show the server's reason.
function friendly(status: number, msg: string): string {
  const text = msg.charAt(0).toUpperCase() + msg.slice(1);
  return status === 400 ? `Couldn't save: ${text}` : text;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) => api<T>("POST", path, body);
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = (path: string) => api<void>("DELETE", path);
