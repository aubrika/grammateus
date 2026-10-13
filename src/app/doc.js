// The bulletin as data, and the few operations on it that do not need a screen.
//
// A bulletin is a cover followed by parts. A part is a run of pages holding a list of
// blocks (headings, text, pictures and so on). Every part can hold every kind of block, and
// each part chooses whether its pages have the grey side column for notes. One part may be
// marked as last: it is kept at the very end, after any blank pages, as the back cover.

export const FORMAT = 2;

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
  return { name, side: false, size: 14.5, blocks: [] };
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
  doc.style = { font: doc.style?.font || "EB Garamond", noteSize: doc.style?.noteSize || 12 };
  doc.meta = { title: "", sunday: "", date: "", ...(doc.meta || {}) };
  doc.cover = { show: true, image: "", footer: [], ...(doc.cover || {}) };
  doc.parts = doc.parts.map((p) => ({ name: p.name || "Part", side: !!p.side, size: p.size || 14.5, ...(p.last ? { last: true } : {}), blocks: p.blocks || [] }));
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

// Keep only the formatting a bulletin uses: bold, italic, underline, small capitals,
// superscript and line breaks. Word and web pages paste a great deal more than that.
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
      const smallCaps = child.classList.contains("sc") || /font-variant(-caps)?:\s*small-caps/.test(style);
      if (BLOCKS.has(tag) && out.length && !/<br>\s*$/.test(out.at(-1))) out.push("<br>");
      for (const w of wraps) out.push(`<${w}>`);
      if (smallCaps) out.push('<span class="sc">');
      walk(child);
      if (smallCaps) out.push("</span>");
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
