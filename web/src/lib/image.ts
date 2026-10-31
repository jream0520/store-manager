export const FULL_MAX = 2000;
export const THUMB_MAX = 480;

export interface ProcessedPhoto {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  sourceBytes: number;
}

/** Scales (w, h) down to fit within max on the long edge; never scales up. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/**
 * Decodes any image the browser can display (including iPhone HEIC on Safari), applies its
 * EXIF orientation, and produces the upload pair: a JPEG ≤ 2000 px and a ≤ 480 px thumbnail.
 * The server stores these as-is, so all image work happens here on the phone.
 */
export async function processPhoto(file: Blob): Promise<ProcessedPhoto> {
  const img = await loadImage(file);
  // naturalWidth/Height already reflect EXIF orientation (CSS image-orientation: from-image).
  const size = fitWithin(img.naturalWidth, img.naturalHeight, FULL_MAX);
  const full = await encode(img, size.width, size.height, 0.85);
  const t = fitWithin(img.naturalWidth, img.naturalHeight, THUMB_MAX);
  const thumb = await encode(img, t.width, t.height, 0.8);
  return { full, thumb, width: size.width, height: size.height, sourceBytes: file.size };
}

async function encode(img: HTMLImageElement, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  // Free the canvas backing store promptly; iOS caps total canvas memory.
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Could not encode JPEG");
  return blob;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("This browser can't read that image format");
  } finally {
    URL.revokeObjectURL(url);
  }
}
