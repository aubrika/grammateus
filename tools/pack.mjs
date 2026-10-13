// Turns a bulletin kept as a folder (bulletin.json plus picture files) into a single
// .bulletin file with the pictures stored inside it, which is what the program opens.
//
//   node tools/pack.mjs samples/2026-10-11/bulletin.json out/2026-10-11.bulletin

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";

const [source, target] = process.argv.slice(2);
const doc = JSON.parse(await readFile(source, "utf8"));
const dir = dirname(source);
doc.images = doc.images || {};
const ids = new Map();
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml" };

async function embed(ref) {
  if (!ref || ref.startsWith("img:")) return ref;
  if (!ids.has(ref)) {
    const id = `p${ids.size + 1}`;
    const bytes = await readFile(join(dir, ref));
    doc.images[id] = `data:${TYPES[extname(ref).toLowerCase()] || "application/octet-stream"};base64,${bytes.toString("base64")}`;
    ids.set(ref, `img:${id}`);
  }
  return ids.get(ref);
}

doc.cover.image = await embed(doc.cover.image);
doc.welcomeLogo = await embed(doc.welcomeLogo);
for (const b of [...(doc.service || []), ...(doc.extras || [])]) {
  if (b.src) b.src = await embed(b.src);
  if (b.noteImage) b.noteImage = await embed(b.noteImage);
  if (b.float) b.float = await embed(b.float);
  if (b.picture) b.picture = await embed(b.picture);
}
for (const item of [...(doc.welcome || []), ...(doc.back || [])]) {
  if (item.logos) item.logos = await Promise.all(item.logos.map(embed));
}
await writeFile(target, JSON.stringify(doc));
console.log(`${target}: ${ids.size} pictures stored inside`);
