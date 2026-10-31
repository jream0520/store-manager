export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** Scales (w, h) down to fit within max on the long edge; never scales up. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/**
 * Decodes any image the browser can display (including iPhone HEIC on Safari), applies its
 * EXIF orientation, and re-encodes it as a JPEG no larger than `max` px on the long edge.
 */
export async function resizeToJpeg(file: Blob, max = 2000, quality = 0.85): Promise<ResizedImage> {
  const img = await loadImage(file);
  // naturalWidth/Height already reflect EXIF orientation (CSS image-orientation: from-image).
  const sourceWidth = img.naturalWidth;
  const sourceHeight = img.naturalHeight;
  const { width, height } = fitWithin(sourceWidth, sourceHeight, max);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Could not encode JPEG");
  return { blob, width, height, sourceWidth, sourceHeight };
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
