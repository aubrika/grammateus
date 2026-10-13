# grammateus

Makes a folded, stapled Sunday bulletin as a print-ready PDF. It is built for one kind of document and tries to do that one well.

Status: early prototype. The layout engine works; there is no editing screen or
Windows installer yet.

## What it does now

- Takes a bulletin described as data (`bulletin.json`: cover, welcome page, the
  service as a list of headings, text, hymn titles and pictures, back page) and lays
  it out as letter-size pages matching the church's existing design.
- Flows the service across pages by itself. Text breaks between lines, a heading is
  never left alone at the foot of a page, and music breaks only between lines of
  music, with "continued on the following page…" added.
- Keeps each side note beside the part of the service it explains, wherever that
  part lands.
- Writes two PDFs: pages in reading order, and pages arranged on 11×17 sheets for
  folding.

## Try it

Needs Node 22 and Chromium.

```bash
npm install
node tools/make_pdf.mjs samples/<date>/bulletin.json out/
npm test
```

## Bringing in old bulletins

- `tools/import_pdf.py` rebuilds a `bulletin.json` from a finished bulletin PDF. This
  is the better route: the PDF has the true layout.

Real bulletins are kept out of this repository (`samples/` is ignored): they
contain licensed hymn music and people's names.

## Layout of the code

| Path | What |
|---|---|
| `src/renderer/layout.js` | Puts a bulletin into pages |
| `src/renderer/bulletin.css` | Page sizes, fonts and spacing |
| `src/impose.mjs` | Page order for folding |
| `tools/make_pdf.mjs` | Command-line PDF maker used for development |
| `tools/import_pdf.py` | Importers for old bulletins |

The bundled font is EB Garamond, under the SIL Open Font License
(`src/renderer/fonts/OFL.txt`).
