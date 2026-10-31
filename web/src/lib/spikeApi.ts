// Client for the M1 photo spike endpoints. Replaced by the item photo API in M3.

const BASE = `${import.meta.env.BASE_URL}api/spike/photos`;
const KEY_STORAGE = "spike-upload-key";

export interface SpikePhoto {
  id: string;
  size: number;
  createdAt: string;
}

export function getKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage unavailable (private mode); the key lasts for this page only.
  }
}

async function call(path: string, init: RequestInit = {}, key = getKey()): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...init.headers, "x-upload-key": key },
  });
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j) => j.error)
      .catch(() => res.statusText);
    throw new ApiError(res.status, msg);
  }
  return res;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function listPhotos(key?: string): Promise<SpikePhoto[]> {
  return (await call("", {}, key)).json();
}

export async function uploadPhoto(jpeg: Blob): Promise<SpikePhoto> {
  const res = await call("", { method: "POST", body: jpeg, headers: { "content-type": "image/jpeg" } });
  return res.json();
}

export async function fetchPhoto(id: string): Promise<Blob> {
  return (await call(`/${id}`)).blob();
}

export async function deletePhoto(id: string): Promise<void> {
  await call(`/${id}`, { method: "DELETE" });
}
