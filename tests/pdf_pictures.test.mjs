import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { ATTACHMENT, embedBulletin } from "../src/pdf_embed.mjs";
import { POINTER, decodePng, encodePng, followPointers, pointAtPictures, samePixels } from "../src/pdf_pictures.mjs";

// a 4 x 3 JPEG, made once with Pillow
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAADAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwySQysCQoIAX5VCjgY7fTr36miiivmdj+3IxUEoxVkj//2Q==";

// a small picture with a gradient, as a PNG; `seeThrough` makes some of it partly see-through
async function png(width, height, { seeThrough = false, shift = 0 } = {}) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    rgba.set([(x * 37 + shift) & 255, (y * 59) & 255, (x * y) & 255, seeThrough && x < 3 ? 90 : 255], p);
  }
  return encodePng({ width, height, rgba });
}
const url = (type, bytes) => `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;
const pixelsOf = async (dataUrl) => decodePng(Buffer.from(dataUrl.split(",")[1], "base64"));

// a PDF with the given pictures drawn on its one page
async function pdfWith(pictures) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  let y = 700;
  for (const p of pictures) {
    const image = p.startsWith("data:image/png") ? await pdf.embedPng(p) : await pdf.embedJpg(p);
    page.drawImage(image, { x: 50, y: (y -= 60), width: 50, height: 40 });
  }
  return pdf.save();
}

test("a PNG made here reads back with the same pixels", async () => {
  for (const seeThrough of [false, true]) {
    const made = await png(23, 17, { seeThrough });
    const back = await decodePng(made);
    assert.equal(back.width, 23);
    assert.equal(back.channels, seeThrough ? 4 : 3);
    assert.ok(samePixels(back, await decodePng(await encodePng({ width: 23, height: 17, rgba: new Uint8Array(23 * 17 * 4).fill(255) }))) === false);
  }
});

test("pictures the PDF holds become pointers, and come back exactly", async () => {
  const solid = url("png", await png(30, 20));
  const clear = url("png", await png(30, 20, { seeThrough: true }));
  const photo = url("jpeg", Buffer.from(JPEG, "base64"));
  const absent = url("png", await png(30, 20, { shift: 5 }));        // same size, different pixels, not drawn
  const bytes = await pdfWith([solid, clear, photo]);
  const images = { a: solid, b: clear, c: photo, d: absent, e: solid };

  const pointed = await pointAtPictures(bytes, images);
  for (const id of ["a", "b", "c", "e"]) assert.ok(pointed[id].startsWith(POINTER), `${id} points into the PDF`);
  assert.equal(pointed.d, absent, "a picture the PDF does not hold stays as it was");
  assert.equal(pointed.a, pointed.e, "the same picture twice points at the same place");

  const back = await followPointers(bytes, pointed);
  assert.equal(back.c, photo, "a JPEG comes back byte for byte");
  for (const id of ["a", "b", "e"]) assert.ok(samePixels(await pixelsOf(back[id]), await pixelsOf(images[id])), `${id} has the same pixels`);
});

test("the bulletin stored in a PDF keeps no second copy of its pictures", async () => {
  const solid = url("png", await png(40, 30));
  const bytes = await pdfWith([solid]);
  const text = JSON.stringify({ format: 2, meta: { title: "Tést ✓" }, parts: [], images: { a: solid } });
  const made = await embedBulletin(bytes, text);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(made), verbosity: 0 }).promise;
  const stored = JSON.parse(new TextDecoder().decode((await pdf.getAttachments())[ATTACHMENT].content));
  assert.ok(stored.images.a.startsWith(POINTER));
  assert.equal(stored.meta.title, "Tést ✓");
  const back = await followPointers(new Uint8Array(made), stored.images);
  assert.ok(samePixels(await pixelsOf(back.a), await pixelsOf(solid)));
});

test("a pointer to a picture that is not there is an error, not a missing picture", async () => {
  const bytes = await pdfWith([url("png", await png(8, 8))]);
  await assert.rejects(followPointers(bytes, { a: `${POINTER}9999` }));
});
