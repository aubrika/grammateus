import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { bookletOrder, impose } from "../src/impose.mjs";

test("a four-page bulletin puts 4 and 1 outside, 2 and 3 inside", () => {
  assert.deepEqual(bookletOrder(4), [[4, 1], [2, 3]]);
});

test("sixteen pages: every page appears once and facing pages sum to 17", () => {
  const sides = bookletOrder(16);
  assert.equal(sides.length, 8);
  assert.deepEqual(sides.flat().sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1));
  for (const [l, r] of sides) assert.equal(l + r, 17);
  assert.deepEqual(sides[0], [16, 1]);
  assert.deepEqual(sides[7], [8, 9]);          // the centre spread
});

test("the left page of every side is even, so odd pages are always on the right", () => {
  for (const [l, r] of bookletOrder(12)) { assert.equal(l % 2, 0); assert.equal(r % 2, 1); }
});

test("a page count that is not a multiple of four is refused", () => {
  assert.throws(() => bookletOrder(10), /multiple of four/);
});

test("imposing eight letter pages gives four tabloid sides", async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 8; i++) doc.addPage([612, 792]);
  const out = await PDFDocument.load(await impose(await doc.save()));
  assert.equal(out.getPageCount(), 4);
  assert.deepEqual(out.getPage(0).getSize(), { width: 1224, height: 792 });
});
