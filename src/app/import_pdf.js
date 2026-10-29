// Rebuilds an editable bulletin from a finished bulletin PDF.
//
// The PDF has the true layout, so the text can be read in order with its formatting, each
// side note can be tied to the part of the service printed beside it, and each picture is
// found where it was placed. It expects the layout this program produces: letter pages
// with a side column of notes on the spine side of each service page.
//
// Measurements are in points (72 to the inch), with y running down the page.

import * as pdfjs from "../../node_modules/pdfjs-dist/build/pdf.min.mjs";
import { LEADING, PAPERS, joinRuns, normalize } from "./doc.js";
import { followPointers } from "../pdf_pictures.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;

const IN = 72;
const escapeHtml = (t) => t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

// ---------------------------------------------------------------- reading a page

const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
                            m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

function getObject(page, id) {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => { try { store.get(id, resolve); } catch { resolve(null); } });
}

function toCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext("2d");
  if (image.bitmap) { g.drawImage(image.bitmap, 0, 0); return canvas; }
  const out = g.createImageData(image.width, image.height);
  const src = image.data, n = image.width * image.height;
  // one whole pixel (red, green, blue, opacity) written at a time; the bytes of a 32-bit
  // number are stored lowest first on every computer this runs on
  const pixels = new Uint32Array(out.data.buffer);
  if (image.kind === 1) {                       // one bit per pixel, rows padded to whole bytes
    const stride = (image.width + 7) >> 3;
    for (let y = 0, i = 0; y < image.height; y++) for (let x = 0; x < image.width; x++, i++)
      pixels[i] = (src[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0xffffffff : 0xff000000;
  } else if (image.kind === 2) {                // three bytes per pixel
    for (let i = 0, j = 0; i < n; i++, j += 3) pixels[i] = 0xff000000 | (src[j + 2] << 16) | (src[j + 1] << 8) | src[j];
  } else {
    out.data.set(src.subarray(0, n * 4));
  }
  g.putImageData(out, 0, 0);
  return canvas;
}

async function readPage(pdf, number) {
  const page = await pdf.getPage(number);
  const view = page.getViewport({ scale: 1 });
  const height = view.height;
  const ops = await page.getOperatorList();        // also loads the fonts, so their names are known
  const content = await page.getTextContent();
  const fontStyle = new Map();
  const styleOf = (name) => {
    if (!fontStyle.has(name)) {
      let real = "";
      try { real = page.commonObjs.has(name) ? page.commonObjs.get(name).name || "" : ""; } catch { real = ""; }
      fontStyle.set(name, { bold: /bold|black|heavy/i.test(real), italic: /italic|oblique/i.test(real), symbol: /symbol|dingbat|wingding/i.test(real),
                            font: real });
    }
    return fontStyle.get(name);
  };

  const texts = [];
  for (const item of content.items) {
    if (!item.str) continue;
    const [a, b, , , e, f] = item.transform;
    const size = Math.hypot(a, b);
    texts.push({ text: item.str + (item.hasEOL ? " " : ""), left: e, right: e + item.width, base: height - f, top: height - f - size * 0.82,
                 size, ...styleOf(item.fontName) });
  }

  // pictures, with where they were drawn, and the lines and shaded boxes drawn on the page
  const images = [];
  const shapes = [];
  const stack = [];
  // the drawing state: position and scale, colour, line width, and the area drawing is clipped to
  let state = { ctm: [1, 0, 0, 1, 0, 0], fill: "#000000", lineWidth: 1, clip: null };
  let clipping = false;
  // a box in the current drawing space, as a box on the page measured from the top
  const onPage = ([x0, y0, x1, y1], m = state.ctm) => {
    const xs = [], ys = [];
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) { xs.push(m[0] * x + m[2] * y + m[4]); ys.push(m[1] * x + m[3] * y + m[5]); }
    return { left: Math.min(...xs), right: Math.max(...xs), top: height - Math.max(...ys), bottom: height - Math.min(...ys) };
  };
  const within = (a, b) => (b ? { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) } : a);
  const { OPS } = pdfjs;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push({ ...state });
    else if (fn === OPS.restore) state = stack.pop() || state;
    else if (fn === OPS.transform) state.ctm = multiply(state.ctm, args);
    else if (fn === OPS.setFillRGBColor) state.fill = args[0];
    else if (fn === OPS.setLineWidth) state.lineWidth = args[0];
    else if (fn === OPS.paintFormXObjectBegin) { stack.push({ ...state }); if (args[0]) state.ctm = multiply(state.ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) state = stack.pop() || state;
    else if (fn === OPS.clip || fn === OPS.eoClip) clipping = true;          // applies to the path that follows
    else if (fn === OPS.constructPath && args[2]) {
      const box = onPage(args[2]);
      if (clipping) { state.clip = within(box, state.clip); clipping = false; }
      if (args[0] === OPS.fill || args[0] === OPS.eoFill || args[0] === OPS.stroke) {
        // only the box around the path is needed: enough to tell a line or a shaded box
        const stroke = args[0] === OPS.stroke;
        shapes.push({ stroke, fill: stroke ? null : state.fill, width: stroke ? state.lineWidth * Math.abs(state.ctm[0] || 1) : 0, ...box });
      }
    }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const image = fn === OPS.paintImageXObject ? await getObject(page, args[0]) : args[0];
      if (!image || !image.width) continue;
      // a picture is often drawn larger than the part of it that shows (Word crops this way);
      // keep only what shows
      const whole = onPage([0, 0, 1, 1]), seen = within(whole, state.clip);
      if (seen.right - seen.left < 1 || seen.bottom - seen.top < 1) continue;
      let canvas = toCanvas(image);
      const cut = { x: (seen.left - whole.left) / (whole.right - whole.left), y: (seen.top - whole.top) / (whole.bottom - whole.top),
                    w: (seen.right - seen.left) / (whole.right - whole.left), h: (seen.bottom - seen.top) / (whole.bottom - whole.top) };
      if (cut.w < 0.995 || cut.h < 0.995) {
        const part = document.createElement("canvas");
        part.width = Math.max(1, Math.round(cut.w * canvas.width));
        part.height = Math.max(1, Math.round(cut.h * canvas.height));
        part.getContext("2d").drawImage(canvas, Math.round(cut.x * canvas.width), Math.round(cut.y * canvas.height), part.width, part.height, 0, 0, part.width, part.height);
        canvas = part;
      }
      images.push({ left: seen.left, top: seen.top, width: seen.right - seen.left, height: seen.bottom - seen.top, canvas });
    }
  }
  return { number, width: view.width, height, texts, images, shapes };
}

// Lines drawn across a page: a stroke, or a thin filled bar, wide enough to divide the page.
function drawnRules(page) {
  return page.shapes.filter((s) => s.bottom - s.top < 3.5 && s.right - s.left > page.width * 0.3)
    .sort((a, b) => a.top - b.top)
    .filter((s, i, all) => !i || s.top - all[i - 1].top > 3);       // a line drawn twice is one line
}

// Boxes filled with grey (not white, not black) that are big enough to hold text.
const isGrey = (colour) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour || "");
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 16 && r > 120 && r < 245;
};
const greyBoxes = (page) => page.shapes.filter((s) => !s.stroke && isGrey(s.fill) && s.right - s.left > 0.6 * IN && s.bottom - s.top > 0.4 * IN);

// The font a PDF names, as the family it belongs to: "ABCDEF+Garamond-Bold" and
// "Garamond-8216" are both Garamond, "TimesNewRomanPS-BoldMT" is Times New Roman.
export function fontFamily(name) {
  return String(name || "").replace(/^[A-Z]{6}\+/, "").replace(/[-,_]\d+$/, "")
    .replace(/[-,](Bold|Italic|Oblique|Regular|Roman|Book|Medium|Semibold|SemiBold|Black|Light|Heavy|Demi|It|BoldItalic|BoldOblique)+(MT|PS)?$/i, "")
    .replace(/(PS)?MT$|PS$/, "").replace(/(Bold|Italic)+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
}

// ---------------------------------------------------------------- text

// The PDF often leaves the space between two fragments out of both; put it back where there
// is a visible gap. Returns the fragments with a leading space added where one is needed.
function spaced(parts) {
  return parts.map((p, i) => {
    const prev = parts[i - 1];
    const gap = prev ? p.left - prev.right : 0;
    const need = prev && gap > Math.min(p.size, prev.size) * 0.16 && !/\s$/.test(prev.text) && !/^\s/.test(p.text);
    return need ? { ...p, text: " " + p.text } : p;
  });
}

// About how wide the first word of a line is.
function firstWord(line) {
  const p = line.parts.find((q) => q.text.trim());
  const text = p.text.trimStart(), word = text.split(/\s/)[0];
  return (p.right - p.left) * word.length / Math.max(1, text.length);
}

// Group fragments into lines. Body-size fragments define the lines by their baseline; smaller
// pieces (small capitals, verse numbers, symbols) join the line whose band they fall in.
function linesOf(texts, body) {
  const lines = [];
  const tolerance = body * 0.26;
  const isBig = (t) => t.size >= body * 0.95 && !t.symbol;
  for (const t of texts.filter(isBig).sort((a, b) => a.base - b.base || a.left - b.left)) {
    const line = lines.find((l) => Math.abs(l.base - t.base) <= tolerance);
    if (line) line.parts.push(t); else lines.push({ base: t.base, top: t.top, parts: [t] });
  }
  for (const t of texts.filter((t) => !isBig(t)).sort((a, b) => a.base - b.base || a.left - b.left)) {
    const middle = (t.top + t.base) / 2;
    const home = lines.filter((l) => l.top - 2 <= middle && middle <= l.base + 2);
    if (home.length) {
      home.sort((p, q) => Math.abs((p.top + p.base) / 2 - middle) - Math.abs((q.top + q.base) / 2 - middle))[0].parts.push(t);
    } else {
      const near = lines.find((l) => Math.abs(l.base - t.base) <= tolerance && l.parts.every((p) => !isBig(p)));
      if (near) near.parts.push(t); else lines.push({ base: t.base, top: t.top, parts: [t] });
    }
  }
  for (const l of lines) {
    l.parts = spaced(l.parts.sort((a, b) => a.left - b.left));
    l.left = l.parts[0].left;
    l.right = Math.max(...l.parts.map((p) => p.right));
    l.top = Math.min(...l.parts.map((p) => p.top));
    l.text = l.parts.map((p) => p.text).join("").replace(/\s+/g, " ").trim();
  }
  return lines.filter((l) => l.text).sort((a, b) => a.base - b.base);
}

const isSmallCap = (p, body) => p.size > body * 0.72 && p.size < body * 0.93 && p.text.trim() && p.text.toUpperCase() === p.text && /[A-Z]/.test(p.text);

// Small capitals are often drawn as full-size capitals followed by smaller capitals.
function smallCapsText(parts, body) {
  return parts.map((p) => (p.size < body * 0.93 ? p.text.toLowerCase() : p.text)).join("").replace(/\s+/g, " ").trim();
}

// Text clearly larger or smaller than the body text of its page: "lg", "sm" or nothing.
const sizeClass = (size, body) => (size >= body * 1.18 ? "lg" : size <= body * 0.82 ? "sm" : "");
// the size most of a line is set in
const lineSize = (line) => [...line.parts].sort((a, b) => b.text.trim().length - a.text.trim().length)[0].size;

function runHtml(parts, body, { sizes = false } = {}) {
  // A word in small capitals is often written as a full-size capital followed by smaller
  // capitals ("H" + "OLY"). Put the word back together and mark the whole of it.
  const pieces = [];
  for (const p of parts) {
    const small = !p.symbol && isSmallCap(p, body);
    if (small && pieces.length && !pieces.at(-1).sc) {
      const before = pieces.at(-1);
      const lead = before.text.match(/[A-Z\u00C0-\u00DE]+$/);          // the capital(s) that begin this word
      if (lead && before.bold === p.bold && before.italic === p.italic) {
        before.text = before.text.slice(0, -lead[0].length);
        pieces.push({ ...p, text: lead[0] + p.text.toLowerCase(), sc: true });
        continue;
      }
    }
    pieces.push(small ? { ...p, text: p.text.toLowerCase(), sc: true } : { ...p });
  }
  let out = "";
  for (const p of pieces) {
    if (!p.text) continue;
    let t = escapeHtml(p.text);
    if (!p.symbol && !p.sc && p.size <= body * 0.74 && /^\s*\d{1,3}\s*$/.test(p.text)) t = `<sup>${t.trim()}</sup>`;
    else if (p.sc) t = `<span class="sc">${t}</span>`;
    else if (sizes && sizeClass(p.size, body) && p.text.trim()) t = `<span class="${sizeClass(p.size, body)}">${t}</span>`;
    if (p.italic) t = `<i>${t}</i>`;
    if (p.bold) t = `<b>${t}</b>`;
    out += t;
  }
  return out.replace(/<\/b>(\s*)<b>/g, "$1").replace(/<\/i>(\s*)<i>/g, "$1").replace(/<\/span>(\s*)<span class="(sc|lg|sm)">(?<=<span class="\2">[^<]*<\/span>\s*<span class="\2">)/g, "$1")
            .replace(/[ \t]+/g, " ").trim();
}

function isHeading(line, body) {
  const lead = line.parts.filter((p) => p.text.trim());
  if (!lead.length || !lead[0].bold || lead[0].italic || lead[0].size < body * 0.95) return false;
  return lead.some((p) => p.bold && isSmallCap(p, body));
}

function classify(line, body) {
  const parts = line.parts.filter((p) => p.text.trim());
  if (parts[0].size >= body * 1.2 && parts[0].bold && line.text.includes("+")) {
    // its small capitals are small next to its own capitals, not next to the body text
    const t = smallCapsText(parts, Math.max(...parts.map((p) => p.size)) * 1.01).replace(/\+/g, "").trim();
    return { type: "section", text: t.replace(/\b[a-z]/g, (c) => c.toUpperCase()) };
  }
  if (isHeading(line, body)) {
    const head = line.parts.filter((p) => p.bold && !p.italic);
    const rest = parts.filter((p) => !(p.bold && !p.italic));
    let title = smallCapsText(head, body).replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/\b(And|Of|The|For|In|To|At|Is)\b/g, (w) => w.toLowerCase());
    const stand = title.startsWith("*");
    title = title.replace(/^\*/, "").trim();
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const block = { type: "heading", text: title, stand };
    const italic = rest.filter((p) => p.italic).map((p) => p.text).join("").trim();
    const plain = rest.filter((p) => !p.italic).map((p) => p.text).join("").trim();
    if (italic) block.title = italic;
    if (plain) block.ref = plain;
    return block;
  }
  const hymn = parts[0].italic && line.text.match(/^(.+?)\s+((?:ELW|ACS|TFF|WOV|LBW|UMH|No\.)\s*\d+[a-z]?)$/);
  if (hymn) return { type: "hymn", title: hymn[1].trim(), number: hymn[2] };
  return null;
}

// Join lines into blocks. A gap wider than the usual line spacing starts a new paragraph.
// `fine` is for pages of ordinary prose, such as a welcome page: a change of text size or a
// line that returns to the margin after indented lines also starts a new paragraph, and the
// larger and smaller sizes are kept.
function paragraphs(lines, colLeft, colRight, body, { special = true, fine = false } = {}) {
  const pitches = [];
  for (let i = 1; i < lines.length; i++) { const d = lines[i].base - lines[i - 1].base; if (d > body * 0.7 && d < body * 1.6) pitches.push(d); }
  const gap = (median(pitches) || body * 1.12) * 1.17;
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const kind = special ? classify(line, body) : null;
    if (kind) { blocks.push({ ...kind, _top: line.top, _bottom: line.base }); current = null; continue; }
    const previous = current?._lines.at(-1);
    const turn = fine && previous && sizeClass(lineSize(line), body) !== sizeClass(lineSize(previous), body);
    // a list item, or a line back at the margin after indented lines, starts on a new line
    if (fine && previous && line.left < colLeft + 3 && (line.left < previous.left - 5 || /^[-\u2013\u2022]\s?\S/.test(line.text))) line._break = true;
    if (!current || turn || line.base - current._bottom > gap) {
      current = { type: "text", _top: line.top, _bottom: line.base, _lines: [line] };
      blocks.push(current);
    } else {
      current._lines.push(line);
      current._bottom = line.base;
    }
  }
  const width = colRight - colLeft, mid = (colLeft + colRight) / 2;
  for (const b of blocks) {
    if (b.type !== "text") continue;
    let html = "";
    // fine print keeps its true size as the size of the whole item, so its lines sit close together
    const small = fine && b._lines.every((l) => sizeClass(lineSize(l), body) === "sm");
    if (small) b.size = Math.round(median(b._lines.map(lineSize)) * 2) / 2;
    b._lines.forEach((line, k) => {
      // a line that stops well short of the margin ended on purpose; on a page of prose, so
      // does one with room left for the first word of the next (an address beside a logo)
      if (k) html += line._break || b._lines[k - 1].right < colRight - 0.22 * width || (fine && b._lines[k - 1].right + firstWord(line) + 6 < colRight) ? "<br>" : " ";
      html += runHtml(line.parts, small ? b.size : body, { sizes: fine });
    });
    b.html = html.replace(/<\/b>(\s*(?:<br>)?\s*)<b>/g, "$1");
    b._full = b._lines.at(-1).right > colRight - 0.12 * width;
    // a paragraph set with its lines closer together or further apart than usual keeps its spacing
    const steps = b._lines.slice(1).map((l, k) => l.base - b._lines[k].base);
    const leading = steps.length >= 2 ? median(steps) / (small ? b.size : body) : 0;
    if (leading > 0.9 && leading < 2 && Math.abs(leading - LEADING) > 0.03) b.leading = Math.round(leading * 100) / 100;
    b._left = Math.min(...b._lines.map((l) => l.left));
    b._right = Math.max(...b._lines.map((l) => l.right));
    // centred when every line is; a line that fills the width could be either, so at least one
    // must be short enough to show it
    b._center = b._lines.every((l) => Math.abs((l.left + l.right) / 2 - mid) < 11) && b._lines.some((l) => l.right - l.left < 0.9 * width);
  }
  return blocks;
}

// ---------------------------------------------------------------- pictures

// PDF makers often cut one picture into horizontal strips; put them back together.
function pictureGroups(images) {
  const groups = [];
  for (const im of [...images].sort((a, b) => a.left - b.left || a.top - b.top)) {
    const g = groups.at(-1);
    if (g && Math.abs(g.left - im.left) < 0.5 && Math.abs(g.width - im.width) < 0.5 && Math.abs(g.bottom - im.top) <= 2) {
      g.strips.push(im);
      g.bottom = im.top + im.height;
    } else {
      groups.push({ left: im.left, width: im.width, top: im.top, bottom: im.top + im.height, strips: [im] });
    }
  }
  return groups.sort((a, b) => a.top - b.top);
}

function stitch(group) {
  const width = Math.min(2000, Math.max(...group.strips.map((s) => s.canvas.width)));
  const heights = group.strips.map((s) => Math.round(s.canvas.height * width / s.canvas.width));
  // music carried over from the page before is joined with a little white between the two
  // parts: the page break was often right under a line of music, and the layout breaks
  // music only where a white band runs right across
  const gap = Math.round(width * 0.03);
  const gaps = group.strips.map((s) => (s.seam ? gap : 0));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  group.strips.forEach((s, i) => { y += gaps[i]; g.drawImage(s.canvas, 0, y, width, heights[i]); y += heights[i]; });
  // photographs are smaller as JPEG; music and line art stay sharp as PNG
  const probe = document.createElement("canvas");
  probe.width = probe.height = 32;
  probe.getContext("2d").drawImage(canvas, 0, 0, 32, 32);
  const d = probe.getContext("2d").getImageData(0, 0, 32, 32).data;
  let colour = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i + 1]) > 24 || Math.abs(d[i + 1] - d[i + 2]) > 24) colour++;
  const jpeg = canvas.toDataURL("image/jpeg", 0.88);
  if (colour > 40 && canvas.width * canvas.height > 250000) return jpeg;
  // a grey drawing or scan that was a JPEG in the PDF is often three times the size as PNG;
  // crisp black-and-white music is not, and stays sharp as PNG
  const png = canvas.toDataURL("image/png");
  return jpeg.length < png.length * 0.6 ? jpeg : png;
}

// ---------------------------------------------------------------- pages of each kind

// The font most of the text on these pages is set in, as the PDF names it.
function mainFont(pages) {
  const count = new Map();
  for (const p of pages) for (const t of p.texts) {
    if (t.symbol || !t.font) continue;
    const name = fontFamily(t.font);
    count.set(name, (count.get(name) || 0) + t.text.length);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

// The name of the installed font a PDF's font name stands for. Where the computer's fonts
// cannot be listed, the name read from the PDF is the best guess.
async function installedName(family) {
  const squeeze = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  try {
    const local = await window.queryLocalFonts();
    const match = local.find((f) => squeeze(f.family) === squeeze(family)) || local.find((f) => squeeze(fontFamily(f.postscriptName)) === squeeze(family));
    if (match) return match.family;
  } catch { /* not allowed, or not offered: keep the guess */ }
  return family;
}

function bodySize(pages) {
  const count = new Map();
  for (const p of pages) for (const t of p.texts) {
    const key = Math.round(t.size * 2) / 2;
    count.set(key, (count.get(key) || 0) + t.text.length);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 15;
}

// On a service page the side column is on the spine side: left on odd pages, right on even.
function columnsOf(page) {
  const odd = page.number % 2 === 1;
  const edge = 0.25 * IN, side = 2.75 * IN;
  return odd ? { mainL: side, mainR: page.width - edge, noteL: edge, noteR: side }
             : { mainL: edge, mainR: page.width - side, noteL: page.width - side, noteR: page.width - edge };
}

// Whether a page has the two-column look of a service page.
function looksLikeService(page) {
  const { mainL, mainR, noteL, noteR } = columnsOf(page);
  let inMain = 0, inNote = 0, across = 0;
  for (const t of page.texts) {
    if (!t.text.trim() || t.top > page.height - 0.6 * IN) continue;
    if (t.left >= mainL - 4 && t.right <= mainR + 6) inMain++;
    else if (t.left >= noteL - 4 && t.right <= noteR + 6) inNote++;
    else across++;
  }
  return inMain >= 3 && inNote >= 3 && across <= 2;
}

// A side note's words as the bulletin keeps them.
function noteHtml(html) {
  // the title is on a line of its own already; it needs no second break under it
  let text = html.replace(/^(<i>)?Hymn Information\s*(<\/i>)?\s*(?:<br>)?\s*/, (_, open = "", close = "") => `${open}<u>Hymn Information</u><br>${close}`);
  if ((text.match(/<i>/g) || []).length === 1) text = text.replace(/^<i>([\s\S]*)<\/i>$/, "$1");   // notes are italic anyway
  return text;
}

async function servicePages(pages, body, addImage, tick) {
  const blocks = [];
  for (const [done, page] of pages.entries()) {
    await tick(`Rebuilding the service: page ${page.number}…`, done / pages.length);
    const { mainL, mainR, noteL, noteR } = columnsOf(page);
    const inMain = (x) => x >= mainL - 4 && x < mainR;
    const continues = page.texts.some((t) => /continued on the following/i.test(t.text));
    const texts = page.texts.filter((t) => t.top < page.height - 0.55 * IN && !/continued on the following/i.test(t.text));
    const main = paragraphs(linesOf(texts.filter((t) => inMain(t.left)), body), mainL + 3, mainR - 5, body);
    const noteTexts = texts.filter((t) => !inMain(t.left));
    const notes = paragraphs(linesOf(noteTexts, bodySize([{ texts: noteTexts }])), noteL + 3, noteR - 4, bodySize([{ texts: noteTexts }]), { special: false });
    const pageBlocks = [...main];
    const sidePictures = [];
    for (const g of pictureGroups(page.images)) {
      if (inMain(g.left + g.width / 2)) {
        // the width it was printed at: music set a little narrower than the column is also a
        // little shorter, and over a page that decides what fits
        const width = Math.min(100, Math.round(1000 * g.width / (mainR - mainL - 0.11 * IN)) / 10);
        // a small picture printed beside a paragraph is set into it, as it was
        const beside = width < 55 && main.find((b) => b.type === "text" && !b.float && b._top < g.bottom && b._bottom > g.top
          && (b._right < g.left + 4 || b._left > g.left + g.width - 4));
        if (beside) {
          Object.assign(beside, { float: addImage(stitch(g)), floatWidth: `${Math.round(width)}%`, ...(beside._left > g.left ? { floatSide: "left" } : {}) });
          continue;
        }
        const middle = (mainL + mainR) / 2, off = g.left + g.width / 2 - middle;
        pageBlocks.push({ type: "image", _group: g, _top: g.top, _bottom: g.bottom, ...(width < 99 ? { width: `${width}%` } : {}),
                          ...(width < 80 && Math.abs(off) > 0.15 * (mainR - mainL) ? { align: off > 0 ? "right" : "left" } : {}) });
      } else {
        sidePictures.push({ top: g.top, ref: addImage(stitch(g)) });
      }
    }
    pageBlocks.sort((a, b) => a._top - b._top);
    // a side note belongs to the block it starts beside
    for (const note of notes) {
      if (!pageBlocks.length) continue;
      const cost = (b) => (b._top <= note._top + 9 ? Math.abs(b._top - note._top) : 1e6 + b._top);
      const anchor = pageBlocks.reduce((best, b) => (cost(b) < cost(best) ? b : best));
      const text = noteHtml(note.html);
      anchor.note = anchor.note ? `${anchor.note}<br><br>${text}` : text;
      note._anchor = anchor;
    }
    for (const pic of sidePictures) {
      const above = notes.filter((n) => n._anchor && n._top <= pic.top).sort((a, b) => b._top - a._top)[0];
      if (above) above._anchor.noteImage = pic.ref;
    }
    // music that ran over from the previous page ("continued on the following page…") is one
    // picture; joined again, the program can break it wherever the new layout needs
    const carried = blocks.at(-1);
    if (carried?._continues && carried.type === "image" && pageBlocks[0]?.type === "image"
        && Math.abs(carried._group.width - pageBlocks[0]._group.width) < 12) {
      const [first, ...rest] = pageBlocks[0]._group.strips;
      carried._group = { ...carried._group, strips: [...carried._group.strips, { ...first, seam: true }, ...rest] };
      if (pageBlocks[0].note) carried.note = carried.note ? `${carried.note}<br><br>${pageBlocks[0].note}` : pageBlocks[0].note;
      pageBlocks.shift();
    }
    if (blocks.length) delete blocks.at(-1)._continues;
    if (continues && pageBlocks.at(-1)?.type === "image") pageBlocks.at(-1)._continues = true;
    // a paragraph that ran over from the previous page is one paragraph
    if (blocks.length && pageBlocks.length && blocks.at(-1).type === "text" && pageBlocks[0].type === "text"
        && blocks.at(-1)._full && !pageBlocks[0].note) {
      blocks.at(-1).html += " " + pageBlocks[0].html;
      blocks.at(-1)._full = pageBlocks[0]._full;
      pageBlocks.shift();
    }
    blocks.push(...pageBlocks);
  }
  for (const b of blocks) if (b.type === "image") { b.src = addImage(stitch(b._group)); delete b._group; }
  await tick("Rebuilding the service…", 1);
  return blocks;
}

// Text set in side-by-side columns (a prayer list, a staff table). A column shows as a place
// in mid-page where text repeatedly starts, or repeatedly ends for a column set flush right,
// with nothing running across it. Each stretch of lines is judged by itself, since one page
// can hold several such tables. Returns runs of lines with the x positions that divide them.
function splitColumns(lines, left, right) {
  const width = right - left, mid = (left + right) / 2;
  const centred = (l) => Math.abs((l.left + l.right) / 2 - mid) < 12 && l.right - l.left < 0.6 * width && l.left > left + 0.15 * width;
  const groups = [];
  let group = null;
  for (const l of lines) {
    if (centred(l)) { group = null; continue; }
    if (group && l.base - group.at(-1).base < 40) group.push(l); else groups.push((group = [l]));
  }
  const cluster = (values, reach) => {
    const out = [];
    for (const v of [...values].sort((a, b) => a.key - b.key)) {
      const c = out.at(-1);
      if (c && v.key - c.max < reach) { c.items.push(v); c.max = v.key; } else out.push({ items: [v], max: v.key });
    }
    return out.filter((c) => c.items.length >= 3);
  };
  const runs = [];
  for (const g of groups) {
    const after = [];                                   // fragments that begin after a clear gap
    for (const l of g) l.parts.forEach((p, i) => {
      const gap = i ? p.left - l.parts[i - 1].right : p.left - left;
      if (p.text.trim() && gap > 0.45 * IN && p.left > left + 0.15 * width) after.push(p);
    });
    let edges = cluster(after.map((p) => ({ key: p.left, p })), 0.3 * IN).map((c) => Math.min(...c.items.map((v) => v.p.left)));
    for (const c of cluster(after.map((p) => ({ key: p.right, p })), 4)) {            // a column set flush right
      const x = Math.min(...c.items.map((v) => v.p.left));
      if (Math.max(...c.items.map((v) => v.p.left)) - x <= 0.3 * IN) continue;       // also flush left: already found
      // its entries start at different places; where several happen to start together is not another column
      edges = edges.filter((e) => e < x - 6);
      edges.push(x);
    }
    edges.sort((a, b) => a - b);
    if (!edges.length) continue;
    const crosses = (p) => edges.some((e) => p.left < e - 6 && p.right > e + 6);
    const keep = g.filter((l) => !l.parts.some((p) => p.text.trim() && crosses(p)));
    if (keep.length !== g.length) continue;             // something runs across: these are not columns
    if (g.flatMap((l) => l.parts).filter((p) => p.text.trim() && p.left >= edges[0] - 6).length >= 3) runs.push({ edges, lines: g });
  }
  return runs;
}

// A page with no side column: the extra pages, the welcome page and the back page.
function fullWidthPage(page, addImage, { announcements = false, fine = false } = {}) {
  const texts = page.texts.filter((t) => t.text.trim() && t.top < page.height - 0.55 * IN);
  if (!texts.length && !page.images.length) return [];
  const body = bodySize([{ texts }]);
  const lines = linesOf(texts, body);
  const left = Math.min(...texts.map((t) => t.left)), right = Math.max(...texts.map((t) => t.right));
  const blocks = [];
  const used = new Set();

  // rows of "role ........ name"
  const dotted = lines.filter((l) => /\.{4,}/.test(l.text));
  if (dotted.length >= 2) {
    const rows = dotted.map((l) => { const [a, b] = l.text.split(/\s*\.{4,}\s*/); return { left: (a || "").trim(), right: (b || "").trim() }; });
    const above = lines.filter((l) => l.base < dotted[0].top && dotted[0].top - l.base < 26).at(-1);
    blocks.push({ type: "roster", title: above ? above.text : "", rows, _top: (above || dotted[0]).top, _bottom: dotted.at(-1).base });
    dotted.forEach((l) => used.add(l));
    if (above) used.add(above);
  }
  // a row of nothing but dots is a dotted line across the page
  for (const l of lines) {
    if (used.has(l) || !/^[.\u2026\s]{20,}$/.test(l.text)) continue;
    blocks.push({ type: "rule", dotted: true, _top: l.top, _bottom: l.base });
    used.add(l);
  }
  // side-by-side columns of text; each column is read top to bottom on its own
  for (const run of splitColumns(lines.filter((l) => !used.has(l)), left, right)) {
    const cols = Array.from({ length: run.edges.length + 1 }, () => []);
    for (const l of run.lines) {
      for (const p of l.parts) if (p.text.trim()) cols[run.edges.filter((e) => p.left >= e - 6).length].push(p);
      used.add(l);
    }
    // on a page that keeps its sizes, columns in clearly smaller or larger type keep theirs
    const own = Math.round(median(run.lines.flatMap((l) => l.parts).filter((p) => p.text.trim()).map((p) => p.size)) * 2) / 2;
    const size = fine && sizeClass(own, body) ? own : body;
    const html = cols.map((parts) => linesOf(parts.map((p) => ({ ...p, text: p.text.trimStart() })), size).map((l) => runHtml(l.parts, size)).join("<br>"));
    if (html.filter(Boolean).length < 2) { run.lines.forEach((l) => used.delete(l)); continue; }
    const kept = cols.filter((_, i) => html[i] || i < 2);
    blocks.push({ type: "columns", columns: html.filter((h, i) => h || i < 2), ...(size !== body ? { size } : {}), _top: run.lines[0].top, _bottom: run.lines.at(-1).base,
                  _cols: kept.map((parts) => (parts.length ? [Math.min(...parts.map((p) => p.left)), Math.max(...parts.map((p) => p.right))] : null)) });
  }
  // lines drawn across the page are kept where they are; a page without any has its
  // announcements divided by a line before each one
  const rules = drawnRules(page);
  for (const r of rules) blocks.push({ type: "rule", _top: r.top, _bottom: r.top });
  const ruleBetween = (above, below) => rules.some((r) => r.top > above - 2 && r.top < below + 2);
  // everything else, as paragraphs
  const rest = paragraphs(lines.filter((l) => !used.has(l)), left, right, body, { special: false, fine });
  let previousBold = false;
  for (const p of rest) {
    const bold = p.html.startsWith("<b>");
    const last = blocks.filter((b) => b.type === "text" && b._flow).at(-1);
    if (announcements && p._center && bold && !p.html.includes("<br>") && p.html.replace(/<[^>]+>/g, "").length < 60) {
      blocks.push({ type: "heading", text: p.html.replace(/<[^>]+>/g, "").trim(), stand: false, _top: p._top, _bottom: p._bottom });
    } else if (announcements && last && !(bold && !previousBold) && p._top - last._bottom < 40 && !ruleBetween(last._bottom, p._top)) {
      last.html += "<br><br>" + p.html;                  // one announcement is one block
      last._bottom = p._bottom;
    } else {
      if (announcements && !rules.length && bold && !previousBold && blocks.some((b) => b.type === "text")) blocks.push({ type: "rule", _top: p._top - 1, _bottom: p._top - 1 });
      blocks.push({ type: "text", html: p.html, align: p._center ? "center" : "left", ...(p.size ? { size: p.size } : {}), ...(p.leading ? { leading: p.leading } : {}), _flow: announcements,
                    _top: p._top, _bottom: p._bottom, _left: p._left, _right: p._right });
    }
    previousBold = bold && /<\/b>\s*$/.test(p.html);
  }
  // text printed on a grey box keeps the grey behind it
  for (const box of greyBoxes(page)) {
    const inside = (l, r, t, b) => l >= box.left - 3 && r <= box.right + 3 && t >= box.top - 3 && b <= box.bottom + 3;
    for (const b of blocks) {
      if (b.type === "columns") {
        const shaded = b._cols.flatMap((c, i) => (c && inside(c[0], c[1], b._top, Math.min(b._bottom, box.bottom)) ? [i] : []));
        if (shaded.length) b.shaded = shaded;
      } else if (b.type === "text" && inside(b._left, b._right, b._top, b._bottom)) b.shaded = true;
    }
  }
  // pictures: set into the paragraph beside them, or placed on their own
  for (const g of pictureGroups(page.images)) {
    const ref = addImage(stitch(g));
    const beside = announcements && blocks.find((b) => b.type === "text" && b._top - 22 <= g.top && g.top <= b._bottom && g.left > page.width * 0.4);
    // text that starts beside a picture on its left, such as an address beside a logo
    const after = !beside && blocks.find((b) => b.type === "text" && !b.float && b._left > g.left + g.width - 4 && b._top < g.bottom && b._bottom > g.top);
    const width = Math.max(10, Math.min(100, Math.round(100 * g.width / (page.width - IN))));
    // a small picture in the empty foot of a short last column belongs to those columns
    const columns = blocks.find((b) => b.type === "columns" && !b.picture && g.top >= b._top && g.top <= b._bottom + 30 && g.left > page.width * 0.3);
    if (columns) columns.picture = ref;
    else if (beside && !beside.float) { beside.float = ref; beside.floatWidth = `${width}%`; }
    else if (after) Object.assign(after, { float: ref, floatSide: "left", floatWidth: `${width}%` });
    else blocks.push({ type: "image", src: ref, width: `${width}%`, split: false, _top: g.top, _bottom: g.bottom, _left: g.left,
                       ...(g.left > page.width * 0.55 ? { align: "right" } : g.left + g.width < page.width * 0.45 ? { align: "left" } : {}) });
  }
  return blocks.sort((a, b) => a._top - b._top);
}

// A page after the service may set its note on a grey box where the side column would be,
// beside text set as the service is (the dismissal, say), with other things below across the
// page. It is a page of the service: the text and its note are read as on a service page,
// and the rest as on a page without a side column. Returns its blocks, or null for a page
// that is not like this.
function sideNotePage(page, body, addImage) {
  const { mainL, mainR, noteL, noteR } = columnsOf(page);
  const box = greyBoxes(page).find((b) => b.left >= noteL - 6 && b.right <= noteR + 6);
  if (!box) return null;
  const blocks = fullWidthPage(page, addImage);
  const pair = blocks.find((b) => b.type === "columns" && b.shaded?.includes(b.columns.length - 1));
  if (!pair) return null;
  const texts = page.texts.filter((t) => t.text.trim() && t.base >= pair._top - 2 && t.top <= pair._bottom + 2);
  const inBox = (t) => t.left >= box.left - 4 && t.right <= box.right + 4;
  const main = paragraphs(linesOf(texts.filter((t) => !inBox(t)), body), mainL + 3, mainR - 5, body);
  const noteTexts = texts.filter(inBox), noteBody = bodySize([{ texts: noteTexts }]);
  const notes = paragraphs(linesOf(noteTexts, noteBody), box.left + 3, box.right - 4, noteBody, { special: false });
  if (!main.length) return null;
  if (notes.length) main[0].note = notes.map((n) => noteHtml(n.html)).join("<br><br>");
  // what was across the whole page now has the main column: pictures keep their printed size
  const column = mainR - mainL - 0.11 * IN, across = page.width - IN;
  for (const b of blocks) if (b.type === "image" && b.width) b.width = `${Math.min(100, Math.round(parseFloat(b.width) * across / column))}%`;
  blocks.splice(blocks.indexOf(pair), 1, ...main);
  return blocks;
}

// Pictures printed side by side become one row of pictures.
function pictureRows(blocks) {
  const out = [];
  for (const b of blocks) {
    const row = out.at(-1);
    if (b.type === "image" && (row?.type === "image" || row?.type === "logos") && b._top < row._bottom - 4) {
      const pictures = [...(row._pictures || [row]), b].sort((x, y) => x._left - y._left);         // left to right
      out[out.length - 1] = { type: "logos", images: pictures.map((x) => x.src), _pictures: pictures, _top: row._top, _bottom: Math.max(row._bottom, b._bottom) };
    } else out.push(b);
  }
  return out;
}

// The Lord's Prayer is said from one page, so it is kept on one: the text under a heading
// that names it, or text that begins with its first words.
const LORDS_PRAYER = /lord.?s prayer|prayer of jesus|our father/i;
function keepPrayers(blocks) {
  blocks.forEach((b, i) => {
    const before = blocks[i - 1];
    if (b.type === "text" && ((before?.type === "heading" && LORDS_PRAYER.test(before.text)) ||
        /^\s*our father\b/i.test(b.html.replace(/<[^>]+>/g, "")))) b.keep = true;
  });
  return blocks;
}

const strip = (blocks) => blocks.map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith("_"))));

// ---------------------------------------------------------------- the whole file

// Opens the PDF and suggests which pages are the service.
//
// `progress(message, fraction)` is called as the work goes on and is awaited, so the screen
// can redraw between steps; the fraction runs from 0 to 1 over reading and building together.
export async function inspectPdf(data, progress = async () => {}) {
  // ask for pictures as plain pixel data, which is what toCanvas reads most reliably
  // (photographs in JPEG 2000 need the decoder that ships beside the library)
  const pdf = await pdfjs.getDocument({ data, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    wasmUrl: new URL("../../node_modules/pdfjs-dist/wasm/", import.meta.url).href }).promise;
  // a PDF made by this program carries the bulletin inside it; nothing needs working out
  const attached = (await pdf.getAttachments().catch(() => null))?.["bulletin.json"];
  if (attached?.content) {
    try {
      const doc = JSON.parse(new TextDecoder().decode(attached.content));
      // its pictures are those on the pages: take them from there
      await progress("Taking the pictures from the PDF…", 0.3);
      doc.images = await followPointers(await pdf.getData(), doc.images || {});
      return { embedded: normalize(doc), count: pdf.numPages };
    } catch { /* fall through: read the pages instead */ }
  }
  // a few pages at a time, so the reader prepares the next pages while this one is unpacked
  const pages = new Array(pdf.numPages);
  const waiting = Array.from(pages, (_, i) => i + 1);
  let read = 0;
  await progress(`Reading page 1 of ${pdf.numPages}…`, 0);
  await Promise.all(Array.from({ length: Math.min(4, pdf.numPages) }, async () => {
    for (let n; (n = waiting.shift()); ) {
      pages[n - 1] = await readPage(pdf, n);
      read++;
      await progress(`Reading page ${Math.min(read + 1, pdf.numPages)} of ${pdf.numPages}…`, 0.6 * read / pdf.numPages);
    }
  }));
  await progress("Working out which pages are the service…", 0.6);
  const service = pages.filter(looksLikeService).map((p) => p.number);
  // a page of nothing but music has no side notes, so take the whole stretch from the first
  // page that looks like the service to the last
  const first = service[0] || Math.min(3, pdf.numPages);
  const last = service.length ? Math.max(...service) : Math.max(first, pdf.numPages - 1);
  return { pages, count: pdf.numPages, first, last };
}

export async function buildBulletin({ pages, count }, first, last, progress = async () => {}) {
  // filled in as the four lists of the first file format, then turned into parts at the end
  const doc = { style: {}, meta: {}, cover: {}, welcome: [], welcomeLogo: "", service: [], extras: [], back: [], images: {} };
  let welcomeBlocks = null, welcomeSize = 0, backBlocks = null, backSize = 0;
  let n = 0;
  const addImage = (dataUrl) => { const id = `p${++n}`; doc.images[id] = dataUrl; return `img:${id}`; };
  const at = (number) => pages[number - 1];
  const body = bodySize(pages.slice(first - 1, last));

  await progress("Rebuilding the cover…", 0.6);
  const cover = at(1);
  const coverLines = linesOf(cover.texts.filter((t) => t.text.trim() && t.text.trim() !== "#"), bodySize([cover]))
    .map((l) => ({ ...l, text: smallCapsText(l.parts, Math.max(...l.parts.map((p) => p.size)) * 1.01) }));
  const big = pictureGroups(cover.images).sort((a, b) => b.width * (b.bottom - b.top) - a.width * (a.bottom - a.top))[0];
  const artTop = big ? big.top : cover.height / 2;
  const title = (t) => t.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Of|After|The|And|In)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase());
  const upper = coverLines.filter((l) => l.base < artTop), lower = coverLines.filter((l) => l.base >= artTop);
  doc.meta = { title: title(upper[0]?.text || ""), sunday: title(upper[1]?.text || ""), date: upper.slice(2).map((l) => l.parts.map((p) => p.text).join("").trim()).join(" ") };
  doc.cover = { image: big ? addImage(stitch(big)) : "", footer: lower.map((l) => l.parts.map((p) => p.text).join("").replace(/\s+/g, " ").trim()) };

  if (first > 2) {
    await progress("Rebuilding the welcome page…", 0.63);
    const welcome = at(2);
    const logo = pictureGroups(welcome.images)[0];
    // the welcome page keeps its own headings, text sizes and lines
    welcomeBlocks = fullWidthPage({ ...welcome, images: [] }, addImage, { fine: true });
    welcomeSize = bodySize([welcome]);
    const beside = welcomeBlocks.find((b) => b.type === "text");
    if (logo && beside) {
      // everything that sits beside the picture stays in one item, so it wraps around the picture
      for (let i = welcomeBlocks.indexOf(beside) + 1; welcomeBlocks[i]?.type === "text" && welcomeBlocks[i]._top < logo.bottom - 4; ) {
        const [more] = welcomeBlocks.splice(i, 1);
        beside.html += "<br>" + more.html;
        beside._bottom = more._bottom;
      }
      Object.assign(beside, { align: "left", float: addImage(stitch(logo)), floatSide: "left",
        floatWidth: `${Math.max(10, Math.min(35, Math.round(100 * logo.width / (welcome.width - IN))))}%` });
    }
  }

  // the paragraphs of a reading or a prayer are one item, so they are edited as one
  doc.service = keepPrayers(joinRuns(strip(await servicePages(pages.slice(first - 1, last), body, addImage,
    (message, part) => progress(message, 0.65 + 0.25 * part)))));

  const backNumber = count > last ? count : 0;
  let serviceEnd = last;
  for (let number = last + 1; number < count; number++) {
    await progress(`Rebuilding page ${number}…`, 0.9 + 0.08 * (number - last) / Math.max(1, count - last));
    // a page straight after the service that has its side note where the side column is
    const more = number === serviceEnd + 1 && sideNotePage(at(number), body, addImage);
    if (more) { doc.service = keepPrayers(joinRuns([...doc.service, ...strip(more)])); serviceEnd = number; continue; }
    const blocks = fullWidthPage(at(number), addImage, { announcements: true });
    if (!blocks.length) continue;
    if (doc.extras.length) doc.extras.push({ type: "pagebreak" });
    doc.extras.push(...joinRuns(strip(blocks).map(({ align, ...b }) => (b.type === "image" && align ? { ...b, align } : b))));
  }
  if (backNumber) {
    await progress("Rebuilding the back page…", 0.98);
    // like the welcome page, it keeps its text sizes and a picture set beside its text
    backBlocks = pictureRows(fullWidthPage(at(backNumber), addImage, { fine: true }));
    backSize = bodySize([at(backNumber)]);
  }
  doc.style.bodySize = Math.round(body * 2) / 2;
  const noteSizes = doc.service.length ? bodySize(pages.slice(first - 1, last).map((p) => {
    const { mainL, mainR } = columnsOf(p);
    return { texts: p.texts.filter((t) => !(t.left >= mainL - 4 && t.left < mainR)) };
  })) : 12;
  doc.style.noteSize = Math.round(noteSizes * 2) / 2 || 12;
  if (last + 1 < count) doc.style.extraSize = Math.round(bodySize(pages.slice(last, count - 1)) * 2) / 2 || 14.5;
  await progress("Laying out the pages…", 1);
  // the paper the PDF was made for, if it is one of the sizes the program knows
  const paper = Object.entries(PAPERS).find(([, p]) => Math.abs(p.w * 72 - at(1).width) < 6 && Math.abs(p.h * 72 - at(1).height) < 6);
  if (paper) doc.style.paper = paper[0];
  const made = normalize(doc);
  // the fonts the PDF was set in; a font not on this computer falls back to the program's own
  const font = mainFont(pages.slice(first - 1, last));
  if (font && !/^EB Garamond$/i.test(font)) made.style.font = await installedName(font);
  const coverFont = mainFont([cover]);
  if (coverFont && coverFont !== font) made.style.fonts.cover = await installedName(coverFont);
  if (welcomeBlocks) Object.assign(made.parts[0], { blocks: joinRuns(strip(welcomeBlocks)), size: Math.round(welcomeSize * 2) / 2 || 13 });
  if (backBlocks) Object.assign(made.parts.at(-1), { blocks: joinRuns(strip(backBlocks)), size: Math.round(backSize * 2) / 2 || 14 });
  // the service's size is the bulletin's default; only parts that differ keep a size of their own
  for (const part of made.parts) if (part.size === made.style.size) delete part.size;
  return made;
}
