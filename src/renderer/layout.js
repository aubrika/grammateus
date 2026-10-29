// Lays a bulletin out into pages.
//
// The service is a list of blocks (headings, text, hymn titles, pictures). Each is placed
// in the main column of the current page; when one does not fit, text is split between
// lines and anything else moves to the next page. A side note is tied to a block, so it
// is drawn beside wherever that block ends up.

import { NOTE_SIZE, PAPERS } from "../app/doc.js";

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function blockElement(block, src) {
  switch (block.type) {
    case "section":
      return el("div", "section", `<span class="plus">+</span> ${block.text} <span class="plus">+</span>`);
    case "heading": {
      const h = el("div", "heading", `<span>${block.stand ? "*" : ""}${block.text}</span>`);
      if (block.title) h.append(el("span", "title", block.title));
      if (block.ref) h.append(el("span", "ref", block.ref));
      return h;
    }
    case "hymn":
      return el("div", "hymn", `<span class="title">${block.title}</span><span class="number">${block.number || ""}</span>`);
    case "image": {
      const f = pictureElement(src(block.src), block.width, 0, 1);
      if (block.align) f.style.textAlign = block.align;
      return f;
    }
    case "rule":
      return el("hr", block.dotted ? "rule dotted" : "rule");
    case "roster": {
      // a boxed list of roles and names, joined by a row of dots
      const box = el("div", "roster");
      if (block.title) box.append(el("div", "roster-title", block.title));
      for (const row of block.rows || []) {
        const line = el("div", "roster-row");
        const dots = el("span", "dots");
        dots.textContent = ". ".repeat(200);                 // clipped to the space between the two sides
        line.append(el("span", "", row.left || ""), dots, el("span", "right", row.right || ""));
        box.append(line);
      }
      return box;
    }
    case "logos": {
      const row = el("div", "logos");
      for (const one of block.images || []) { const img = el("img"); img.src = src(one); row.append(img); }
      return row;
    }
    case "columns": {
      const row = el("div", "columns");
      for (const [i, html] of (block.columns || []).entries()) row.append(el("div", (block.shaded || []).includes(i) ? "shaded" : "", html));
      if (block.picture && row.lastChild) {           // a small picture under the last column
        const img = el("img", "under");
        img.src = src(block.picture);
        row.lastChild.append(img);
      }
      return row;
    }
    default: {
      // a blank line inside a block is a paragraph gap, set closer than a full line; blank
      // lines at its start or end stay whole lines, a way to move the words, or what
      // follows them, down the page
      const [, lead, body, tail] = /^((?:\s*<br>)*)([\s\S]*?)((?:<br>\s*)*)$/.exec(block.html || "");
      const p = el("p", `text${block.align === "center" ? " center" : ""}${block.shaded ? " shaded" : ""}`,
        lead + body.replace(/<br>\s*<br>/g, '<span class="gap"></span>') + tail);
      if (block.float) {                     // a picture set into the side of the paragraph
        const img = el("img", block.floatSide === "left" ? "float left" : "float");
        img.src = src(block.float);
        if (block.floatWidth) img.style.width = block.floatWidth;
        p.prepend(img);
      }
      return p;
    }
  }
}

// A picture, or the part of it between two heights (0 = top, 1 = bottom). Music is often
// taller than the space left on a page, so a picture can be shown in parts.
function pictureElement(src, width, from, to) {
  const f = el("figure");
  const crop = el("div", "crop");
  const img = el("img");
  img.src = src;
  crop.style.width = width || "100%";
  crop.append(img);
  f.append(crop);
  f.picture = { src, width, from, to };
  return f;
}

// Sets the visible part of a picture once its size is known.
function fitPicture(f) {
  const { from, to } = f.picture;
  const crop = f.firstChild, img = crop.firstChild;
  const full = crop.clientWidth * img.naturalHeight / img.naturalWidth;
  crop.style.height = `${(to - from) * full}px`;
  img.style.marginTop = `${-from * full}px`;
  return full;
}

// Heights (as fractions) where a picture has a band of blank rows right across it:
// between two lines of music, never through one.
const cutCache = new Map();
function cutPoints(img) {
  if (cutCache.has(img.src)) return cutCache.get(img.src);
  const w = 240, h = Math.max(1, Math.round(img.naturalHeight * w / img.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const blank = [];
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 660) dark++; }
    blank.push(dark === 0);
  }
  const cuts = [];
  const need = Math.max(2, Math.round(h * 0.004));
  for (let y = 0; y < h; y++) {
    if (!blank[y]) continue;
    let end = y;
    while (end + 1 < h && blank[end + 1]) end++;
    if (y > 0 && end < h - 1 && end - y + 1 >= need) cuts.push((y + end + 1) / 2 / h);
    y = end;
  }
  cutCache.set(img.src, cuts);
  return cuts;
}

const KEEP_WITH_NEXT = new Set(["section", "heading", "hymn"]);

// Tops of the lines of text in an element, in order.
function lineTops(p) {
  const range = document.createRange();
  range.selectNodeContents(p);
  const tops = [];
  for (const r of range.getClientRects()) {
    if (r.width < 0.5) continue;
    if (!tops.some((t) => Math.abs(t - r.top) < 3)) tops.push(r.top);
  }
  return tops.sort((a, b) => a - b);
}

// Split paragraph p so that its first `keep` lines stay; returns the remainder as a new element.
function splitAtLine(p, keep) {
  const target = lineTops(p)[keep];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const topAt = (node, i) => {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    return r ? r.top : null;
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const n = node.length;
    if (!n) continue;
    const last = topAt(node, n - 1);
    if (last === null || last < target - 3) continue;
    let lo = 0, hi = n - 1;                       // first character on or below the target line
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const t = topAt(node, mid);
      if (t !== null && t >= target - 3) hi = mid; else lo = mid + 1;
    }
    const rest = document.createRange();
    rest.setStart(node, lo);
    rest.setEndAfter(p.lastChild);
    const tail = p.cloneNode(false);
    tail.append(rest.extractContents());
    tail.classList.add("continued");
    return tail;
  }
  return null;
}

// A page that blocks flow into. A part either has the side column for notes on each of its
// pages, or uses the full width.
function flowPage(pages, number, part, partIndex, folio, before) {
  const page = el("div", `page ${part.side ? "service" : "extra"} ${number % 2 ? "odd" : "even"}`);
  page.dataset.part = partIndex;
  page.style.setProperty("--part-size", `${part.size || defaultSize}pt`);
  const side = part.side ? el("div", "side") : null;
  const main = el("div", "main");
  if (side) page.append(side);
  page.append(main);
  if (folio) page.append(el("div", "folio", String(number - 1)));
  pages.insertBefore(page, before || null);
  return { page, side, main, placed: [] };
}

const fits = (main) => main.scrollHeight <= main.clientHeight + 0.5;

const family = (name) => `"${String(name).replace(/["\\]/g, "")}", var(--serif)`;
let fonts = {};                                           // font for each kind of item, set per layout
let sizes = {};                                           // text size for each kind of item, likewise
let defaultSize = 14.5;                                   // for parts with no size of their own

async function flow(part, kind, pages, firstNumber, src, folio = true, before = null) {
  const blocks = part.blocks || [];
  if (!blocks.some((b) => b.type !== "pagebreak")) return [];
  let number = firstNumber;
  let cur = flowPage(pages, number, part, kind, folio, before);
  const all = [cur];
  const next = () => { cur = flowPage(pages, ++number, part, kind, folio, before); all.push(cur); };

  for (const [index, block] of blocks.entries()) {
    if (block.type === "pagebreak") { if (cur.placed.length) next(); continue; }
    let node = blockElement(block, src);
    node.dataset.part = kind;
    node.dataset.index = index;
    const font = block.font || fonts[block.type];           // this item's own font, or the font for its kind
    if (font) node.style.fontFamily = family(font);
    const size = block.size || sizes[block.type];           // this item's own text size, or its kind's
    if (size) node.style.fontSize = `${size}pt`;
    if (block.leading) node.style.lineHeight = String(block.leading);   // its own line spacing
    const pictures = [...node.querySelectorAll("img")];
    await Promise.all(pictures.map((i) => i.decode().catch(() => {})));
    let first = true;
    for (;;) {
      cur.main.append(node);
      if (node.picture) fitPicture(node);
      if (fits(cur.main)) { cur.placed.push({ node, block, first }); break; }

      if (node.picture && block.split !== false) {
        // show as much of the picture as fits, cutting only where it is blank right across
        const img = node.querySelector("img");
        const full = fitPicture(node);
        const { width, from, to } = node.picture;
        const inch = 96;
        // "continued on the following page…" is printed below the column, so the music may
        // run nearly to its foot
        const room = cur.main.getBoundingClientRect().bottom - node.getBoundingClientRect().top - 0.04 * inch;
        const cut = cutPoints(img).filter((c) => c > from && c < to && (c - from) * full <= room
          && (c - from) * full >= 0.6 * inch && (to - c) * full >= 0.4 * inch).pop();
        if (cut) {
          node.picture.to = cut;
          fitPicture(node);
          cur.placed.push({ node, block, first });
          cur.page.append(el("div", "continues", "continued on the following page…"));
          first = false;
          node = pictureElement(node.picture.src, width, cut, to);
          node.dataset.part = kind;
          node.dataset.index = index;
          await node.querySelector("img").decode().catch(() => {});
          next();
          continue;
        }
      }

      if (block.type === "text" && block.float && first) {
        // a picture set into a short paragraph near the foot of a page may be made a little
        // smaller rather than take the paragraph over to the next page
        const img = node.querySelector("img.float");
        const over = node.getBoundingClientRect().bottom - cur.main.getBoundingClientRect().bottom;
        const scale = (img.getBoundingClientRect().height - over - 1) / img.getBoundingClientRect().height;
        if (scale >= 0.7 && scale < 1) {
          img.style.width = `${img.getBoundingClientRect().width * scale}px`;
          if (fits(cur.main)) { cur.placed.push({ node, block, first }); break; }
          img.style.width = block.floatWidth || "";
        }
      }

      // text kept on one page (the Lord's Prayer, say) moves on whole; it is split only when
      // it would not fit even on a page of its own, below nothing but its heading
      const whole = block.keep && !cur.placed.every((x) => KEEP_WITH_NEXT.has(x.block.type));
      if (block.type === "text" && !block.float && !whole) {
        // keep as many whole lines as fit, but never strand a single line on either side
        const tops = lineTops(node);
        const limit = cur.main.getBoundingClientRect().bottom;
        const lineHeight = tops.length > 1 ? tops[1] - tops[0] : 0;
        let keep = tops.filter((t) => t + lineHeight <= limit + 0.5).length;
        if (keep >= tops.length - 1) keep = tops.length - 2;
        if (keep >= 2 && tops.length - keep >= 2) {
          const tail = splitAtLine(node, keep);
          if (tail && fits(cur.main)) {
            cur.placed.push({ node, block, first });
            first = false;
            node = tail;
            node.dataset.part = kind;
            node.dataset.index = index;
            next();
            continue;
          }
          if (tail) { node.append(...tail.childNodes); }      // could not split cleanly; undo
        }
      }

      node.remove();
      // headings must not be left at the foot of a page without what they introduce
      const carried = [];
      while (cur.placed.length && KEEP_WITH_NEXT.has(cur.placed.at(-1).block.type) && cur.placed.length > 1) {
        const p = cur.placed.pop();
        p.node.remove();
        carried.unshift(p);
      }
      if (!cur.placed.length && !carried.length) {
        // a single block taller than the page: shrink a picture to fit, let text overflow
        cur.main.append(node);
        if (node.picture) {
          const full = fitPicture(node);
          const scale = (cur.main.clientHeight - 8) / ((node.picture.to - node.picture.from) * full);
          if (scale < 1) { node.firstChild.style.width = `${node.firstChild.clientWidth * scale}px`; fitPicture(node); }
        }
        cur.placed.push({ node, block, first });
        break;
      }
      next();
      for (const p of carried) { cur.main.append(p.node); if (p.node.picture) fitPicture(p.node); cur.placed.push(p); }
    }
  }
  return all;
}

// Side notes sit beside the block they belong to. If two would overlap, the later one moves
// down; if that runs off the page, the notes above are pushed up to make room.
function placeNotes(servicePages, src) {
  const gap = 8;
  for (const sp of servicePages) {
    if (!sp.side) continue;
    const top0 = sp.side.getBoundingClientRect().top;
    const height = sp.side.clientHeight;
    const notes = [];
    for (const { node, block, first } of sp.placed) {
      if (!block.note || !first) continue;
      const n = el("div", "note", block.note);
      if (fonts.note) n.style.fontFamily = family(fonts.note);
      if (block.noteImage) { const img = el("img"); img.src = src(block.noteImage); n.append(img); }
      n.dataset.part = node.dataset.part;
      n.dataset.index = node.dataset.index;
      sp.side.append(n);
      notes.push({ n, want: node.getBoundingClientRect().top - top0 + 3 });
    }
    let y = 0;
    for (const note of notes) { note.top = Math.max(note.want, y); y = note.top + note.n.offsetHeight + gap; }
    let limit = height;
    for (let i = notes.length - 1; i >= 0; i--) {
      const h = notes[i].n.offsetHeight;
      if (notes[i].top + h > limit) notes[i].top = Math.max(0, limit - h);
      limit = notes[i].top - gap;
    }
    for (const note of notes) note.n.style.top = `${note.top}px`;
    sp.overfullSide = notes.length > 0 && notes[0].top === 0 && notes.reduce((s, x) => s + x.n.offsetHeight + gap, 0) > height;
  }
}

function coverPage(doc, src) {
  const page = el("div", "page cover");
  const top = el("div", "top");
  top.append(el("div", "title", doc.meta.title), el("div", "sunday", doc.meta.sunday), el("div", "date", doc.meta.date));
  const art = el("div", "art");
  if (doc.cover.image) { const img = el("img"); img.src = src(doc.cover.image); art.append(img); }
  page.append(top, art, el("div", "foot", (doc.cover.footer || []).join("<br>")));
  page.dataset.part = "cover";
  if (doc.style?.fonts?.cover) page.style.fontFamily = family(doc.style.fonts.cover);
  return page;
}

// Pictures are either stored inside the bulletin ("img:<id>") or are files beside it.
export function resolver(doc, base = "") {
  return (ref) => (ref && ref.startsWith("img:") ? (doc.images || {})[ref.slice(4)] || "" : base + ref);
}

// Builds every page into `pages` and returns a short report.
//
// Page order: the cover, each part in turn, blank pages as needed, then the part marked as
// last (the back cover). A folded bulletin is made of whole sheets, four pages each, so the
// total is always a multiple of four; `extraSheets` adds whole sheets beyond the fewest that fit.
export async function layoutBulletin(doc, pages, base = "") {
  const src = resolver(doc, base);
  const style = doc.style || {};
  pages.style.setProperty("--serif", `"${style.font || "EB Garamond"}", "EB Garamond", serif`);
  pages.style.setProperty("--note-size", `${style.sizes?.note || NOTE_SIZE}pt`);
  // the size of paper: the pages, the printed PDF, and everything drawn in proportion to them
  const paper = PAPERS[style.paper] || PAPERS.letter;
  pages.style.setProperty("--page-w", `${paper.w}in`);
  pages.style.setProperty("--page-h", `${paper.h}in`);
  pages.style.setProperty("--scale", String(paper.w / 8.5));
  pages.style.setProperty("--vscale", String(paper.h / 11));
  const sizeRule = pages.ownerDocument.getElementById("paper-size") ||
    pages.ownerDocument.head.appendChild(Object.assign(pages.ownerDocument.createElement("style"), { id: "paper-size" }));
  sizeRule.textContent = `@page { size: ${paper.w}in ${paper.h}in; margin: 0; }`;
  // a white side column saves toner; the notes still sit in it
  if (style.whiteSide) pages.style.setProperty("--grey", "#fff"); else pages.style.removeProperty("--grey");
  // line spacing for the whole bulletin; an item may still have its own
  if (style.leading) pages.style.setProperty("--leading", String(style.leading)); else pages.style.removeProperty("--leading");
  fonts = style.fonts || {};
  sizes = style.sizes || {};
  defaultSize = style.size || 14.5;
  // without whole sheets, only the sheets asked for are added; the printer supplies any other blanks
  const sheetsFor = (count) => (doc.wholeSheets === false ? count / 4 : Math.ceil(count / 4) || 1) + Math.max(0, doc.extraSheets || 0);
  pages.replaceChildren();
  await document.fonts.ready;
  let number = 0;
  if (doc.cover.show !== false) { pages.append(coverPage(doc, src)); number = 1; }

  const flows = [];                                   // one entry per part: the pages it filled
  const parts = doc.parts || [];
  for (const [index, part] of parts.entries()) {
    if (part.last) continue;
    const made = await flow(part, index, pages, number + 1, src);
    flows[index] = made;
    number += made.length;
  }
  // the last part goes after any blank pages; blanks can change which side of the sheet it
  // falls on, so it is laid out once to count its pages and again where it will really sit
  const lastIndex = parts.findIndex((p) => p.last);
  let blanks = 0;
  let total = number;
  if (lastIndex >= 0) {
    let made = await flow(parts[lastIndex], lastIndex, pages, number + 1, src, false);
    total = number + made.length;
    blanks = Math.round(sheetsFor(total) * 4 - total);
    if (blanks) {
      made.forEach((m) => m.page.remove());
      for (let i = 0; i < blanks; i++) { const b = el("div", "page blank"); b.dataset.part = "blank"; pages.append(b); }
      made = await flow(parts[lastIndex], lastIndex, pages, number + blanks + 1, src, false);
    }
    flows[lastIndex] = made;
    total = number + blanks + made.length;
  } else {
    blanks = Math.round(sheetsFor(total) * 4 - total);
    for (let i = 0; i < blanks; i++) { const b = el("div", "page blank"); b.dataset.part = "blank"; pages.append(b); }
    total += blanks;
  }
  await Promise.all([...pages.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  const every = flows.flat().filter(Boolean);
  placeNotes(every, src);

  const order = [...pages.children];
  return {
    pages: total,
    sheets: Math.ceil(total / 4),
    wholeSheets: total % 4 === 0,
    blankPages: blanks,
    parts: parts.map((p, i) => ({ name: p.name, pages: (flows[i] || []).length })),
    crowdedSides: every.filter((f) => f.overfullSide).map((f) => order.indexOf(f.page) + 1 - (doc.cover.show !== false ? 1 : 0)),
  };
}
