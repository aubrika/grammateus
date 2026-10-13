// The bulletin as data, and the few operations on it that do not need a screen.

export const FORMAT = 1;

export const BLOCK_NAMES = {
  section: "Section title",
  heading: "Heading",
  text: "Text",
  hymn: "Hymn title",
  image: "Picture or music",
  pagebreak: "Start a new page",
};

export function emptyBulletin() {
  return normalize({});
}

// Fill in anything missing so the rest of the program can rely on the shape.
export function normalize(doc) {
  doc.format = FORMAT;
  doc.style = { font: "EB Garamond", bodySize: 15, noteSize: 12, ...(doc.style || {}) };
  doc.meta = { title: "", sunday: "", date: "", ...(doc.meta || {}) };
  doc.cover = { image: "", footer: [], ...(doc.cover || {}) };
  doc.welcomeLogo = doc.welcomeLogo || "";
  doc.welcome = doc.welcome || [];
  doc.service = doc.service || [];
  doc.extras = doc.extras || [];
  doc.back = doc.back || [];
  doc.extraSheets = Math.max(0, doc.extraSheets || 0);
  doc.images = doc.images || {};
  return doc;
}

export function newBlock(type) {
  switch (type) {
    case "section": return { type, text: "New section" };
    case "heading": return { type, text: "New heading", stand: false };
    case "hymn": return { type, title: "Hymn title", number: "" };
    case "image": return { type, src: "" };
    case "pagebreak": return { type };
    default: return { type: "text", html: "" };
  }
}

// One line describing a block, for the outline.
export function summary(block) {
  const plain = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  switch (block.type) {
    case "section": return block.text;
    case "heading": return (block.stand ? "*" : "") + block.text + (block.title ? ` — ${block.title}` : "");
    case "hymn": return `${block.title} ${block.number || ""}`.trim();
    case "image": return "Picture";
    case "pagebreak": return "— new page —";
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

// Drop stored pictures that nothing refers to any more.
export function pruneImages(doc) {
  const used = new Set();
  const note = (ref) => { if (ref && ref.startsWith("img:")) used.add(ref.slice(4)); };
  note(doc.cover.image);
  note(doc.welcomeLogo);
  for (const b of [...doc.service, ...doc.extras]) { note(b.src); note(b.noteImage); }
  for (const item of [...doc.welcome, ...doc.back]) (item.logos || []).forEach(note);
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
