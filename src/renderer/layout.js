// Lays a bulletin out into pages.
//
// The service is a list of blocks (headings, text, hymn titles, pictures). Each is placed
// in the main column of the current page; when one does not fit, text is split between
// lines and anything else moves to the next page. A side note is tied to a block, so it
// is drawn beside wherever that block ends up.

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function blockElement(block, base) {
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
    case "image":
      return pictureElement(base + block.src, block.width, 0, 1);
    default:
      return el("p", "text", block.html);
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

function servicePage(pages, number) {
  const page = el("div", `page service ${number % 2 ? "odd" : "even"}`);
  const side = el("div", "side");
  const main = el("div", "main");
  page.append(side, main, el("div", "folio", String(number - 1)));
  pages.append(page);
  return { page, side, main, placed: [] };
}

const fits = (main) => main.scrollHeight <= main.clientHeight + 0.5;

async function layoutService(doc, pages, firstNumber, base) {
  let number = firstNumber;
  let cur = servicePage(pages, number);
  const all = [cur];
  const next = () => { cur = servicePage(pages, ++number); all.push(cur); };

  for (const block of doc.service) {
    let node = blockElement(block, base);
    if (block.type === "image") await node.querySelector("img").decode().catch(() => {});
    let first = true;
    for (;;) {
      cur.main.append(node);
      if (node.picture) fitPicture(node);
      if (fits(cur.main)) { cur.placed.push({ node, block, first }); break; }

      if (node.picture && block.split !== false) {
        // show as much of the picture as fits, cutting only where it is blank right across
        const img = node.querySelector("img");
        const full = fitPicture(node);
        const { src, width, from, to } = node.picture;
        const inch = 96;
        const room = cur.main.getBoundingClientRect().bottom - node.getBoundingClientRect().top - 0.3 * inch;
        const cut = cutPoints(img).filter((c) => c > from && c < to && (c - from) * full <= room
          && (c - from) * full >= 0.6 * inch && (to - c) * full >= 0.4 * inch).pop();
        if (cut) {
          node.picture.to = cut;
          fitPicture(node);
          cur.placed.push({ node, block, first });
          cur.main.append(el("div", "continues", "continued on the following page…"));
          first = false;
          node = pictureElement(src, width, cut, to);
          await node.querySelector("img").decode().catch(() => {});
          next();
          continue;
        }
      }

      if (block.type === "text") {
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
function placeNotes(servicePages, base) {
  const gap = 8;
  for (const sp of servicePages) {
    const top0 = sp.side.getBoundingClientRect().top;
    const height = sp.side.clientHeight;
    const notes = [];
    for (const { node, block, first } of sp.placed) {
      if (!block.note || !first) continue;
      const n = el("div", "note", block.note);
      if (block.noteImage) { const img = el("img"); img.src = base + block.noteImage; n.append(img); }
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

function coverPage(doc, base) {
  const page = el("div", "page cover");
  const top = el("div", "top");
  top.append(el("div", "title", doc.meta.title), el("div", "sunday", doc.meta.sunday), el("div", "date", doc.meta.date));
  const art = el("div", "art");
  if (doc.cover.image) { const img = el("img"); img.src = base + doc.cover.image; art.append(img); }
  page.append(top, art, el("div", "foot", doc.cover.footer.join("<br>")));
  return page;
}

function plainPage(kind, items, base, number, logo) {
  const page = el("div", `page plain ${kind}`);
  const body = el("div", "body");
  if (logo) { const img = el("img", "logo"); img.src = base + logo; body.append(img); }
  for (const item of items) {
    if (item.logos) {
      const row = el("div", "logos");
      for (const src of item.logos) { const img = el("img"); img.src = base + src; row.append(img); }
      body.append(row);
    } else {
      body.append(el("p", item.align === "center" ? "center" : "", item.html));
    }
  }
  page.append(body);
  if (number) page.append(el("div", "folio", String(number - 1)));
  return page;
}

// Builds every page into `pages` and returns a short report.
export async function layoutBulletin(doc, pages, base = "") {
  pages.replaceChildren();
  await document.fonts.ready;
  pages.append(coverPage(doc, base));
  pages.append(plainPage("welcome", doc.welcome, base, 2, doc.welcomeLogo));
  const servicePages = await layoutService(doc, pages, 3, base);
  await Promise.all([...pages.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  placeNotes(servicePages, base);

  // A folded booklet needs a multiple of four pages, with the back cover last.
  let count = 2 + servicePages.length + 1;
  let blanks = 0;
  while (count % 4) { pages.append(el("div", "page blank")); count++; blanks++; }
  pages.append(plainPage("back", doc.back, base, 0));

  const lastMain = servicePages.at(-1).main;
  const used = [...lastMain.children].reduce((b, c) => Math.max(b, c.getBoundingClientRect().bottom), lastMain.getBoundingClientRect().top);
  return {
    pages: count,
    sheets: count / 4,
    servicePages: servicePages.length,
    blankPages: blanks,
    lastPageFilled: Math.round(100 * (used - lastMain.getBoundingClientRect().top) / lastMain.clientHeight),
    crowdedSides: servicePages.map((s, i) => (s.overfullSide ? i + 3 : 0)).filter(Boolean),
  };
}
