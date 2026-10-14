// The editing screen: an outline of the bulletin on the left, a form for the selected item
// in the middle, and a live preview of the pages on the right.

import { layoutBulletin } from "../renderer/layout.js";
import { BLOCK_NAMES, FONT_KINDS, addImage, cleanHtml, emptyBulletin, move, newBlock, newPart, normalize, placeLast, pruneImages, summary } from "./doc.js";

const $ = (id) => document.getElementById(id);
const desk = window.desk || null;            // provided by the desktop program; absent in a plain browser

let doc = emptyBulletin();
// What is being edited: the cover, the design, a part's settings, or one block of a part.
let selected = { kind: "cover", p: 0, i: 0 };
let fileName = "";
let dirty = false;
let report = null;
let problem = "";                            // stays on screen until the next successful action
let notice = "";                             // what just happened; stays until the next change

// ---------------------------------------------------------------- small helpers

function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...children.filter((c) => c != null));
  return e;
}

function changed(redrawOutline = true) {
  dirty = true;
  notice = "";
  if (redrawOutline) drawOutline();
  schedulePreview();
  scheduleSnapshot();
  showStatus();
}

function textField(label, value, set, placeholder = "") {
  const input = h("input", { type: "text", value: value || "", placeholder });
  input.addEventListener("input", () => { set(input.value); changed(); });
  return [h("label", {}, label), input];
}

function checkbox(label, value, set, redraw = false) {
  const input = h("input", { type: "checkbox" });
  input.checked = !!value;
  input.addEventListener("change", () => { set(input.checked); changed(); if (redraw) drawForm(); });
  return h("label", { class: "check" }, input, label);
}

function pickImage() {
  return new Promise((resolve) => {
    const input = $("pickimage");
    input.value = "";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

// The fonts offered when choosing one: those installed on this computer where the program is
// allowed to ask, otherwise a list of common ones. Any name can still be typed.
const COMMON_FONTS = ["EB Garamond", "Garamond", "Georgia", "Times New Roman", "Cambria", "Palatino Linotype", "Book Antiqua",
                      "Constantia", "Calibri", "Candara", "Segoe UI", "Verdana", "Arial", "Gill Sans MT", "Century Gothic"];
let fontsLoaded = false;
let fontNames = COMMON_FONTS;
async function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  let names = COMMON_FONTS;
  try {
    if (window.queryLocalFonts) names = [...new Set(["EB Garamond", ...(await window.queryLocalFonts()).map((f) => f.family)])].sort((a, b) => a.localeCompare(b));
  } catch { /* not allowed here: keep the common list */ }
  fontNames = names;
}

// A box for choosing a font. Empty means "the same as the rest".
function fontField(label, get, set, placeholder, extra) {
  // The arrow opens a list of every font on the computer; typing narrows the list.
  const input = h("input", { type: "text", value: get() || "", placeholder, autocomplete: "off" });
  const arrow = h("button", { type: "button", class: "arrow", title: "Show all fonts", "aria-label": "Show all fonts" });
  const menu = h("div", { class: "menu", hidden: "" });
  const use = (name) => { input.value = name; set(name); changed(false); };
  const close = () => { menu.hidden = true; };
  const open = async (filter) => {
    await loadFonts();
    const wanted = (filter || "").toLowerCase();
    const names = fontNames.filter((f) => f.toLowerCase().includes(wanted));
    const option = (text, name, style) => {
      const o = h("button", { type: "button", class: name === input.value.trim() ? "on" : "", style }, text);
      o.addEventListener("mousedown", (e) => { e.preventDefault(); use(name); close(); });
      return o;
    };
    menu.replaceChildren(...(filter ? [] : [option(`Same as the rest (${placeholder})`, "", "")]),
      ...names.map((f) => option(f, f, `font-family: "${f.replace(/["\\]/g, "")}", var(--ui)`)));
    menu.hidden = !menu.children.length;
    menu.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };
  arrow.addEventListener("mousedown", (e) => e.preventDefault());       // keep the typing place in the box
  arrow.addEventListener("click", () => { if (menu.hidden) { input.focus(); open(""); } else close(); });
  input.addEventListener("input", () => { set(input.value.trim()); changed(false); open(input.value.trim()); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); else if (e.key === "ArrowDown" && menu.hidden) open(""); });
  input.addEventListener("blur", close);
  return [h("label", {}, label), h("div", { class: "fontrow" }, h("div", { class: "fontbox" }, input, arrow, menu), extra)];
}

const imageUrl = (ref) => (ref && ref.startsWith("img:") ? doc.images[ref.slice(4)] : ref) || "";

// A box for formatted text. Pasting keeps bold, italic, small capitals and line breaks and
// drops everything else, so text from Word or a web page arrives clean.
function rich(html, set, { note = false } = {}) {
  const box = h("div", { class: "box", contenteditable: "true", spellcheck: "true" });
  box.innerHTML = html || "";
  const commit = () => { set(cleanHtml(box.innerHTML)); changed(); };
  box.addEventListener("input", commit);
  box.addEventListener("paste", (e) => {
    e.preventDefault();
    const data = e.clipboardData;
    const pasted = data.getData("text/html")
      ? cleanHtml(data.getData("text/html"))
      : data.getData("text/plain").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])).replace(/\r?\n/g, "<br>");
    document.execCommand("insertHTML", false, pasted);
  });
  const fmt = (label, title, run) => {
    const b = h("button", { type: "button", title }, label);
    b.addEventListener("mousedown", (e) => e.preventDefault());       // keep the selection
    b.addEventListener("click", () => { run(); commit(); });
    return b;
  };
  const mark = (name) => () => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const text = sel.toString().replace(/[<>&]/g, "");
    document.execCommand("insertHTML", false, `<span class="${name}">${text}</span>`);
  };
  const bar = h("div", { class: "fmt" },
    fmt("B", "Bold: words everyone says together", () => document.execCommand("bold")),
    fmt("I", "Italic: instructions and titles", () => document.execCommand("italic")),
    fmt("Sᴄ", "Small capitals", mark("sc")),
    fmt("Large", "Larger words, for a title inside the text", mark("lg")),
    fmt("Small", "Smaller words, for fine print", mark("sm")),
    fmt("x²", "Raised, for verse numbers", () => document.execCommand("superscript")),
    fmt("Plain", "Remove formatting from the selected words", () => document.execCommand("removeFormat")));
  return h("div", { class: note ? "rich note" : "rich" }, bar, box);
}

// ---------------------------------------------------------------- slow work
//
// Anything that takes more than a moment shows this panel: a spinner, what is happening, and
// how far along it is. Each call waits for the screen to redraw, so the spinner keeps turning
// and the numbers keep moving even while the program is working hard.

function busy(message, fraction) {
  $("busy").hidden = false;
  $("busytext").textContent = message;
  const bar = $("busybar");
  if (fraction == null) { bar.removeAttribute("value"); $("busypct").textContent = ""; }
  else { const pct = Math.max(0, Math.min(100, Math.round(fraction * 100))); bar.value = pct; $("busypct").textContent = `${pct}% done`; }
  return new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
}

function idle() {
  $("busy").hidden = true;
}

// ---------------------------------------------------------------- undo and redo
//
// Every change is remembered as a copy of the bulletin's words and structure. Pictures are
// left out of the copies (they are large and never edited), so undoing never loses one.

const past = [];
let future = [];
let lastSnapshot = "";
let snapshotTimer = 0;
const snapshot = () => JSON.stringify({ ...doc, images: undefined });

function resetHistory() {
  past.length = 0;
  future = [];
  lastSnapshot = snapshot();
  showHistory();
}

function commitSnapshot() {
  clearTimeout(snapshotTimer);
  const now = snapshot();
  if (now === lastSnapshot) return;
  past.push(lastSnapshot);
  if (past.length > 200) past.shift();
  future = [];
  lastSnapshot = now;
  showHistory();
}

function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(commitSnapshot, 500);       // typing is remembered in short bursts
}

function restore(text) {
  const images = doc.images;
  doc = normalize(JSON.parse(text));
  doc.images = images;
  lastSnapshot = text;
  dirty = true;
  notice = "";
  fixSelection();
  drawOutline();
  drawForm();
  schedulePreview();
  showStatus();
  showHistory();
}

function undo() {
  commitSnapshot();
  if (!past.length) return;
  future.push(lastSnapshot);
  restore(past.pop());
}

function redo() {
  commitSnapshot();
  if (!future.length) return;
  past.push(lastSnapshot);
  restore(future.pop());
}

function showHistory() {
  $("undo").disabled = !past.length;
  $("redo").disabled = !future.length;
}

// ---------------------------------------------------------------- outline

// Make sure the selection still points at something after parts or blocks have changed.
function fixSelection() {
  if (selected.kind !== "part" && selected.kind !== "block") return;
  if (!doc.parts.length) { selected = { kind: "cover", p: 0, i: 0 }; return; }
  selected.p = Math.min(selected.p, doc.parts.length - 1);
  const blocks = doc.parts[selected.p].blocks;
  if (selected.kind === "block") {
    if (!blocks.length) selected.kind = "part";
    else selected.i = Math.min(selected.i, blocks.length - 1);
  }
}

// Choosing from the outline brings the item into view on the pages. Choosing by clicking the
// pages leaves the pages where they are and brings the outline to the item instead.
function select(kind, p = 0, i = 0, fromPages = false) {
  selected = { kind, p, i };
  fixSelection();
  drawOutline();
  drawForm();
  highlight(!fromPages);
  if (fromPages) $("outline").querySelector(".row.on")?.scrollIntoView({ block: "nearest" });
}

function drawOutline() {
  const nav = $("outline");
  const keep = nav.scrollTop;
  nav.replaceChildren();
  const row = (cls, label, on, pick, tag) => {
    const b = h("button", { class: `row ${cls}${on ? " on" : ""}`, onclick: pick }, label);
    if (tag) b.append(h("span", { class: "tag" }, tag));
    nav.append(b);
  };
  row("part design", "Design", selected.kind === "design", () => select("design"));
  row("part", "Cover", selected.kind === "cover", () => select("cover"), doc.cover.show === false ? "off" : "");
  doc.parts.forEach((part, p) => {
    const tags = [part.side ? "side notes" : "", part.last ? "last" : ""].filter(Boolean).join(" · ");
    row("part title", part.name, selected.kind === "part" && selected.p === p, () => select("part", p), tags);
    part.blocks.forEach((b, i) => row(b.type, summary(b), selected.kind === "block" && selected.p === p && selected.i === i,
      () => select("block", p, i), b.note ? "note" : ""));
  });
  row("part add", "+ Add a part…", false, () => {
    const at = doc.parts.findIndex((x) => x.last);
    const part = newPart();
    doc.parts.splice(at < 0 ? doc.parts.length : at, 0, part);
    changed();
    select("part", doc.parts.indexOf(part));
  });
  nav.scrollTop = keep;
}

// ---------------------------------------------------------------- forms

function drawForm() {
  const form = $("form");
  form.replaceChildren();
  if (selected.kind === "cover") return coverForm(form);
  if (selected.kind === "design") return designForm(form);
  if (selected.kind === "part") return partForm(form, selected.p);
  return blockForm(form, selected.p, selected.i);
}

function pictureField(form, label, get, set) {
  const img = h("img", { class: "thumb", src: imageUrl(get()), alt: "" });
  img.hidden = !get();
  form.append(h("label", {}, label), img, h("div", { class: "tools" },
    h("button", { onclick: async () => { const data = await pickImage(); if (data) { set(addImage(doc, data)); changed(); drawForm(); } } },
      get() ? "Replace picture…" : "Choose picture…"),
    get() ? h("button", { class: "danger", onclick: () => { set(""); changed(); drawForm(); } }, "Remove picture") : null));
}

function coverForm(form) {
  form.append(h("h1", {}, "Cover"), h("p", { class: "hint" }, "The front of the bulletin."),
    checkbox("Include a cover page", doc.cover.show !== false, (v) => (doc.cover.show = v)),
    ...textField("Title", doc.meta.title, (v) => (doc.meta.title = v), "Liturgy of Holy Communion"),
    ...textField("Sunday or occasion", doc.meta.sunday, (v) => (doc.meta.sunday = v), "Twentieth Sunday after Pentecost"),
    ...textField("Date", doc.meta.date, (v) => (doc.meta.date = v), "October 11, 2026"),
    ...textField("Church name and place (use | between lines)", (doc.cover.footer || []).join(" | "),
      (v) => (doc.cover.footer = v.split("|").map((s) => s.trim()).filter(Boolean))));
  pictureField(form, "Cover picture", () => doc.cover.image, (v) => (doc.cover.image = v));
}

function sizeField(label, get, set, min, max) {
  const input = h("input", { type: "number", value: get(), min, max, step: "0.5" });
  input.addEventListener("input", () => { const v = parseFloat(input.value); if (v >= min && v <= max) { set(v); changed(false); } });
  return [h("label", {}, label), input];
}

function designForm(form) {
  const fonts = doc.style.fonts;
  form.append(h("h1", {}, "Design"),
    h("p", { class: "hint" }, "These apply to the whole bulletin. EB Garamond comes with the program, so it looks the same on every computer. " +
      "Any other font must be installed on the computer that makes the PDF. The size of the main text is set for each part."),
    ...fontField("Font for the whole bulletin", () => doc.style.font, (v) => (doc.style.font = v || "EB Garamond"), "EB Garamond"),
    ...sizeField("Size of the side notes (points)", () => doc.style.noteSize, (v) => (doc.style.noteSize = v), 7, 16),
    h("h2", {}, "A different font for one kind of item"),
    h("p", { class: "hint" }, "Leave a box empty to use the bulletin's font. A single item can also be given its own font, where you edit it."),
    ...Object.entries(FONT_KINDS).flatMap(([kind, words]) => fontField(words.charAt(0).toUpperCase() + words.slice(1), () => fonts[kind],
      (v) => { if (v) fonts[kind] = v; else delete fonts[kind]; }, "the bulletin's font")),
    h("h2", {}, "Sheets of paper"),
    checkbox("Add blank pages so the bulletin fills whole sheets (four pages to a sheet)", doc.wholeSheets, (v) => (doc.wholeSheets = v)),
    h("p", { class: "hint" }, "A folded bulletin is printed on whole sheets, so its page count must be a multiple of four. With this on, any blank pages " +
      "are placed just before the back cover, so the back cover is still the outside. Turn it off if your printer or copier adds the blanks itself."),
    h("div", { class: "tools" }, h("button", { onclick: fitToSheets }, "Enlarge text to fill the sheets (experimental)")),
    h("p", { class: "hint" }, "Makes all the text as large as it can be while the bulletin still fits on the sheets it already needs. " +
      "Pictures and music stay the same size. It takes a few seconds, and Undo puts the sizes back."));
}

const ADDABLE = ["section", "heading", "text", "hymn", "image", "roster", "columns", "logos", "rule", "pagebreak"];

function addBar(p, at, label = "Add after this:") {
  return h("div", { class: "add" }, h("span", {}, label),
    ...ADDABLE.map((t) => h("button", { onclick: () => { doc.parts[p].blocks.splice(at + 1, 0, newBlock(t)); changed(); select("block", p, at + 1); } }, BLOCK_NAMES[t])));
}

// A part: a run of pages with its own name, text size and choice of side column.
function partForm(form, p) {
  const part = doc.parts[p];
  if (!part) return;
  const last = doc.parts.length - 1;
  const movable = (to) => to >= 0 && to <= last && !part.last && !doc.parts[to].last;
  form.append(h("h1", {}, part.name), h("p", { class: "hint" }, "A part is a run of pages. It always starts on a new page."),
    h("div", { class: "tools" },
      h("button", { onclick: () => { const to = move(doc.parts, p, -1); changed(); select("part", to); }, disabled: !movable(p - 1) }, "Move up"),
      h("button", { onclick: () => { const to = move(doc.parts, p, 1); changed(); select("part", to); }, disabled: !movable(p + 1) }, "Move down"),
      h("button", { class: "danger", onclick: () => {
        if (part.blocks.length && !confirm(`Remove "${part.name}" and the ${part.blocks.length} items in it?`)) return;
        doc.parts.splice(p, 1); pruneImages(doc); changed(); select(doc.parts.length ? "part" : "cover", Math.min(p, doc.parts.length - 1));
      } }, "Remove this part")),
    ...textField("Name (shown only in the outline)", part.name, (v) => (part.name = v || "Part")),
    checkbox("Pages in this part have the grey side column, for notes beside the text", part.side, (v) => (part.side = v), true),
    checkbox("Keep this part at the very end, as the back cover", part.last, (v) => {
      if (v) part.last = true; else delete part.last;
      placeLast(doc, part);
      selected.p = doc.parts.indexOf(part);
    }, true),
    ...sizeField("Size of the text in this part (points)", () => part.size, (v) => (part.size = v), 8, 22),
    h("p", { class: "hint" }, part.blocks.length ? `${part.blocks.length} items. Select one in the outline to change it.` : "This part is empty. Add its first item below."),
    addBar(p, part.blocks.length - 1, part.blocks.length ? "Add at the end of this part:" : "Add:"));
}

// Two to four boxes of formatted text side by side.
function columnsEditor(owner) {
  const count = h("select", {}, ...[2, 3, 4].map((n) => h("option", { value: n, selected: owner.columns.length === n }, `${n} columns`)));
  count.addEventListener("change", () => {
    const n = Number(count.value);
    while (owner.columns.length < n) owner.columns.push("");
    if (owner.columns.length > n) owner.columns = [...owner.columns.slice(0, n - 1), owner.columns.slice(n - 1).filter(Boolean).join("<br>")];
    changed(); drawForm();
  });
  return [h("label", {}, "Columns"), count,
    ...owner.columns.map((html, i) => h("div", { class: "item" }, rich(html, (v) => (owner.columns[i] = v))))];
}

function blockForm(form, p, i) {
  const part = doc.parts[p];
  const list = part.blocks;
  const block = list[i];
  if (!block) return partForm(form, p);
  form.append(h("h1", {}, BLOCK_NAMES[block.type]), h("p", { class: "hint" }, `In “${part.name}”.`), h("div", { class: "tools" },
    h("button", { onclick: () => { const to = move(list, i, -1); changed(); select("block", p, to); }, disabled: i === 0 }, "Move up"),
    h("button", { onclick: () => { const to = move(list, i, 1); changed(); select("block", p, to); }, disabled: i === list.length - 1 }, "Move down"),
    h("button", { class: "danger", onclick: () => { list.splice(i, 1); pruneImages(doc); changed(); select(list.length ? "block" : "part", p, Math.min(i, list.length - 1)); } }, "Remove")));

  if (block.type === "section") {
    form.append(...textField("Title", block.text, (v) => (block.text = v), "Gathering"));
  } else if (block.type === "heading") {
    form.append(...textField("Heading", block.text, (v) => (block.text = v), "Prayer of the Day"),
      checkbox("Mark with * (people stand, as they are able)", block.stand, (v) => (block.stand = v)),
      ...textField("Words at the right of the line (optional)", block.ref, (v) => (block.ref = v || undefined), "Isaiah 25:1-9"),
      ...textField("Italic title in the middle of the line (optional)", block.title, (v) => (block.title = v || undefined), "Thine the Amen"));
  } else if (block.type === "hymn") {
    form.append(...textField("Hymn title", block.title, (v) => (block.title = v)),
      ...textField("Number", block.number, (v) => (block.number = v), "ELW 523"));
  } else if (block.type === "image") {
    pictureField(form, "Picture or music", () => block.src, (v) => (block.src = v));
    const align = h("select", {}, ...[["", "Centre"], ["left", "Left"], ["right", "Right"]].map(([v, t]) => h("option", { value: v, selected: (block.align || "") === v }, t)));
    align.addEventListener("change", () => { block.align = align.value || undefined; changed(false); });
    const width = h("input", { type: "number", min: 10, max: 100, step: 5, value: parseInt(block.width || "100", 10) });
    width.addEventListener("input", () => { const v = parseInt(width.value, 10); block.width = v >= 10 && v < 100 ? `${v}%` : undefined; changed(false); });
    form.append(h("label", {}, "Position"), align, h("label", {}, "Width (percent of the column)"), width,
      checkbox("May continue on the next page (for music; it only breaks between lines of music)", block.split !== false, (v) => (block.split = v ? undefined : false)));
  } else if (block.type === "pagebreak") {
    form.append(h("p", { class: "hint" }, "What follows starts at the top of a new page."));
  } else if (block.type === "rule") {
    form.append(h("p", { class: "hint" }, "A line across the page, for separating announcements."),
      checkbox("Dotted line", !!block.dotted, (v) => (block.dotted = v || undefined)));
  } else if (block.type === "roster") {
    form.append(...textField("Title (optional)", block.title, (v) => (block.title = v), "Serving in the Liturgy"),
      h("label", {}, "Rows: what is on the left, and what is on the right"));
    block.rows.forEach((row, r) => {
      const left = h("input", { type: "text", value: row.left || "", placeholder: "Role" });
      const right = h("input", { type: "text", value: row.right || "", placeholder: "Name" });
      left.addEventListener("input", () => { row.left = left.value; changed(false); });
      right.addEventListener("input", () => { row.right = right.value; changed(false); });
      form.append(h("div", { class: "pair" }, left, right,
        h("button", { class: "small danger", title: "Remove this row", onclick: () => { block.rows.splice(r, 1); changed(); drawForm(); } }, "✕")));
    });
    form.append(h("div", { class: "tools" }, h("button", { onclick: () => { block.rows.push({ left: "", right: "" }); changed(); drawForm(); } }, "Add a row")));
  } else if (block.type === "columns") {
    form.append(...columnsEditor(block));
    pictureField(form, "Small picture under the last column (optional)", () => block.picture, (v) => { if (v) block.picture = v; else delete block.picture; });
  } else if (block.type === "logos") {
    block.images = block.images || [];
    const rowEl = h("div", { class: "logos" }, ...block.images.map((ref, k) => h("span", { class: "logo" }, h("img", { src: imageUrl(ref), alt: "" }),
      h("button", { class: "small danger", title: "Remove this picture", onclick: () => { block.images.splice(k, 1); pruneImages(doc); changed(); drawForm(); } }, "✕"))));
    form.append(h("label", {}, "Pictures, side by side"), rowEl, h("div", { class: "tools" },
      h("button", { onclick: async () => { const d = await pickImage(); if (d) { block.images.push(addImage(doc, d)); changed(); drawForm(); } } }, "Add a picture…")));
  } else {
    form.append(h("label", {}, "Text"), rich(block.html, (v) => (block.html = v)),
      h("p", { class: "hint" }, "Bold is for words everyone says together. Italic is for instructions. Press Shift+Enter for a new line; leave a blank line for a new paragraph."),
      checkbox("Centred", block.align === "center", (v) => { if (v) block.align = "center"; else delete block.align; }));
    pictureField(form, "Picture set into this text (optional)", () => block.float, (v) => { if (v) block.float = v; else { delete block.float; delete block.floatSide; delete block.floatWidth; } });
    if (block.float) {
      const side = h("select", {}, ...[["", "On the right"], ["left", "On the left"]].map(([v, t]) => h("option", { value: v, selected: (block.floatSide || "") === v }, t)));
      side.addEventListener("change", () => { if (side.value) block.floatSide = side.value; else delete block.floatSide; changed(false); });
      const fw = h("input", { type: "number", min: 8, max: 60, step: 1, value: parseInt(block.floatWidth || "34", 10) });
      fw.addEventListener("input", () => { const v = parseInt(fw.value, 10); if (v >= 8 && v <= 60) { block.floatWidth = `${v}%`; changed(false); } });
      form.append(h("label", {}, "Where the picture sits"), side, h("label", {}, "Its width (percent of the column)"), fw);
    }
  }

  if (FONT_KINDS[block.type]) {
    const everywhere = h("button", { title: `Use this font for all ${FONT_KINDS[block.type]} in the bulletin` }, `Use for all ${FONT_KINDS[block.type]}`);
    everywhere.addEventListener("click", () => {
      const font = block.font || "";
      if (font) doc.style.fonts[block.type] = font; else delete doc.style.fonts[block.type];
      for (const pt of doc.parts) for (const b of pt.blocks) if (b.type === block.type) delete b.font;     // they all follow the kind now
      changed(); drawForm();
      notice = font ? `All ${FONT_KINDS[block.type]} now use ${font}.` : `All ${FONT_KINDS[block.type]} now use the bulletin's font.`;
      showStatus();
    });
    form.append(...fontField("Font for this item (optional)", () => block.font, (v) => { if (v) block.font = v; else delete block.font; },
      doc.style.fonts[block.type] || doc.style.font, everywhere));
    if (["text", "columns", "roster"].includes(block.type)) {
      const size = h("input", { type: "number", min: 5, max: 60, step: 0.5, value: block.size || "", placeholder: String(part.size) });
      size.addEventListener("input", () => { const v = parseFloat(size.value); if (v >= 5 && v <= 60) block.size = v; else delete block.size; changed(false); });
      form.append(h("label", {}, "Text size for this item, in points (optional)"), size,
        h("p", { class: "hint" }, `Leave this empty to use the size of “${part.name}”, which is ${part.size} points.`));
    }
  }

  if (block.type !== "pagebreak") {
    if (part.side) {
      form.append(h("label", {}, "Side note (optional)"),
        rich(block.note, (v) => { if (v) block.note = v; else delete block.note; }, { note: true }),
        h("p", { class: "hint" }, "Printed in the grey column beside this item, wherever it lands on the page."));
      pictureField(form, "Picture under the side note (optional)", () => block.noteImage, (v) => { if (v) block.noteImage = v; else delete block.noteImage; });
    } else {
      form.append(h("p", { class: "hint" }, "Side notes need the grey side column. To use them here, select "),
        h("div", { class: "tools" }, h("button", { onclick: () => select("part", p) }, `“${part.name}” settings…`)));
    }
  }
  form.append(addBar(p, i));
}

// ---------------------------------------------------------------- preview

let timer = 0;
let running = false;
let again = false;

function schedulePreview() {
  clearTimeout(timer);
  timer = setTimeout(updatePreview, 350);
}

async function updatePreview() {
  if (fitting) return;                         // the pages are being measured at other sizes
  if (running) { again = true; return; }
  running = true;
  try {
    report = await layoutBulletin(doc, $("pages"));
    const shown = $("shown");
    const keep = $("preview").scrollTop;
    shown.replaceChildren(...[...$("pages").children].map((p) => p.cloneNode(true)));
    // the bulletin's font and note size are set on the true-size pages; the preview needs them too
    for (const name of ["--serif", "--note-size"]) shown.style.setProperty(name, $("pages").style.getPropertyValue(name));
    $("preview").scrollTop = keep;
    highlight(false);
    problem = "";
  } catch (e) {
    problem = `The pages could not be laid out: ${e.message}`;
  }
  running = false;
  showStatus();
  if (again) { again = false; updatePreview(); }
}

function highlight(scroll) {
  const shown = $("shown");
  shown.querySelectorAll(".on").forEach((e) => e.classList.remove("on"));
  const { kind, p, i } = selected;
  const hits = kind === "block" ? shown.querySelectorAll(`[data-part="${p}"][data-index="${i}"]`)
    : kind === "part" ? shown.querySelectorAll(`.page[data-part="${p}"]`)
    : kind === "cover" ? shown.querySelectorAll('.page[data-part="cover"]') : [];
  hits.forEach((e) => e.classList.add("on"));
  if (scroll && hits[0]) hits[0].scrollIntoView({ block: "center", behavior: "smooth" });
}

$("shown").addEventListener("click", (e) => {
  const block = e.target.closest("[data-index]");
  if (block) return select("block", Number(block.dataset.part), Number(block.dataset.index), true);
  // a click on the empty paper of a page chooses nothing, so the view never jumps
  if (e.target.closest('.page[data-part="cover"]')) select("cover", 0, 0, true);
});

function showStatus() {
  const status = $("status");
  $("extra").textContent = String(doc.extraSheets);
  $("fewer").disabled = doc.extraSheets <= 0;
  document.title = `${dirty ? "● " : ""}${fileName || "New bulletin"} — Grammateus`;
  if (problem) { status.className = "warn"; status.textContent = problem; return; }
  status.className = "";
  if (!report) { status.textContent = "Laying out the pages…"; return; }
  const parts = [report.wholeSheets ? `${report.pages} pages on ${report.sheets} ${report.sheets === 1 ? "sheet" : "sheets"}`
                                    : `${report.pages} pages (the printer will add blank pages to fill ${report.sheets} sheets)`];
  if (report.blankPages) parts.push(`${report.blankPages} blank ${report.blankPages === 1 ? "page" : "pages"}${doc.parts.some((x) => x.last) ? " before the back cover" : " at the end"}`);
  if (report.crowdedSides.length) { status.className = "warn"; parts.push(`too many side notes on page ${report.crowdedSides.join(", ")}`); }
  parts.push(dirty ? "not saved" : "saved");
  status.textContent = (notice ? `${notice} ` : "") + parts.join(" · ");
}

// ---------------------------------------------------------------- files

function load(text, name) {
  doc = normalize(JSON.parse(text));
  fileName = name || "";
  dirty = false;
  report = null;
  resetHistory();
  select("cover");
  updatePreview();
}

function serialise() {
  return JSON.stringify(pruneImages(doc));
}

async function confirmDiscard() {
  return !dirty || confirm("This bulletin has changes that are not saved. Continue and lose them?");
}

async function openFile() {
  if (!(await confirmDiscard())) return;
  if (desk) {
    const got = await desk.open();
    if (got) load(got.text, got.name);
    return;
  }
  const input = $("pickfile");
  input.value = "";
  input.onchange = async () => { const f = input.files[0]; if (f) load(await f.text(), f.name); };
  input.click();
}

async function saveFile(asNew) {
  try {
    if (desk) {
      const name = await desk.save(serialise(), asNew || !fileName, suggestedName());
      if (!name) return;
      fileName = name;
    } else {
      const a = h("a", { href: URL.createObjectURL(new Blob([serialise()], { type: "application/json" })), download: fileName || suggestedName() });
      a.click();
      fileName = a.download;
    }
    dirty = false;
    problem = "";
    notice = `Saved as ${fileName}.`;
  } catch (e) {
    problem = `The bulletin could not be saved: ${e.message}`;
  }
  showStatus();
}

// ---------------------------------------------------------------- importing a finished PDF

// The PDF is read and turned into a bulletin in one go. The program decides for itself which
// pages are the service; everything it makes can be changed afterwards.

async function importPdf() {
  if (!(await confirmDiscard())) return;
  const input = $("pickpdf");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      await busy("Opening the PDF…", 0);
      const { inspectPdf, buildBulletin } = await import("./import_pdf.js");
      const found = await inspectPdf(new Uint8Array(await file.arrayBuffer()), busy);
      if (found.embedded) {
        load(JSON.stringify(found.embedded), "");
        dirty = true;
        problem = "";
        notice = `${file.name} was made by Grammateus, so the bulletin stored inside it was opened.`;
        showStatus();
        return;
      }
      await busy("Rebuilding the bulletin…", 0.6);
      const made = await buildBulletin(found, found.first, found.last, busy);
      load(JSON.stringify(made), "");
      await busy("Laying out the pages…", 1);
      await updatePreview();
      dirty = true;                             // it exists only on screen until it is saved
      problem = "";
      notice = `Imported all ${found.count} pages of ${file.name}. Look it over, then save it.`;
      showStatus();
    } catch (e) {
      problem = `The PDF could not be imported: ${e.message}`;
      showStatus();
    } finally {
      idle();
    }
  };
  input.click();
}

// ---------------------------------------------------------------- enlarging the text to fill the sheets
//
// Experimental. A bulletin is printed on whole sheets, so there is often room to spare on the
// last one. This finds the largest text at which the bulletin still fits on the sheets it
// already needs, by trying sizes and laying the pages out each time. Pictures are not changed.

let fitting = false;

async function fitToSheets() {
  if (fitting) return;
  fitting = true;
  commitSnapshot();
  const original = { parts: doc.parts.map((p) => p.size), note: doc.style.noteSize, items: doc.parts.map((p) => p.blocks.map((b) => b.size)) };
  const quarter = (v) => Math.round(v * 4) / 4;
  const apply = (k) => {
    doc.parts.forEach((p, i) => { p.size = quarter(original.parts[i] * k); p.blocks.forEach((b, j) => { if (original.items[i][j]) b.size = quarter(original.items[i][j] * k); }); });
    doc.style.noteSize = quarter(original.note * k);
  };
  const measure = async () => {                 // pages of content, with no blank pages added
    const kept = [doc.wholeSheets, doc.extraSheets];
    doc.wholeSheets = false; doc.extraSheets = 0;
    try { return (await layoutBulletin(doc, $("pages"))).pages; } finally { [doc.wholeSheets, doc.extraSheets] = kept; }
  };
  try {
    await busy("Measuring the bulletin as it is…", 0);
    const now = await measure();
    const target = Math.ceil(now / 4) * 4;
    let lo = 1, hi = 1.6;
    const steps = 8;
    for (let step = 0; step < steps; step++) {
      const mid = (lo + hi) / 2;
      await busy(`Trying the text ${Math.round((mid - 1) * 100)}% larger…`, (step + 1) / (steps + 2));
      apply(mid);
      if ((await measure()) <= target) lo = mid; else hi = mid;
    }
    await busy("Checking the result…", (steps + 1) / (steps + 2));
    let k = lo;
    apply(k);
    while (k > 1 && (await measure()) > target) { k = Math.max(1, k - 0.01); apply(k); }     // sizes are rounded, so make sure
    const grew = doc.parts.some((p, i) => p.size > original.parts[i]);
    if (!grew) apply(1);
    dirty = dirty || grew;
    const main = doc.parts.findIndex((p) => p.side);
    const shown = main >= 0 ? main : 0;
    notice = grew
      ? `Text enlarged to fill ${target / 4} ${target === 4 ? "sheet" : "sheets"}: ${original.parts[shown]} → ${doc.parts[shown].size} points in “${doc.parts[shown].name}”. Undo puts it back.`
      : "The text already fills its sheets; nothing was changed.";
    problem = "";
    if (grew) scheduleSnapshot();
    drawForm();
  } catch (e) {
    apply(1);
    problem = `The text could not be enlarged: ${e.message}`;
  } finally {
    fitting = false;
    idle();
    await updatePreview();
    showStatus();
  }
}

function suggestedName() {
  const base = [doc.meta.sunday, doc.meta.date].filter(Boolean).join(" ").replace(/[^\w ,-]+/g, "").trim();
  return `${base || "bulletin"}.bulletin`;
}

async function makePdf() {
  await updatePreview();
  if (problem) return;
  try {
    if (desk) {
      const where = await desk.pdf(suggestedName().replace(/\.bulletin$/, ".pdf"), serialise());
      if (where) { problem = ""; notice = `PDF saved: ${where}.`; showStatus(); }
    } else {
      window.print();
    }
  } catch (e) {
    problem = `The PDF could not be made: ${e.message}`;
    showStatus();
  }
}

// A new bulletin starts from the example that comes with the program, so there is always
// something to see and change. It has no file name until it is saved.
async function startNew() {
  try {
    load(await (await fetch(new URL("../../examples/example.bulletin", import.meta.url))).text(), "");
  } catch {
    doc = emptyBulletin(); fileName = ""; dirty = false; report = null; resetHistory(); select("cover"); updatePreview();
  }
}

$("new").addEventListener("click", async () => { if (await confirmDiscard()) startNew(); });
$("open").addEventListener("click", openFile);
$("import").addEventListener("click", importPdf);
$("save").addEventListener("click", () => saveFile(false));
$("saveas").addEventListener("click", () => saveFile(true));
$("pdf").addEventListener("click", makePdf);
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
function showOutline(on) {
  document.querySelector("main").classList.toggle("no-outline", !on);
  $("toggle").setAttribute("aria-pressed", String(on));
  try { localStorage.setItem("outline", on ? "shown" : "hidden"); } catch { /* remembering it is optional */ }
}
$("toggle").addEventListener("click", () => showOutline($("toggle").getAttribute("aria-pressed") !== "true"));
try { if (localStorage.getItem("outline") === "hidden") showOutline(false); } catch { /* first run */ }
$("more").addEventListener("click", () => { doc.extraSheets++; changed(false); });
$("fewer").addEventListener("click", () => { if (doc.extraSheets > 0) { doc.extraSheets--; changed(false); } });
window.addEventListener("beforeunload", (e) => { if (dirty && !desk) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(e.shiftKey); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); openFile(); }
  // Inside a text box the browser's own undo handles typing; anywhere else, undo the last change.
  const typing = e.target.closest && e.target.closest("input, textarea, [contenteditable]");
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
});
// news of a newer version stays in the top bar until the program is closed
if (desk?.onUpdate) {
  desk.onUpdate((text) => { $("updatetext").textContent = text; $("update").hidden = !text; $("installnow").hidden = !/is ready/.test(text); });
  $("installnow").addEventListener("click", () => desk.install());
}
if (desk) desk.onMenu((what) => ({ new: () => $("new").click(), open: openFile, import: importPdf, save: () => saveFile(false), saveas: () => saveFile(true), pdf: makePdf, fit: fitToSheets }[what]?.()));

// For tests and for the desktop program's "is it safe to close" question.
window.grammateus = { load, serialise, isDirty: () => dirty, report: () => report, select, undo, redo, fitToSheets };

// Start with the file the program was opened with, or the one named in the address (used in
// development and tests), or else a new bulletin.
const start = new URLSearchParams(location.search).get("doc");
const initial = desk ? await desk.initial().catch(() => null) : null;
if (initial) load(initial.text, initial.name);
else if (start) fetch(start).then((r) => r.text()).then((t) => load(t, start.split("/").pop())).catch((e) => { problem = `Could not open ${start}: ${e.message}`; showStatus(); });
else startNew();
