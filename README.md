# grammateus

Makes a folded, stapled Sunday bulletin as a print-ready PDF. It is built for one kind of document and tries to do that one well.

Status: early. The editing screen and the page layout work; the Windows installer is
built automatically but has not yet been tried on a real Windows computer.

## What it does

- **An editing screen** with three parts: an outline of the bulletin, a form for the
  part you select, and a live preview of the pages. Click anything in the preview to
  edit it.
- **Pages lay themselves out.** The service is a list of headings, text, hymn titles
  and pictures. Text breaks between lines, a heading is never left alone at the foot
  of a page, and music breaks only between lines of music, with "continued on the
  following page…" added.
- **Side notes stay beside their part.** Each note belongs to a part of the service
  and is printed next to wherever that part lands.
- **Pasting is clean.** Text pasted from Word or a web page keeps bold, italic, small
  capitals and line breaks, and loses everything else.
- **Whole sheets.** A folded bulletin is made of sheets of four pages. The program
  always makes a multiple of four, and extra sheets (for announcements and the like)
  are added or removed with one button.
- **One file per bulletin.** A `.bulletin` file holds the words and the pictures, so
  next week starts by opening last week's and saving it under a new name.
- **Any font.** A good open font comes with the program, so a bulletin looks the same
  on every computer. A church can choose another font it has installed.
- **Make PDF** writes letter-size pages in reading order, ready for a copier that
  folds and staples.

## Run it

Needs Node 22.

```bash
npm install
npm start          # the desktop program
npm test
```

The Windows installer is built by the workflow in `.github/workflows/build.yml` and
can be downloaded from that run's page. It adds Grammateus to the Start menu.

For development without the desktop shell, the page-making script needs Chromium:

```bash
node tools/make_pdf.mjs <folder>/bulletin.json out/
node tools/ui_check.mjs examples/example.bulletin out/ui
```

## Bringing in old bulletins

- `tools/import_pdf.py` rebuilds a `bulletin.json` from a finished bulletin PDF. This
  is the better route: the PDF has the true layout.

Real bulletins are kept out of this repository (`samples/` is ignored): they
contain licensed hymn music and people's names.

## Layout of the code

| Path | What |
|---|---|
| `src/app/` | The editing screen |
| `src/renderer/layout.js` | Puts a bulletin into pages |
| `src/renderer/bulletin.css` | Page sizes, fonts and spacing |
| `src/impose.mjs` | Page order for folding, for printers that cannot do it themselves |
| `electron/` | The desktop program: window, menus, opening and saving files |
| `examples/example.bulletin` | The bulletin a new one starts from |
| `tools/` | Importers for old bulletins and development scripts |

The bundled font is EB Garamond, under the SIL Open Font License
(`src/renderer/fonts/OFL.txt`).
