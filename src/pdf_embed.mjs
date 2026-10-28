// Stores the editable bulletin inside the PDF made from it, as an attached file.
//
// A PDF made this way can be opened again with nothing lost: the importer finds the
// attachment and uses it, and only falls back to reading the page layout for PDFs that
// came from somewhere else.
//
// The pictures are on the pages already, so the attachment points at those rather than
// holding a second copy of each (see pdf_pictures.mjs). A picture the PDF does not hold
// exactly stays in the attachment.

import { PDFDocument } from "pdf-lib";
import { POINTER, pdfReader, pointAtPictures } from "./pdf_pictures.mjs";

export const ATTACHMENT = "bulletin.json";

export async function embedBulletin(pdfBytes, bulletinText) {
  const original = new Uint8Array(pdfBytes);
  let doc = null;
  try { doc = JSON.parse(bulletinText); } catch { /* not a bulletin: stored as it is */ }
  const images = doc?.images && Object.keys(doc.images).length ? await pointAtPictures(original, doc.images) : null;

  const attach = async (text) => {
    const pdf = await PDFDocument.load(original);
    await pdf.attach(new TextEncoder().encode(text), ATTACHMENT, {
      mimeType: "application/json",
      description: "The editable bulletin this PDF was made from (Grammateus)",
    });
    return pdf.save();
  };
  if (!images) return attach(bulletinText);
  const saved = await attach(JSON.stringify({ ...doc, images }));
  // Saving keeps the numbers of the PDF's objects, so each pointer still finds its picture;
  // should that ever not hold, the pictures are stored in full instead.
  const before = pdfReader(original), after = pdfReader(saved);
  const intact = Object.values(images).filter((v) => v.startsWith(POINTER)).every((v) => {
    const n = Number(v.slice(POINTER.length)), a = before.stream(n), b = after.stream(n);
    return a && b && a.length === b.length && a.every((x, i) => x === b[i]) && after.object(n).dict["/Subtype"] === "/Image";
  });
  return intact ? saved : attach(bulletinText);
}
