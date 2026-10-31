import { ApiError, del, get } from "./api";
import { session } from "./session.svelte";
import type { ProcessedPhoto } from "./image";
import type { Photo } from "./types";

const BASE = `${import.meta.env.BASE_URL}api`;

export const photoUrl = (id: string, variant: "full" | "thumb") => `${BASE}/photos/${id}/${variant}`;

export const listPhotos = (itemId: number) => get<Photo[]>(`/items/${itemId}/photos`);

export async function uploadPhoto(itemId: number, p: ProcessedPhoto): Promise<Photo> {
  const form = new FormData();
  form.append("photo", p.full, "photo.jpg");
  form.append("thumb", p.thumb, "thumb.jpg");
  const res = await fetch(`${BASE}/items/${itemId}/photos`, {
    method: "POST",
    headers: { "x-requested-with": "store-manager" },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) session.authenticated = false;
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  return data as Photo;
}

export async function reorderPhotos(itemId: number, ids: string[]): Promise<Photo[]> {
  const res = await fetch(`${BASE}/items/${itemId}/photos/order`, {
    method: "PUT",
    headers: { "x-requested-with": "store-manager", "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as Photo[];
}

export const deletePhoto = (id: string) => del(`/photos/${id}`);

/**
 * Uploads photos taken before the item existed, in order, freeing their previews.
 * Returns how many failed; the item is already saved, so failures are reported, not thrown.
 */
export async function uploadPending(
  itemId: number,
  pending: { photo: ProcessedPhoto; url: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let failed = 0;
  for (const [i, p] of pending.entries()) {
    onProgress?.(i, pending.length);
    try {
      await uploadPhoto(itemId, p.photo);
    } catch {
      failed++;
    }
    URL.revokeObjectURL(p.url);
  }
  return failed;
}
