import test from "node:test";
import assert from "node:assert/strict";
import { addImage, emptyBulletin, move, newBlock, normalize, pruneImages, summary } from "../src/app/doc.js";

test("an empty bulletin has every part the program relies on", () => {
  const doc = emptyBulletin();
  for (const key of ["meta", "cover", "welcome", "service", "extras", "back", "images", "style"]) assert.ok(key in doc, key);
  assert.equal(doc.extraSheets, 0);
  assert.equal(doc.style.font, "EB Garamond");
});

test("normalize keeps what is there and never allows fewer than zero extra sheets", () => {
  const doc = normalize({ meta: { title: "T" }, style: { font: "Georgia" }, extraSheets: -3 });
  assert.equal(doc.meta.title, "T");
  assert.equal(doc.style.font, "Georgia");
  assert.equal(doc.style.bodySize, 15);
  assert.equal(doc.extraSheets, 0);
});

test("moving a block past either end leaves it where it is", () => {
  const list = ["a", "b", "c"];
  assert.equal(move(list, 0, -1), 0);
  assert.equal(move(list, 2, 1), 2);
  assert.equal(move(list, 0, 1), 1);
  assert.deepEqual(list, ["b", "a", "c"]);
});

test("the outline describes each kind of block", () => {
  assert.equal(summary({ type: "heading", text: "Greeting", stand: true }), "*Greeting");
  assert.equal(summary({ type: "hymn", title: "Amazing Grace", number: "ELW 779" }), "Amazing Grace ELW 779");
  assert.equal(summary({ type: "text", html: "<b>Amen.</b><br>Next" }), "Amen. Next");
  assert.equal(summary(newBlock("text")), "(empty text)");
});

test("pictures no longer used are dropped when saving; used ones are kept", () => {
  const doc = emptyBulletin();
  const kept = addImage(doc, "data:image/png;base64,AAAA");
  const dropped = addImage(doc, "data:image/png;base64,BBBB");
  const inNote = addImage(doc, "data:image/png;base64,CCCC");
  doc.service.push({ type: "image", src: kept }, { type: "heading", text: "Offering", noteImage: inNote });
  assert.notEqual(kept, dropped);
  pruneImages(doc);
  assert.deepEqual(Object.keys(doc.images).sort(), [kept.slice(4), inNote.slice(4)].sort());
});
