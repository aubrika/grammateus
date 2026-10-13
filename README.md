# grammateus

Makes a folded, stapled Sunday bulletin as a print-ready PDF. It is built for one kind of document and tries to do that one well.

Status: early. The editing screen and the page layout work; the Windows installer is
built automatically but has not yet been tried on a real Windows computer.

## What it does

- **An editing screen** with three parts: an outline of the bulletin, a form for the
  part you select, and a live preview of the pages. Click anything in the preview to
  edit it.
- **Parts.** A bulletin is a cover followed by parts: by default a welcome page, the
  service, extra pages and a back page. Every part can hold every kind of item, each
  part chooses whether its pages have the grey side column for notes, and parts can be
  added, removed, renamed and reordered. The default arrangement is only a starting
  point.
- **Pages lay themselves out.** A part is a list of headings, text, hymn titles
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
- **Import a bulletin PDF.** A finished bulletin PDF can be turned back into an
  editable bulletin: the service in order with its formatting, each side note tied to
  its part, pictures and music in place, and the roster, columns and announcements on
  the pages after the service. It works on bulletins laid out the way this program
  lays them out.
- **Its own PDFs reopen exactly.** Every PDF the program makes carries the editable
  bulletin inside it, so a bulletin can be recovered from its PDF with nothing lost.

## Run it

Needs Node 22.

```bash
npm install
npm start          # the desktop program
npm test
```

The Windows installer is on the repository's Releases page. It adds Grammateus to the
Start menu. The workflow in `.github/workflows/build.yml` builds it on every push, and
publishes it as a release when a tag is pushed: set the version in `package.json`,
then `git tag v0.2.0 && git push origin v0.2.0`.

For development without the desktop shell, the page-making script needs Chromium:

```bash
node tools/make_pdf.mjs <folder>/bulletin.json out/
node tools/ui_check.mjs examples/example.bulletin out/ui
```

## Bringing in old bulletins

- **In the program:** Import PDF… (`src/app/import_pdf.js`). The PDF sent to the printer
  has the true layout, so this is the route to use.
- `tools/import_pdf.py` is the earlier command-line version of the same thing.

What the PDF import cannot recover: a table whose cells the PDF stores as one run of
text (it comes in as a paragraph), and where the lines between announcements were
(they are placed before each bold title).

Real bulletins are kept out of this repository (`samples/` is ignored): they
contain licensed hymn music and people's names.

## Layout of the code

| Path | What |
|---|---|
| `src/app/` | The editing screen, and the PDF import |
| `src/renderer/layout.js` | Puts a bulletin into pages |
| `src/renderer/bulletin.css` | Page sizes, fonts and spacing |
| `src/impose.mjs` | Page order for folding, for printers that cannot do it themselves |
| `electron/` | The desktop program: window, menus, opening and saving files |
| `examples/example.bulletin` | The bulletin a new one starts from (written by `tools/make_example.py`) |
| `build/` | The program's icon (drawn by `tools/make_icon.py`) |
| `tools/` | Importers for old bulletins and development scripts |

The bundled font is EB Garamond, under the SIL Open Font License
(`src/renderer/fonts/OFL.txt`).
