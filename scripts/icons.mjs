// Renders web/public/icon.svg to the PNG sizes iOS and the PWA manifest need.
// Run with `npm run icons` after changing the SVG; the PNGs are committed.
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/public");
const svg = path.join(pub, "icon.svg");

const outputs = [
  // iOS ignores rounded corners/transparency and applies its own mask; use a full-bleed square.
  { file: "apple-touch-icon.png", size: 180, flatten: true },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512, flatten: true },
];

for (const o of outputs) {
  let img = sharp(svg, { density: 384 }).resize(o.size, o.size);
  if (o.flatten) img = img.flatten({ background: "#1f6feb" });
  await img.png().toFile(path.join(pub, o.file));
  console.log(`wrote ${o.file}`);
}
