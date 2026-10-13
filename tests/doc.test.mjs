import test from "node:test";
import assert from "node:assert/strict";
import { addImage, emptyBulletin, move, newBlock, newPart, normalize, placeLast, pruneImages, summary } from "../src/app/doc.js";

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
  assert.equal(doc.style.noteSize, 11);
  assert.equal(doc.extraSheets, 0);
  assert.ok(!("service" in doc) && !("welcome" in doc));
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
