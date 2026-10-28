// Pictures that are already inside a PDF, read back out of it.
//
// A PDF made by this program carries the editable bulletin as an attachment. Its pictures
// are drawn on the pages already, so the attachment points at those instead of holding a
// second copy: "pdf-image:52" is the picture kept as object 52 of the PDF. A picture is
// only replaced by a pointer when the PDF holds it exactly (the same JPEG, or the same
// pixels), so reading it back gives the picture that was put in.
//
// Runs in the editing screen and in Node alike: it needs nothing but the standard
// compression streams.

export const POINTER = "pdf-image:";

// ---------------------------------------------------------------- compression

async function through(data, stream) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
}
const inflate = (data) => through(data, new DecompressionStream("deflate"));
const deflate = (data) => through(data, new CompressionStream("deflate"));

function fromBase64(s) {
  const text = atob(s), out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------- reading objects in a PDF

// Just enough of the PDF syntax to read the dictionary of one object.
function parse(text, i) {
  const space = () => {
    for (;;) {
      while (i < text.length && /[\s\0]/.test(text[i])) i++;
      if (text[i] !== "%") return;
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
    }
  };
  const value = () => {
    space();
    if (text.startsWith("<<", i)) {
      i += 2;
      const dict = {};
      for (space(); !text.startsWith(">>", i); space()) {
        const key = value();
        dict[key] = value();
      }
      i += 2;
      return dict;
    }
    if (text[i] === "[") {
      i++;
      const list = [];
      for (space(); text[i] !== "]"; space()) list.push(value());
      i++;
      return list;
    }
    if (text[i] === "/") {
      const m = /^\/[^\s/<>[\]()%{}]*/.exec(text.slice(i, i + 128));
      i += m[0].length;
      return m[0];
    }
    if (text[i] === "(") {
      let depth = 0, start = i;
      for (; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) break;
      }
      return text.slice(start, ++i);
    }
    if (text[i] === "<") { const end = text.indexOf(">", i); const s = text.slice(i, end + 1); i = end + 1; return s; }
    // a number, or a reference to another object ("12 0 R")
    const m = /^([-+]?[\d.]+)(?:\s+(\d+)\s+R(?![A-Za-z]))?|^(true|false|null)/.exec(text.slice(i, i + 40));
    if (!m) throw new Error(`unreadable PDF at ${i}`);
    i += m[0].length;
    if (m[3]) return m[3] === "true" ? true : m[3] === "false" ? false : null;
    return m[2] !== undefined ? { ref: Number(m[1]) } : Number(m[1]);
  };
  return [value(), i];
}

// Objects are found by their "N 0 obj" heading; when an object was saved more than once
// (a PDF edited and saved again), the last one is the one in force.
export function pdfReader(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  const cache = new Map();
  const object = (n) => {
    if (cache.has(n)) return cache.get(n);
    const head = new RegExp(`(?:^|[\\s>])${n}\\s+0\\s+obj\\b`, "g");
    let found = null;
    for (let m; (m = head.exec(text)); ) found = m;
    if (!found) return null;
    const [dict, end] = parse(text, found.index + found[0].length);
    const out = { dict, end };
    cache.set(n, out);
    return out;
  };
  const resolve = (v) => (v && typeof v === "object" && "ref" in v ? object(v.ref)?.dict : v);
  // the raw bytes of a stream object
  const stream = (n) => {
    const obj = object(n);
    if (!obj) return null;
    const m = /^\s*stream(\r\n|\n|\r)/.exec(text.slice(obj.end, obj.end + 20));
    if (!m) return null;
    const start = obj.end + m[0].length, length = resolve(obj.dict["/Length"]);
    return typeof length === "number" ? bytes.subarray(start, start + length) : null;
  };
  return { text, object, resolve, stream };
}

// ---------------------------------------------------------------- pictures in a PDF

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// Pixels are passed around as { width, height, channels, pixels, alpha }: `channels` colour
// values per pixel (1 grey, 2 grey and opacity, 3 red-green-blue, 4 with opacity), and for a
// picture from a PDF its opacity as a separate grey picture, `alpha`, when it has one.

// The opacity of pixel p, 0 to 255.
const opacityAt = (img, p) => (img.alpha ? img.alpha[p] : img.channels === 2 ? img.pixels[p * 2 + 1] : img.channels === 4 ? img.pixels[p * 4 + 3] : 255);

// Whether two pictures have the same pixels, however each holds them.
export function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  const ca = a.channels, cb = b.channels, colourA = ca >= 3 ? 3 : 1, colourB = cb >= 3 ? 3 : 1;
  const n = a.width * a.height, pa = a.pixels, pb = b.pixels;
  if (ca === cb && !a.alpha && !b.alpha) return equal(pa.subarray(0, n * ca), pb.subarray(0, n * cb));
  if (ca === 4 && cb === 3 && !b.alpha) {             // the usual case: a PNG from a canvas, a picture Chromium wrote
    for (let p = 0, i = 0, j = 0; p < n; p++, i += 4, j += 3) {
      if (pa[i] !== pb[j] || pa[i + 1] !== pb[j + 1] || pa[i + 2] !== pb[j + 2] || pa[i + 3] !== 255) return false;
    }
    return true;
  }
  if (ca === 3 && cb === 4) return samePixels(b, a);
  for (let p = 0; p < n; p++) {
    for (let k = 0; k < 3; k++) if (pa[p * ca + (colourA === 3 ? k : 0)] !== pb[p * cb + (colourB === 3 ? k : 0)]) return false;
    if (opacityAt(a, p) !== opacityAt(b, p)) return false;
  }
  return true;
}

// Four bytes to a pixel: red, green, blue, opacity.
function toRgba(img) {
  const n = img.width * img.height, c = img.channels, grey = c < 3, rgba = new Uint8Array(n * 4);
  for (let p = 0; p < n; p++) {
    const s = p * c;
    rgba[p * 4] = img.pixels[s];
    rgba[p * 4 + 1] = img.pixels[s + (grey ? 0 : 1)];
    rgba[p * 4 + 2] = img.pixels[s + (grey ? 0 : 2)];
    rgba[p * 4 + 3] = opacityAt(img, p);
  }
  return { width: img.width, height: img.height, rgba };
}

// The picture kept as object n: { jpeg } for a JPEG kept as it is, its pixels for anything
// else this can read, or null.
export async function pdfImage(reader, n, { alpha = true } = {}) {
  const obj = reader.object(n);
  const d = obj?.dict;
  // a /Decode of [0 1 ...] leaves the values as they are; any other would change them
  const decode = reader.resolve(d?.["/Decode"]);
  const plain = !decode || (Array.isArray(decode) && decode.every((v, i) => v === i % 2));
  if (!d || d["/Subtype"] !== "/Image" || !plain || d["/ImageMask"] === true) return null;
  const filters = list(d["/Filter"]), raw = reader.stream(n);
  if (!raw) return null;
  const mask = d["/SMask"] ? d["/SMask"] : null;
  if (filters.length === 1 && filters[0] === "/DCTDecode" && !mask) return { jpeg: raw };
  if (filters.length !== 1 || filters[0] !== "/FlateDecode" || reader.resolve(d["/BitsPerComponent"]) !== 8) return null;
  const params = reader.resolve(list(d["/DecodeParms"])[0]) || {};
  if ((params["/Predictor"] || 1) > 1) return null;              // Chromium writes plain rows
  let space = reader.resolve(d["/ColorSpace"]);
  if (Array.isArray(space) && space[0] === "/ICCBased") space = reader.resolve(space[1])?.["/N"] === 1 ? "/DeviceGray" : reader.resolve(space[1])?.["/N"] === 3 ? "/DeviceRGB" : null;
  const channels = space === "/DeviceRGB" ? 3 : space === "/DeviceGray" ? 1 : 0;
  if (!channels) return null;
  const width = reader.resolve(d["/Width"]), height = reader.resolve(d["/Height"]);
  const pixels = await inflate(raw);
  if (pixels.length < width * height * channels) return null;
  let opacity = null;
  if (mask && alpha) {
    const m = await pdfImage(reader, mask.ref, { alpha: false });
    if (!m?.pixels || m.channels !== 1 || m.width !== width || m.height !== height) return null;
    opacity = m.pixels;
  }
  return { width, height, channels, pixels, alpha: opacity };
}

// Every picture in the PDF: its object number, size and stream.
export function pdfImageObjects(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:^|[\s>])(\d+)\s+0\s+obj\b/g)) {
    // only this object's own dictionary: up to where its stream or the object ends
    const head = text.slice(m.index + m[0].length, m.index + m[0].length + 600).split(/\bstream\b|\bendobj\b/)[0];
    if (/\/Subtype\s*\/Image\b/.test(head)) out.add(Number(m[1]));
  }
  return [...out];
}

// ---------------------------------------------------------------- PNG

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
}
const CRC = crcTable();
const crc = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

// PNG filters, one loop each for speed. `sign` 1 undoes a filter (reading), -1 applies it
// (writing): out[x] = cur[x] + sign * prediction, where the prediction is made from the
// finished row (`row`, whose bytes to the left are already known) and the one above (`up`).
function filterRow(f, sign, cur, row, up, out, bpp) {
  const n = cur.length;
  up ||= new Uint8Array(n);                         // the first row has a row of zeros above it
  let x = 0;
  switch (f) {
    case 0: out.set(cur); return;
    case 1: for (; x < bpp; x++) out[x] = cur[x]; for (; x < n; x++) out[x] = (cur[x] + sign * row[x - bpp]) & 0xff; return;
    case 2: for (; x < n; x++) out[x] = (cur[x] + sign * up[x]) & 0xff; return;
    case 3: for (; x < bpp; x++) out[x] = (cur[x] + sign * (up[x] >> 1)) & 0xff;
            for (; x < n; x++) out[x] = (cur[x] + sign * ((row[x - bpp] + up[x]) >> 1)) & 0xff; return;
    default: for (; x < bpp; x++) out[x] = (cur[x] + sign * up[x]) & 0xff;
             for (; x < n; x++) out[x] = (cur[x] + sign * paeth(row[x - bpp], up[x], up[x - bpp])) & 0xff;
  }
}

// The pixels of a PNG, or null for a kind this does not read
// (palettes, 16 bits, interlacing): such a picture simply stays in the attachment.
export async function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47) return null;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const data = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at), name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") { width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (name === "IDAT") data.push(body);
    else if (name === "IEND") break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) return null;
  const all = new Uint8Array(data.reduce((s, d) => s + d.length, 0));
  data.reduce((at, d) => (all.set(d, at), at + d.length), 0);
  const raw = await inflate(all);
  const stride = width * channels, px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    filterRow(filter, 1, src, row, up, row, channels);
  }
  return { width, height, channels, pixels: px };
}

// Pixels as a PNG: without an opacity channel when every pixel is solid. Each row is
// filtered the way that leaves it smallest, as PNG makers usually do.
export async function encodePng({ width, height, rgba }) {
  let solid = true;
  for (let p = 3; p < rgba.length; p += 4) if (rgba[p] !== 255) { solid = false; break; }
  const channels = solid ? 3 : 4, stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let p = 0; p < width * height; p++) for (let k = 0; k < channels; k++) px[p * channels + k] = rgba[p * 4 + k];
  const out = new Uint8Array((stride + 1) * height);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = Infinity;
    for (let f = 0; f < 5; f++) {
      filterRow(f, -1, row, row, up, trial, channels);
      let sum = 0;
      for (let x = 0; x < stride; x++) sum += trial[x] < 128 ? trial[x] : 256 - trial[x];
      if (sum < best) { best = sum; out[y * (stride + 1)] = f; out.set(trial, y * (stride + 1) + 1); }
    }
  }
  const chunk = (name, body) => {
    const c = new Uint8Array(12 + body.length), v = new DataView(c.buffer);
    v.setUint32(0, body.length);
    c.set([...name].map((ch) => ch.charCodeAt(0)), 4);
    c.set(body, 8);
    v.setUint32(8 + body.length, crc(c.subarray(4, 8 + body.length)));
    return c;
  };
  const head = new Uint8Array(13), hv = new DataView(head.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); head.set([8, solid ? 2 : 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", await deflate(out)), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  parts.reduce((at, p) => (png.set(p, at), at + p.length), 0);
  return png;
}

// ---------------------------------------------------------------- the two directions

// Replace each picture of a bulletin that the PDF holds exactly by a pointer to it.
// `images` maps ids to data URLs; returns a new map.
export async function pointAtPictures(pdfBytes, images) {
  const reader = pdfReader(pdfBytes);
  const candidates = pdfImageObjects(reader.text).map((n) => ({ n, d: reader.object(n)?.dict }))
    .filter(({ d }) => d?.["/Subtype"] === "/Image")
    .map(({ n, d }) => ({ n, width: reader.resolve(d["/Width"]), height: reader.resolve(d["/Height"]), jpeg: list(d["/Filter"]).join() === "/DCTDecode" }));
  const decoded = new Map();                          // each image in the PDF is unpacked once at most
  const pixels = async (n) => { if (!decoded.has(n)) decoded.set(n, await pdfImage(reader, n)); return decoded.get(n); };
  // two pictures that are the same are one picture in the PDF, so may point at the same one
  const out = {};
  for (const [id, url] of Object.entries(images)) {
    out[id] = url;
    const m = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(url || "");
    if (!m) continue;
    const bytes = fromBase64(m[2]);
    let found = null;
    if (m[1] === "jpeg") {
      for (const c of candidates) if (c.jpeg && equal((await pixels(c.n))?.jpeg || [], bytes)) { found = c.n; break; }
    } else {
      const png = await decodePng(bytes);
      for (const c of png ? candidates : []) {
        if (c.jpeg || c.width !== png.width || c.height !== png.height) continue;
        const got = await pixels(c.n);
        if (got?.pixels && samePixels(got, png)) { found = c.n; break; }
      }
    }
    if (found !== null) out[id] = `${POINTER}${found}`;
  }
  return out;
}

// In a browser, a picture without see-through parts is made into a PNG by the browser
// itself, which is quicker; the pixels are the same either way. (With see-through parts a
// canvas could change the colours of the pixels that are partly see-through.)
function solidPngUrl({ width, height, rgba }) {
  if (typeof document === "undefined") return null;
  for (let p = 3; p < rgba.length; p += 4) if (rgba[p] !== 255) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

// Turn the pointers in a bulletin's pictures back into pictures. A pointer that cannot be
// followed is an error: the bulletin would not be the one that was saved.
export async function followPointers(pdfBytes, images) {
  if (!Object.values(images || {}).some((v) => String(v).startsWith(POINTER))) return images;
  const reader = pdfReader(pdfBytes);
  const out = {};
  for (const [id, url] of Object.entries(images)) {
    if (!String(url).startsWith(POINTER)) { out[id] = url; continue; }
    const got = await pdfImage(reader, Number(url.slice(POINTER.length)));
    if (!got) throw new Error(`picture ${id} is missing from the PDF`);
    const rgba = got.jpeg ? null : toRgba(got);
    out[id] = got.jpeg ? `data:image/jpeg;base64,${toBase64(got.jpeg)}` : solidPngUrl(rgba) || `data:image/png;base64,${toBase64(await encodePng(rgba))}`;
  }
  return out;
}
