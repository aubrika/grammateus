// Arranges the pages of a bulletin for folding.
//
// A folded, stapled booklet is printed on sheets twice the page size, two pages per side.
// For N pages (a multiple of four), sheet k has pages N-2k and 1+2k on its front, and
// 2+2k and N-1-2k on its back. Printed double-sided (flipped on the short edge), stacked
// and folded, the pages then read in order.

import { PDFDocument } from "pdf-lib";

// Page numbers, 1-based, for each side of each sheet: [[left, right], ...].
export function bookletOrder(n) {
  if (n % 4) throw new Error(`A folded booklet needs a multiple of four pages; this has ${n}.`);
  const sides = [];
  for (let k = 0; k < n / 4; k++) {
    sides.push([n - 2 * k, 1 + 2 * k]);
    sides.push([2 + 2 * k, n - 1 - 2 * k]);
  }
  return sides;
}

export async function impose(pdfBytes) {
  const src = await PDFDocument.load(pdfBytes);
  const n = src.getPageCount();
  const out = await PDFDocument.create();
  // A completely empty page has nothing to embed; it is simply left blank on its sheet.
  const embedded = [];
  for (const page of src.getPages()) embedded.push(page.node.Contents() ? await out.embedPage(page) : null);
  const { width, height } = src.getPage(0).getSize();
  for (const [left, right] of bookletOrder(n)) {
    const sheet = out.addPage([2 * width, height]);
    if (embedded[left - 1]) sheet.drawPage(embedded[left - 1], { x: 0, y: 0, width, height });
    if (embedded[right - 1]) sheet.drawPage(embedded[right - 1], { x: width, y: 0, width, height });
  }
  return out.save();
}
