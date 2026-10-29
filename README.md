<p align="center"><img src="build/icon.png" width="96" alt="The Grammateus icon: a gold cross in a ring on purple"></p>

<h1 align="center">grammateus</h1>

> ὁ δὲ εἶπεν αὐτοῖς Διὰ τοῦτο πᾶς γραμματεὺς μαθητευθεὶς τῇ βασιλείᾳ τῶν οὐρανῶν ὅμοιός ἐστιν ἀνθρώπῳ οἰκοδεσπότῃ ὅστις ἐκβάλλει ἐκ τοῦ θησαυροῦ αὐτοῦ καινὰ καὶ παλαιά.
>
> And he said to them, "Therefore every scribe who has been made a disciple of the kingdom of heaven is like the master of a house, who brings out of his storeroom things new and old."
>
> — Matthew 13:52

*Grammateus* (γραμματεύς) is the Greek word for a scribe.

A tool for producing weekly church bulletins: folded, stapled booklets, made as a
print-ready PDF. It is built for one kind of document and tries to do that one well.

Status: early, and in use for testing. The editing screen, the page layout and the
Windows installer all work on Windows 10. The Mac and Linux versions are built the same
way but have not yet been tried on those systems.

**To download and install Grammateus, go to
[grammateus-releases](https://github.com/aubrika/grammateus-releases)**, which has the
installers and how to install them. This repository holds the source code.

## What it does

- **An editing screen** with three parts: an outline of the bulletin, a form for the
  part you select, and a live preview of the pages. Click anything in the preview to
  edit it; the words of a text item can be typed straight into on the page.
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
  capitals and line breaks, and loses everything else. Blank lines and spaces typed at
  the start or end of a text item are kept, as a way to move it, or what follows it,
  down or across a little.
- **Whole sheets.** A folded bulletin is made of sheets of four pages. The program
  pads to a multiple of four with blank pages before the back cover, and extra sheets
  (for announcements and the like) are added or removed with one button. The padding
  can be switched off for printers that add blank pages themselves.
- **Enlarge text to fill the sheets (experimental).** Makes the text as large as it can
  be while the bulletin still fits on the sheets it already needs.
- **Slow work shows its progress:** a spinner, what is happening and a percentage.
- **One file per bulletin.** A `.bulletin` file holds the words and the pictures, so
  next week starts by opening last week's and saving it under a new name.
- **Any font.** A good open font comes with the program, so a bulletin looks the same
  on every computer. A church can choose another font it has installed: for the whole
  bulletin, for one kind of item (all headings, all side notes), or for a single item.
  Text sizes work the same way: a default size for the whole bulletin, which a part, a
  kind of item (all headings, say, or all side notes) or a single item can override.
  Line spacing too: one setting for the whole bulletin, which a single item can override.
- **Make PDF** writes the pages in reading order, ready for a copier that folds and
  staples.
- **Paper sizes.** Letter pages (printed on 11 × 17 in sheets) by default; half letter,
  half legal, A4 and A5 can be chosen under Design. Changing the size changes all the text
  sizes in proportion, so the bulletin keeps its look.
- **A white side column** can be chosen under Design, to save toner; it is grey by default.
- **Import a bulletin PDF.** A finished bulletin PDF can be turned back into an
  editable bulletin in one step: the service in order with its formatting (the paragraphs of a
  reading or a prayer as one item, to edit as one), each side note tied to
  its part, pictures and music in place (cropped as they were printed), and the roster, columns and announcements on
  the pages after the service. It keeps the fonts the PDF was set in, a paragraph's own line
  spacing, the lines drawn across the page and any grey boxes. It works on bulletins laid out the way this program
  lays them out.
- **It keeps itself up to date.** When the installed program starts, it asks the public
  downloads repository (`aubrika/grammateus-releases`, folder `updates/`) whether a newer
  version exists. It asks again every hour while it
  stays open. If there is one, it downloads it while you work and installs it when you close the program. Help → *Check for
  a newer version…* does the same check by hand. That is on Windows and with the Linux
  AppImage; on a Mac and with the Linux `.deb` package it says a newer version is ready to
  download and opens the downloads page.
- **Its own PDFs reopen exactly.** Every PDF the program makes carries the editable
  bulletin inside it, so a bulletin can be recovered from its PDF with nothing lost. The
  pictures are not stored twice: the copy inside points at the pictures on the pages, so the
  PDF is hardly larger than the pages alone. If a PDF has been changed by another program
  so that the pictures cannot be found, it is read from its pages instead.

## Run it

Needs Node 22.

```bash
npm install
npm start          # the desktop program
npm test
```

The workflow in `.github/workflows/build.yml` builds the installers, each on its own
system, on every push: for Windows (adds Grammateus to the Start menu), for Mac (a `.dmg`
that runs on both Apple and Intel processors), and for Linux (an AppImage and a `.deb`
package). When a tag is pushed, it also publishes them as a pre-release on this
repository's Releases page, for testing; installed copies do not update from there. To make
a pre-release: set the version in `package.json`, then
`git tag v0.2.0 && git push origin v0.2.0`. `npm run dist`, `npm run dist:mac` and
`npm run dist:linux` build one by hand.

To publish a version for everyone, use the `release` workflow in
[`aubrika/grammateus-releases`](https://github.com/aubrika/grammateus-releases): write
what is new in its `notes/<version>.md`, then on its Actions tab run `release` with the
version and the commit or tag to build. It builds the installers from this repository,
publishes them as a release there, and points the files in its `updates/` folder at them,
keeping the Windows installer's block maps. Installed copies read those files within the
hour; the block maps let an update download only the parts of the new installer that changed.

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
| `build/` | The program's icon: a gold cross in a ring on purple. The `.svg` files are the originals; `icon.png` and `icon.ico` are made from them (`icon.ico` holds plain bitmaps at 16 to 256 pixels, the layout Windows reads most reliably) |
| `tools/` | Importers for old bulletins and development scripts |

The bundled font is EB Garamond, under the SIL Open Font License
(`src/renderer/fonts/OFL.txt`).
