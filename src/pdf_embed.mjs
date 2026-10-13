// Stores the editable bulletin inside the PDF made from it, as an attached file.
//
// A PDF made this way can be opened again with nothing lost: the importer finds the
// attachment and uses it, and only falls back to reading the page layout for PDFs that
// came from somewhere else.

import { PDFDocument } from "pdf-lib";

export const ATTACHMENT = "bulletin.json";

export async function embedBulletin(pdfBytes, bulletinText) {
  const pdf = await PDFDocument.load(pdfBytes);
  await pdf.attach(new TextEncoder().encode(bulletinText), ATTACHMENT, {
    mimeType: "application/json",
    description: "The editable bulletin this PDF was made from (Grammateus)",
  });
  return pdf.save();
}
