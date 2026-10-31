/**
 * Reads the pixel size from a JPEG's SOFn header, or returns undefined if the buffer
 * isn't a well-formed JPEG. Used to validate uploads without a native image library
 * (the production CPU can't run the usual prebuilt ones reliably).
 */
export function jpegSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined; // EOI / start of scan before any SOF
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return undefined;
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > buf.length) return undefined;
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return width && height ? { width, height } : undefined;
    }
    i += 2 + len;
  }
  return undefined;
}
