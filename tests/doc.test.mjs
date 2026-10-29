import test from "node:test";
import assert from "node:assert/strict";
import { addImage, canJoin, emptyBulletin, joinRuns, joinText, move, newBlock, newPart, normalize, placeLast, pruneImages, summary } from "../src/app/doc.js";

test("an empty bulletin has every piece the program relies on", () => {
  const doc = emptyBulletin();
  for (const key of ["meta", "cover", "parts", "images", "style"]) assert.ok(key in doc, key);
  assert.equal(doc.extraSheets, 0);
  assert.equal(doc.style.font, "EB Garamond");
  assert.deepEqual(doc.parts.map((p) => p.name), ["Welcome page", "The service", "Extra pages", "Back page"]);
  assert.equal(doc.cover.show, true);
});

test("a bulletin saved by the first version is turned into parts without losing anything", () => {
  const doc = normalize({
    style: { font: "Georgia", bodySize: 14, noteSize: 11, extraSize: 13 },
    welcomeLogo: "img:logo",
    welcome: [{ html: "Welcome", align: "center" }, { html: "Second" }],
    service: [{ type: "heading", text: "Greeting", note: "A note" }],
    extras: [{ type: "roster", rows: [] }],
    back: [{ html: "Back" }, { columns: ["a", "b"] }, { logos: ["img:x", "img:y"] }],
    extraSheets: -3,
  });
  const [welcome, service, extras, back] = doc.parts;
  assert.deepEqual(welcome.blocks[0], { type: "text", html: "Welcome", align: "center", float: "img:logo", floatSide: "left", floatWidth: "15%" });
  assert.equal(service.side, true);
  assert.equal(service.size, 14);
  assert.equal(service.blocks[0].note, "A note");
  assert.equal(extras.size, 13);
  assert.equal(extras.side, false);
  assert.deepEqual(back.blocks.map((b) => b.type), ["text", "columns", "logos"]);
  assert.deepEqual(back.blocks[2].images, ["img:x", "img:y"]);
  assert.equal(back.last, true);
  assert.equal(doc.style.font, "Georgia");
  assert.equal(doc.style.sizes.note, 11);
  assert.equal(doc.style.size, 14);                       // the service's size became the default
  assert.equal(doc.extraSheets, 0);
  assert.ok(!("service" in doc) && !("welcome" in doc));
});

test("parts without a size of their own use the bulletin's default size", () => {
  const doc = normalize({ style: { size: 16 }, parts: [{ name: "A", size: 13 }, { name: "B" }] });
  assert.equal(doc.style.size, 16);
  assert.equal(doc.parts[0].size, 13);
  assert.ok(!("size" in doc.parts[1]));
  assert.ok(!("note" in doc.style.sizes));                 // side notes keep their usual size
});

test("only one part is last, and it is kept at the end", () => {
  const doc = emptyBulletin();
  const added = newPart("Insert");
  doc.parts.push(added);
  normalize(doc);
  assert.equal(doc.parts.at(-1).name, "Back page");
  added.last = true;
  placeLast(doc, added);
  assert.equal(doc.parts.at(-1), added);
  assert.equal(doc.parts.filter((p) => p.last).length, 1);
});

test("moving an item past either end leaves it where it is", () => {
  const list = ["a", "b", "c"];
  assert.equal(move(list, 0, -1), 0);
  assert.equal(move(list, 2, 1), 2);
  assert.equal(move(list, 0, 1), 1);
  assert.deepEqual(list, ["b", "a", "c"]);
});

test("the outline describes each kind of item", () => {
  assert.equal(summary({ type: "heading", text: "Greeting", stand: true }), "*Greeting");
  assert.equal(summary({ type: "hymn", title: "Amazing Grace", number: "ELW 779" }), "Amazing Grace ELW 779");
  assert.equal(summary({ type: "text", html: "<b>Amen.</b><br>Next" }), "Amen. Next");
  assert.equal(summary({ type: "text", html: "Language &amp; Imagery" }), "Language & Imagery");
  assert.equal(summary(newBlock("text")), "(empty text)");
  assert.equal(summary(newBlock("logos")), "Row of pictures");
});

test("pictures no longer used are dropped when saving; used ones are kept wherever they are", () => {
  const doc = emptyBulletin();
  const refs = ["A", "B", "C", "D", "E", "F"].map((x) => addImage(doc, "data:image/png;base64," + x.repeat(4)));
  const [src, dropped, noteImage, float, picture, logo] = refs;
  doc.parts[1].blocks.push({ type: "image", src }, { type: "heading", text: "Offering", noteImage });
  doc.parts[0].blocks.push({ type: "text", html: "x", float });
  doc.parts[2].blocks.push({ type: "columns", columns: ["a", "b"], picture });
  doc.parts[3].blocks.push({ type: "logos", images: [logo] });
  pruneImages(doc);
  assert.deepEqual(Object.keys(doc.images).sort(), [src, noteImage, float, picture, logo].map((r) => r.slice(4)).sort());
  assert.ok(!(dropped.slice(4) in doc.images));
});

test("the paragraphs of a reading join into one text item, and what would be lost stays apart", () => {
  const t = (html, more = {}) => ({ type: "text", html, ...more });
  const joined = joinRuns([
    { type: "heading", text: "First Reading" },
    t("<sup>9</sup>After this I looked", { note: "About Revelation" }),
    t("<sup>13</sup>Then one of the elders"),
    t("Word of God, word of life.<br><b>Thanks be to God.</b>"),
    t("A paragraph with its own note", { note: "beside it" }),
    t("Centred", { align: "center" }),
    t("Smaller", { size: 11 }),
    t("<b>A title</b>"),
    t("After the title"),
  ]);
  assert.deepEqual(joined.map((b) => b.type === "text" ? b.html.slice(0, 14) : b.type),
    ["heading", "<sup>9</sup>Af", "A paragraph wi", "Centred", "Smaller", "<b>A title</b>", "After the titl"]);
  assert.equal(joined[1].html, "<sup>9</sup>After this I looked<br><br><sup>13</sup>Then one of the elders<br><br>Word of God, word of life.<br><b>Thanks be to God.</b>");
  assert.equal(joined[1].note, "About Revelation", "the first paragraph's note stays with it");
  assert.equal(canJoin(t("a", { float: "img:x" }), t("b")), true, "a picture in the first is kept where it is");
  assert.equal(canJoin(t("a"), t("b", { float: "img:x" })), false, "a picture in the second would move");
  assert.equal(canJoin(t("a", { align: "left" }), t("b")), true, "left is the same as no alignment");
});

test("joining by hand keeps the second item's side note and picture", () => {
  const a = { type: "text", html: "one", note: "first" };
  joinText(a, { type: "text", html: "two", note: "second", float: "img:p", floatWidth: "30%" });
  assert.deepEqual(a, { type: "text", html: "one<br><br>two", note: "first<br><br>second", float: "img:p", floatSide: undefined, floatWidth: "30%" });
});
