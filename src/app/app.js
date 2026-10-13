// The editing screen: an outline of the bulletin on the left, a form for the selected part
// in the middle, and a live preview of the pages on the right.

import { layoutBulletin } from "../renderer/layout.js";
import { BLOCK_NAMES, addImage, cleanHtml, emptyBulletin, move, newBlock, normalize, pruneImages, summary } from "./doc.js";

const $ = (id) => document.getElementById(id);
const desk = window.desk || null;            // provided by the desktop program; absent in a plain browser

let doc = emptyBulletin();
let selected = { part: "cover", index: 0 };
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
  const list = doc[selected.part];
  if (Array.isArray(list) && (selected.part === "service" || selected.part === "extras")) {
    selected.index = Math.min(selected.index, list.length - 1);
  }
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

function textField(label, value, set, placeholder = "") {
  const input = h("input", { type: "text", value: value || "", placeholder });
  input.addEventListener("input", () => { set(input.value); changed(); });
  return [h("label", {}, label), input];
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
  const smallCaps = () => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const text = sel.toString().replace(/[<>&]/g, "");
    document.execCommand("insertHTML", false, `<span class="sc">${text}</span>`);
  };
  const bar = h("div", { class: "fmt" },
    fmt("B", "Bold: words everyone says together", () => document.execCommand("bold")),
    fmt("I", "Italic: instructions and titles", () => document.execCommand("italic")),
    fmt("Sᴄ", "Small capitals", smallCaps),
    fmt("x²", "Raised, for verse numbers", () => document.execCommand("superscript")),
    fmt("Plain", "Remove formatting from the selected words", () => document.execCommand("removeFormat")));
  return h("div", { class: note ? "rich note" : "rich" }, bar, box);
}

// ---------------------------------------------------------------- outline

const PARTS = [["cover", "Cover"], ["welcome", "Welcome page"], ["service", "The service"],
               ["extras", "Extra pages"], ["back", "Back page"], ["design", "Design"]];

function select(part, index = 0) {
  selected = { part, index };
  drawOutline();
  drawForm();
  highlight(true);
}

function drawOutline() {
  const nav = $("outline");
  const keep = nav.scrollTop;
  nav.replaceChildren();
  const row = (cls, label, part, index, tag) => {
    const on = selected.part === part && (index === undefined || selected.index === index);
    const b = h("button", { class: `row ${cls}${on ? " on" : ""}`, onclick: () => select(part, index ?? 0) }, label);
    if (tag) b.append(h("span", { class: "tag" }, tag));
    nav.append(b);
  };
  for (const [part, label] of PARTS) {
    if (part === "service" || part === "extras") {
      nav.append(h("h2", {}, label));
      const list = doc[part];
      if (!list.length) row("part", part === "service" ? "Add the first part…" : "Add an extra page…", part, -1);
      list.forEach((b, i) => row(b.type, summary(b), part, i, b.note ? "note" : ""));
    } else {
      row("part", label, part);
    }
  }
  nav.scrollTop = keep;
}

// ---------------------------------------------------------------- forms

function drawForm() {
  const form = $("form");
  form.replaceChildren();
  const { part, index } = selected;
  if (part === "cover") return coverForm(form);
  if (part === "welcome") return paragraphsForm(form, "Welcome page", "The inside front page. It usually stays the same from week to week.", "welcome", true);
  if (part === "back") return paragraphsForm(form, "Back page", "The back cover. It is always the last page.", "back", false);
  if (part === "design") return designForm(form);
  return blockForm(form, part, index);
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
    ...textField("Title", doc.meta.title, (v) => (doc.meta.title = v), "Liturgy of Holy Communion"),
    ...textField("Sunday or occasion", doc.meta.sunday, (v) => (doc.meta.sunday = v), "Twentieth Sunday after Pentecost"),
    ...textField("Date", doc.meta.date, (v) => (doc.meta.date = v), "October 11, 2026"),
    ...textField("Church name and place (use | between lines)", (doc.cover.footer || []).join(" | "),
      (v) => (doc.cover.footer = v.split("|").map((s) => s.trim()).filter(Boolean))));
  pictureField(form, "Cover picture", () => doc.cover.image, (v) => (doc.cover.image = v));
}

function designForm(form) {
  const fonts = ["EB Garamond", "Garamond", "Georgia", "Times New Roman", "Cambria", "Palatino Linotype", "Book Antiqua", "Calibri", "Arial"];
  const list = h("datalist", { id: "fonts" }, ...fonts.map((f) => h("option", { value: f })));
  const font = h("input", { type: "text", value: doc.style.font, list: "fonts" });
  font.addEventListener("input", () => { doc.style.font = font.value.trim() || "EB Garamond"; changed(false); });
  const size = (label, key, min, max) => {
    const input = h("input", { type: "number", value: doc.style[key], min, max, step: "0.5" });
    input.addEventListener("input", () => { const v = parseFloat(input.value); if (v >= min && v <= max) { doc.style[key] = v; changed(false); } });
    return [h("label", {}, label), input];
  };
  form.append(h("h1", {}, "Design"),
    h("p", { class: "hint" }, "These apply to the whole bulletin. EB Garamond comes with the program, so it looks the same on every computer. " +
      "Any other font must be installed on the computer that makes the PDF."),
    h("label", {}, "Font"), font, list,
    ...size("Size of the main text (points)", "bodySize", 9, 20),
    ...size("Size of the side notes (points)", "noteSize", 7, 16),
    ...size("Size of the text on extra pages (points)", "extraSize", 8, 18));
}

function paragraphsForm(form, title, hint, key, hasLogo) {
  form.append(h("h1", {}, title), h("p", { class: "hint" }, hint));
  if (hasLogo) pictureField(form, "Small picture at the top left", () => doc.welcomeLogo, (v) => (doc.welcomeLogo = v));
  const list = doc[key];
  list.forEach((item, i) => {
    const tools = h("div", { class: "itemtools" },
      h("button", { class: "small", onclick: () => { move(list, i, -1); changed(); drawForm(); }, disabled: i === 0 }, "↑"),
      h("button", { class: "small", onclick: () => { move(list, i, 1); changed(); drawForm(); }, disabled: i === list.length - 1 }, "↓"),
      h("button", { class: "small danger", onclick: () => { list.splice(i, 1); changed(); drawForm(); } }, "Remove"));
    if (item.columns) {
      form.append(h("div", { class: "item" }, ...columnsEditor(item, drawForm), tools));
    } else if (item.logos) {
      const row = h("div", { class: "logos" }, ...item.logos.map((ref) => h("img", { src: imageUrl(ref), alt: "" })));
      tools.prepend(h("button", { class: "small", onclick: async () => { const d = await pickImage(); if (d) { item.logos.push(addImage(doc, d)); changed(); drawForm(); } } }, "Add a logo…"));
      form.append(h("div", { class: "item" }, h("label", {}, "Row of logos"), row, tools));
    } else {
      const centre = h("input", { type: "checkbox" });
      centre.checked = item.align === "center";
      centre.addEventListener("change", () => { item.align = centre.checked ? "center" : "left"; changed(); });
      tools.prepend(h("label", { class: "check" }, centre, "Centred"));
      form.append(h("div", { class: "item" }, rich(item.html, (v) => (item.html = v)), tools));
    }
  });
  form.append(h("div", { class: "add" }, h("span", {}, "Add:"),
    h("button", { onclick: () => { list.push({ html: "", align: "left" }); changed(); drawForm(); } }, "Paragraph"),
    h("button", { onclick: () => { list.push({ columns: ["", ""] }); changed(); drawForm(); } }, "Columns"),
    h("button", { onclick: () => { list.push({ logos: [] }); changed(); drawForm(); } }, "Row of logos")));
}

// Two to four boxes of formatted text side by side.
function columnsEditor(owner, redraw) {
  const count = h("select", {}, ...[2, 3, 4].map((n) => h("option", { value: n, selected: owner.columns.length === n }, `${n} columns`)));
  count.addEventListener("change", () => {
    const n = Number(count.value);
    while (owner.columns.length < n) owner.columns.push("");
    if (owner.columns.length > n) owner.columns = [...owner.columns.slice(0, n - 1), owner.columns.slice(n - 1).filter(Boolean).join("<br>")];
    changed(); redraw();
  });
  return [h("label", {}, "Columns"), count,
    ...owner.columns.map((html, i) => h("div", { class: "item" }, rich(html, (v) => (owner.columns[i] = v))))];
}

function addBar(part, at) {
  const types = part === "extras" ? ["heading", "text", "roster", "columns", "image", "rule", "pagebreak"]
                                  : ["section", "heading", "text", "hymn", "image"];
  return h("div", { class: "add" }, h("span", {}, at < 0 ? "Add:" : "Add after this:"),
    ...types.map((t) => h("button", { onclick: () => { doc[part].splice(at + 1, 0, newBlock(t)); changed(); select(part, at + 1); } }, BLOCK_NAMES[t])));
}

function blockForm(form, part, index) {
  const list = doc[part];
  const block = list[index];
  if (!block) {
    form.append(h("h1", {}, part === "service" ? "The service" : "Extra pages"),
      h("p", { class: "hint" }, part === "service"
        ? "The service is a list of parts in order. Add the first one below."
        : "Pages after the service, for announcements, a prayer list and the like. They use the full width of the page."),
      addBar(part, -1));
    return;
  }
  form.append(h("h1", {}, BLOCK_NAMES[block.type]), h("div", { class: "tools" },
    h("button", { onclick: () => select(part, move(list, index, -1)), disabled: index === 0 }, "Move up"),
    h("button", { onclick: () => select(part, move(list, index, 1)), disabled: index === list.length - 1 }, "Move down"),
    h("button", { class: "danger", onclick: () => { list.splice(index, 1); pruneImages(doc); changed(); select(part, Math.min(index, list.length - 1)); } }, "Remove")));
  form.querySelectorAll(".tools button").forEach((b) => b.addEventListener("click", () => changed()));

  if (block.type === "section") {
    form.append(...textField("Title", block.text, (v) => (block.text = v), "Gathering"));
  } else if (block.type === "heading") {
    const stand = h("input", { type: "checkbox" });
    stand.checked = !!block.stand;
    stand.addEventListener("change", () => { block.stand = stand.checked; changed(); });
    form.append(...textField("Heading", block.text, (v) => (block.text = v), "Prayer of the Day"),
      h("label", { class: "check" }, stand, "Mark with * (people stand, as they are able)"),
      ...textField("Words at the right of the line (optional)", block.ref, (v) => (block.ref = v || undefined), "Isaiah 25:1-9"),
      ...textField("Italic title in the middle of the line (optional)", block.title, (v) => (block.title = v || undefined), "Thine the Amen"));
  } else if (block.type === "hymn") {
    form.append(...textField("Hymn title", block.title, (v) => (block.title = v)),
      ...textField("Number", block.number, (v) => (block.number = v), "ELW 523"));
  } else if (block.type === "image") {
    pictureField(form, "Picture or music", () => block.src, (v) => (block.src = v));
    const width = h("input", { type: "number", min: 10, max: 100, step: 5, value: parseInt(block.width || "100", 10) });
    width.addEventListener("input", () => { const v = parseInt(width.value, 10); block.width = v >= 10 && v < 100 ? `${v}%` : undefined; changed(false); });
    const split = h("input", { type: "checkbox" });
    split.checked = block.split !== false;
    split.addEventListener("change", () => { block.split = split.checked ? undefined : false; changed(false); });
    const align = h("select", {}, ...[["", "Centre"], ["left", "Left"], ["right", "Right"]].map(([v, t]) => h("option", { value: v, selected: (block.align || "") === v }, t)));
    align.addEventListener("change", () => { block.align = align.value || undefined; changed(false); });
    form.append(h("label", {}, "Position"), align);
    form.append(h("label", {}, "Width (percent of the column)"), width,
      h("label", { class: "check" }, split, "May continue on the next page (for music; it only breaks between lines of music)"));
  } else if (block.type === "pagebreak") {
    form.append(h("p", { class: "hint" }, "What follows starts at the top of a new page."));
  } else if (block.type === "rule") {
    form.append(h("p", { class: "hint" }, "A line across the page, for separating announcements."));
  } else if (block.type === "roster") {
    form.append(...textField("Title (optional)", block.title, (v) => (block.title = v), "Serving in the Liturgy"),
      h("label", {}, "Rows: what is on the left, and what is on the right"));
    block.rows.forEach((row, i) => {
      const left = h("input", { type: "text", value: row.left || "", placeholder: "Role" });
      const right = h("input", { type: "text", value: row.right || "", placeholder: "Name" });
      left.addEventListener("input", () => { row.left = left.value; changed(false); });
      right.addEventListener("input", () => { row.right = right.value; changed(false); });
      form.append(h("div", { class: "pair" }, left, right,
        h("button", { class: "small danger", title: "Remove this row", onclick: () => { block.rows.splice(i, 1); changed(); drawForm(); } }, "✕")));
    });
    form.append(h("div", { class: "tools" }, h("button", { onclick: () => { block.rows.push({ left: "", right: "" }); changed(); drawForm(); } }, "Add a row")));
  } else if (block.type === "columns") {
    form.append(...columnsEditor(block, drawForm));
    pictureField(form, "Small picture under the last column (optional)", () => block.picture, (v) => { if (v) block.picture = v; else delete block.picture; });
  } else {
    form.append(h("label", {}, "Text"), rich(block.html, (v) => (block.html = v)),
      h("p", { class: "hint" }, "Bold is for words everyone says together. Italic is for instructions. Press Shift+Enter for a new line."));
    if (part === "extras") {
      pictureField(form, "Picture set into the right of this text (optional)", () => block.float, (v) => { if (v) block.float = v; else delete block.float; });
    }
  }

  if (part === "service" && block.type !== "pagebreak") {
    form.append(h("label", {}, "Side note (optional)"),
      rich(block.note, (v) => { if (v) block.note = v; else delete block.note; }, { note: true }),
      h("p", { class: "hint" }, "Printed in the grey column beside this part, wherever it lands on the page."));
    pictureField(form, "Picture under the side note (optional)", () => block.noteImage, (v) => { if (v) block.noteImage = v; else delete block.noteImage; });
  }
  form.append(addBar(part, index));
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
  if (running) { again = true; return; }
  running = true;
  try {
    report = await layoutBulletin(doc, $("pages"));
    const shown = $("shown");
    const keep = $("preview").scrollTop;
    shown.replaceChildren(...[...$("pages").children].map((p) => p.cloneNode(true)));
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
  const { part, index } = selected;
  const kind = part === "extras" ? "extra" : part;
  const hits = part === "service" || part === "extras"
    ? shown.querySelectorAll(`[data-part="${kind}"][data-index="${index}"]`)
    : shown.querySelectorAll(`.page[data-part="${kind}"]`);
  hits.forEach((e) => e.classList.add("on"));
  if (scroll && hits[0]) hits[0].scrollIntoView({ block: "center", behavior: "smooth" });
}

$("shown").addEventListener("click", (e) => {
  const block = e.target.closest("[data-index]");
  if (block) return select(block.dataset.part === "extra" ? "extras" : "service", Number(block.dataset.index));
  const page = e.target.closest(".page[data-part]");
  if (page && ["cover", "welcome", "back"].includes(page.dataset.part)) select(page.dataset.part);
});

function showStatus() {
  const status = $("status");
  $("extra").textContent = String(doc.extraSheets);
  $("fewer").disabled = doc.extraSheets <= 0;
  document.title = `${dirty ? "● " : ""}${fileName || "New bulletin"} — Grammateus`;
  if (problem) { status.className = "warn"; status.textContent = problem; return; }
  status.className = "";
  if (!report) { status.textContent = "Laying out the pages…"; return; }
  const parts = [`${report.pages} pages on ${report.sheets} ${report.sheets === 1 ? "sheet" : "sheets"}`];
  if (report.blankPages) parts.push(`${report.blankPages} blank ${report.blankPages === 1 ? "page" : "pages"} before the back cover`);
  if (report.crowdedSides.length) { status.className = "warn"; parts.push(`too many side notes on page ${report.crowdedSides.map((p) => p - 1).join(", ")}`); }
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

let pending = null;                          // a PDF that has been read and awaits the page numbers

async function importPdf() {
  if (!(await confirmDiscard())) return;
  const input = $("pickpdf");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const say = (text) => { $("status").className = ""; $("status").textContent = text; };
    try {
      say("Opening the PDF…");
      const { inspectPdf } = await import("./import_pdf.js");
      const found = await inspectPdf(new Uint8Array(await file.arrayBuffer()), say);
      if (found.embedded) {
        load(JSON.stringify(found.embedded), "");
        dirty = true;
        problem = "";
        notice = `${file.name} was made by Grammateus, so the bulletin stored inside it was opened.`;
        showStatus();
        return;
      }
      pending = { name: file.name, ...found };
      problem = "";
      say(`${file.name}: ${pending.count} pages read. Check the page numbers, then press Import.`);
      importForm();
    } catch (e) {
      pending = null;
      problem = `The PDF could not be read: ${e.message}`;
      showStatus();
    }
  };
  input.click();
}

function importForm() {
  const form = $("form");
  form.replaceChildren();
  const number = (value) => h("input", { type: "number", min: 1, max: pending.count, value });
  const first = number(pending.first), last = number(pending.last);
  const go = h("button", { class: "primary" }, "Import");
  go.addEventListener("click", async () => {
    const a = parseInt(first.value, 10), b = parseInt(last.value, 10);
    if (!(a >= 1 && b >= a && b <= pending.count)) { problem = "The service pages must be in order and within the PDF."; showStatus(); return; }
    const say = (text) => { $("status").className = ""; $("status").textContent = text; };
    try {
      go.disabled = true;
      const { buildBulletin } = await import("./import_pdf.js");
      const made = buildBulletin(pending, a, b, say);
      const from = pending.name;
      pending = null;
      load(JSON.stringify(made), "");
      dirty = true;                             // it exists only on screen until it is saved
      problem = "";
      notice = `Imported from ${from}. Look it over, then save it.`;
      showStatus();
    } catch (e) {
      go.disabled = false;
      problem = `The PDF could not be imported: ${e.message}`;
      showStatus();
    }
  });
  form.append(h("h1", {}, "Import a bulletin PDF"),
    h("p", { class: "hint" }, `${pending.name} has ${pending.count} pages. The program works out the parts from where they sit on the page. ` +
      "Page 1 is taken as the cover, the page after it as the welcome page, and the last page as the back cover."),
    h("label", {}, "First page of the service"), first,
    h("label", {}, "Last page of the service"), last,
    h("p", { class: "hint" }, "Pages between the service and the back cover become extra pages. " +
      "Importing works best on bulletins laid out like this program's own: a main column with a side column of notes."),
    h("div", { class: "tools" }, go, h("button", { onclick: () => { pending = null; drawForm(); showStatus(); } }, "Cancel")));
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
if (desk) desk.onMenu((what) => ({ new: () => $("new").click(), open: openFile, import: importPdf, save: () => saveFile(false), saveas: () => saveFile(true), pdf: makePdf }[what]?.()));

// For tests and for the desktop program's "is it safe to close" question.
window.grammateus = { load, serialise, isDirty: () => dirty, report: () => report, select, undo, redo };

// Start with the file the program was opened with, or the one named in the address (used in
// development and tests), or else a new bulletin.
const start = new URLSearchParams(location.search).get("doc");
const initial = desk ? await desk.initial().catch(() => null) : null;
if (initial) load(initial.text, initial.name);
else if (start) fetch(start).then((r) => r.text()).then((t) => load(t, start.split("/").pop())).catch((e) => { problem = `Could not open ${start}: ${e.message}`; showStatus(); });
else startNew();
