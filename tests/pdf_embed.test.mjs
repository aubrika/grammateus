import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { ATTACHMENT, embedBulletin } from "../src/pdf_embed.mjs";

test("a bulletin stored inside a PDF can be read back exactly", async () => {
  const blank = await PDFDocument.create();
  blank.addPage([612, 792]).drawLine({ start: { x: 10, y: 10 }, end: { x: 50, y: 50 } });
  const text = JSON.stringify({ format: 1, meta: { title: "Tést ✓" }, images: { a: "data:image/png;base64," + "A".repeat(5000) } });
  const made = await embedBulletin(await blank.save(), text);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(made), verbosity: 0 }).promise;
  const attachments = await pdf.getAttachments();
  assert.ok(attachments && attachments[ATTACHMENT], "the attachment is present");
  assert.equal(new TextDecoder().decode(attachments[ATTACHMENT].content), text);
  assert.equal(pdf.numPages, 1);
});
