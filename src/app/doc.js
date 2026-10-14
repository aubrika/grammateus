// The bulletin as data, and the few operations on it that do not need a screen.
//
// A bulletin is a cover followed by parts. A part is a run of pages holding a list of
// blocks (headings, text, pictures and so on). Every part can hold every kind of block, and
// each part chooses whether its pages have the grey side column for notes. One part may be
// marked as last: it is kept at the very end, after any blank pages, as the back cover.

export const FORMAT = 2;

// The kinds of item that can each be given their own font, with the words used for "all of them".
export const FONT_KINDS = {
  section: "section titles", heading: "headings", text: "text", hymn: "hymn titles", note: "side notes",
  roster: "lists with dotted lines", columns: "columns", cover: "the cover",
};

// Sizes of paper for the pages of the folded bulletin, in inches, with the sheet each pair of
// pages is printed on. Letter is the default.
export const PAPERS = {
  letter: { name: "Letter", w: 8.5, h: 11, sheet: "11 × 17 in", shown: "8.5 × 11 in" },
  "half-letter": { name: "Half letter", w: 5.5, h: 8.5, sheet: "letter paper", shown: "5.5 × 8.5 in" },
  "half-legal": { name: "Half legal", w: 7, h: 8.5, sheet: "legal paper", shown: "7 × 8.5 in" },
  a4: { name: "A4", w: 210 / 25.4, h: 297 / 25.4, sheet: "A3", shown: "210 × 297 mm" },
  a5: { name: "A5", w: 148 / 25.4, h: 210 / 25.4, sheet: "A4", shown: "148 × 210 mm" },
};

// The kinds of item that can also be given their own text size (the cover's words are sized
// to its design). Side notes are 12 points unless they are given another size.
export const SIZE_KINDS = ["section", "heading", "text", "hymn", "note", "roster", "columns"];
export const NOTE_SIZE = 12;

export const BLOCK_NAMES = {
  section: "Section title",
  heading: "Heading",
  text: "Text",
  hymn: "Hymn title",
  image: "Picture or music",
  roster: "List with dotted lines",
  columns: "Columns",
  logos: "Row of pictures",
  rule: "Line across the page",
  pagebreak: "Start a new page",
};

export function emptyBulletin() {
  return normalize({});
}

export function newPart(name = "New part") {
  return { name, side: false, blocks: [] };          // no size of its own: it uses the default
}

// Bulletins saved by the first version kept the welcome page, service, extra pages and back
// page as four separate lists. Turn those into parts.
function upgrade(doc) {
  const style = doc.style || {};
  const toBlock = (item) => (item.columns ? { type: "columns", columns: item.columns }
    : item.logos ? { type: "logos", images: item.logos }
    : { type: "text", html: item.html || "", ...(item.align === "center" ? { align: "center" } : {}) });
  const welcome = (doc.welcome || []).map(toBlock);
  const first = welcome.find((b) => b.type === "text");
  if (doc.welcomeLogo && first) Object.assign(first, { float: doc.welcomeLogo, floatSide: "left", floatWidth: "15%" });
  doc.parts = [
    { name: "Welcome page", side: false, size: 13, blocks: welcome },
    { name: "The service", side: true, size: style.bodySize || 15, blocks: doc.service || [] },
    { name: "Extra pages", side: false, size: style.extraSize || 14.5, blocks: doc.extras || [] },
    { name: "Back page", side: false, size: 14, last: true, blocks: (doc.back || []).map(toBlock) },
  ];
  for (const key of ["welcome", "welcomeLogo", "service", "extras", "back"]) delete doc[key];
  doc.style = { font: style.font, noteSize: style.noteSize };
  return doc;
}

// Fill in anything missing so the rest of the program can rely on the shape.
export function normalize(doc) {
  if (!Array.isArray(doc.parts)) upgrade(doc);
  doc.format = FORMAT;
  // `fonts` holds a font for each kind of item ("heading", "text", "note" and so on); a kind
  // that is not listed uses the bulletin's font
  const fonts = Object.fromEntries(Object.entries(doc.style?.fonts || {}).filter(([, v]) => v));
  // `sizes` likewise holds a text size in points for each kind; a kind not listed uses the
  // size of the part it is in (side notes: NOTE_SIZE). Bulletins saved before side notes
  // joined this list kept their size as `noteSize`.
  const sizes = Object.fromEntries(Object.entries(doc.style?.sizes || {}).filter(([k, v]) => SIZE_KINDS.includes(k) && v >= 5 && v <= 60));
  if (doc.style?.noteSize && doc.style.noteSize !== NOTE_SIZE && !sizes.note) sizes.note = doc.style.noteSize;
  const paper = PAPERS[doc.style?.paper] ? doc.style.paper : "letter";
  // the default text size, used by every part that has no size of its own; bulletins saved
  // before there was one take the size of their main part
  const main = (doc.parts || []).find((p) => p.side && p.size) || (doc.parts || []).find((p) => p.size);
  const size = doc.style?.size >= 5 ? doc.style.size : main?.size || 14.5;
  doc.style = { font: doc.style?.font || "EB Garamond", size, fonts, sizes, paper,
                ...(doc.style?.whiteSide ? { whiteSide: true } : {}) };
  doc.wholeSheets = doc.wholeSheets !== false;
  doc.meta = { title: "", sunday: "", date: "", ...(doc.meta || {}) };
  doc.cover = { show: true, image: "", footer: [], ...(doc.cover || {}) };
  doc.parts = doc.parts.map((p) => ({ name: p.name || "Part", side: !!p.side, ...(p.size >= 5 ? { size: p.size } : {}), ...(p.last ? { last: true } : {}), blocks: p.blocks || [] }));
  placeLast(doc);
  doc.extraSheets = Math.max(0, doc.extraSheets || 0);
  doc.images = doc.images || {};
  return doc;
}

// At most one part is the last one, and it sits at the end of the list.
export function placeLast(doc, keep) {
  const marked = doc.parts.filter((p) => p.last);
  const last = keep && keep.last ? keep : marked.at(-1);
  for (const p of doc.parts) if (p !== last) delete p.last;
  if (last) { doc.parts.splice(doc.parts.indexOf(last), 1); doc.parts.push(last); }
  return doc;
}

export function newBlock(type) {
  switch (type) {
    case "section": return { type, text: "New section" };
    case "heading": return { type, text: "New heading", stand: false };
    case "hymn": return { type, title: "Hymn title", number: "" };
    case "image": return { type, src: "" };
    case "pagebreak": return { type };
    case "rule": return { type };
    case "roster": return { type, title: "Serving today", rows: [{ left: "Role", right: "Name" }] };
    case "columns": return { type, columns: ["", ""] };
    case "logos": return { type, images: [] };
    default: return { type: "text", html: "" };
  }
}

// One line describing a block, for the outline.
export function summary(block) {
  const plain = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  switch (block.type) {
    case "section": return block.text;
    case "heading": return (block.stand ? "*" : "") + block.text + (block.title ? ` — ${block.title}` : "");
    case "hymn": return `${block.title} ${block.number || ""}`.trim();
    case "image": return "Picture";
    case "pagebreak": return "— new page —";
    case "rule": return "— line —";
    case "roster": return block.title || "List";
    case "logos": return "Row of pictures";
    case "columns": return plain((block.columns || []).join(" ")).slice(0, 60) || "(empty columns)";
    default: return plain(block.html).slice(0, 60) || "(empty text)";
  }
}

export function move(list, index, by) {
  const to = index + by;
  if (to < 0 || to >= list.length) return index;
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item);
  return to;
}

// Store a picture inside the bulletin and return the reference that points to it.
export function addImage(doc, dataUrl) {
  let id;
  do { id = Math.random().toString(36).slice(2, 10); } while (doc.images[id]);
  doc.images[id] = dataUrl;
  return `img:${id}`;
}

// Every picture reference a block holds.
export function pictureRefs(block) {
  return [block.src, block.noteImage, block.float, block.picture, ...(block.images || [])].filter(Boolean);
}

// Drop stored pictures that nothing refers to any more.
export function pruneImages(doc) {
  const used = new Set();
  const note = (ref) => { if (ref && ref.startsWith("img:")) used.add(ref.slice(4)); };
  note(doc.cover.image);
  for (const part of doc.parts) for (const b of part.blocks) pictureRefs(b).forEach(note);
  for (const id of Object.keys(doc.images)) if (!used.has(id)) delete doc.images[id];
  return doc;
}

// Keep only the formatting a bulletin uses: bold, italic, underline, small capitals, larger
// and smaller words, superscript and line breaks. Word and web pages paste a great deal more than that.
export function cleanHtml(html, documentRef = globalThis.document) {
  const box = documentRef.createElement("template");
  box.innerHTML = html;
  const out = [];
  const BLOCKS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "TR"]);
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out.push(child.nodeValue.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (["STYLE", "SCRIPT", "META", "LINK", "TITLE", "XML"].includes(tag) || tag.includes(":")) continue;
      if (tag === "BR") { out.push("<br>"); continue; }
      const style = (child.getAttribute("style") || "").toLowerCase();
      const wraps = [];
      if (tag === "B" || tag === "STRONG" || /font-weight:\s*(bold|[6-9]00)/.test(style)) wraps.push("b");
      if (tag === "I" || tag === "EM" || /font-style:\s*italic/.test(style)) wraps.push("i");
      if (tag === "U") wraps.push("u");
      if (tag === "SUP" || /vertical-align:\s*super/.test(style)) wraps.push("sup");
      const marks = ["lg", "sm"].filter((c) => child.classList.contains(c));
      if (child.classList.contains("sc") || /font-variant(-caps)?:\s*small-caps/.test(style)) marks.push("sc");
      if (BLOCKS.has(tag) && out.length && !/<br>\s*$/.test(out.at(-1))) out.push("<br>");
      for (const w of wraps) out.push(`<${w}>`);
      for (const m of marks) out.push(`<span class="${m}">`);
      walk(child);
      for (const m of marks) out.push("</span>");
      for (const w of wraps.reverse()) out.push(`</${w}>`);
      if (BLOCKS.has(tag)) out.push("<br>");
    }
  };
  walk(box.content);
  return out.join("")
    .replace(/ /g, " ")
    .replace(/<(b|i|u|sup)><\/\1>/g, "")
    .replace(/(\s*<br>\s*){3,}/g, "<br><br>")
    .replace(/^(\s*<br>\s*)+|(\s*<br>\s*)+$/g, "")
    .trim();
}
