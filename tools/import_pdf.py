"""Rebuild a bulletin.json from a finished bulletin PDF.

The PDF sent to the printer has the true layout, so it is the best source: text can be
read in order with its formatting, each side note can be
tied to the part of the service printed beside it, and each picture is found where it
was placed.

    pdftohtml -xml old-bulletin.pdf work/c        (poppler; writes work/c.xml and pictures)
    pdffonts old-bulletin.pdf > work/fonts.txt
    python tools/import_pdf.py work out-folder --service 3-14 --back 18

Only the cover, the welcome page, the service pages and the back page are handled.
"""
from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

from PIL import Image

PX = 108.0                      # pdftohtml's default: 108 px per inch on a letter page
PAGE_W = 8.5 * PX
SIDE = 2.75 * PX                # where the side column ends on an odd page
BODY = 23                       # body text size in px (15 pt)


def read_fonts(work):
    """Font id -> (size, bold, italic)."""
    style = {}
    for line in (work / "fonts.txt").read_text().splitlines()[2:]:
        name = line.split()[0]
        prefix = name.split("+")[0]
        style[prefix] = ("Bold" in name, "Italic" in name)
    x = (work / "c.xml").read_text(encoding="utf-8", errors="replace")
    fonts = {}
    for fid, size, family in re.findall(r'<fontspec id="(\d+)" size="(\d+)" family="([^"]+)"', x):
        bold, italic = style.get(family.split("+")[0], (False, False))
        fonts[fid] = (int(size), bold, italic, "Symbol" in family)
    return x, fonts


def page_items(x, fonts):
    pages = {}
    for chunk in re.split(r"<page ", x)[1:]:
        n = int(re.match(r'number="(\d+)"', chunk).group(1))
        texts = []
        for top, left, width, height, fid, body in re.findall(
                r'<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="(\d+)">(.*?)</text>', chunk, flags=re.S):
            text = html.unescape(re.sub(r"<[^>]+>", "", body))
            if text.strip() or text:
                size, bold, italic, symbol = fonts[fid]
                texts.append({"top": int(top), "left": int(left), "right": int(left) + int(width),
                              "base": int(top) + int(height), "size": size, "bold": bold, "italic": italic,
                              "symbol": symbol, "text": text})
        images = [{"top": int(t), "left": int(l), "width": int(w), "height": int(h), "src": Path(s).name}
                  for t, l, w, h, s in re.findall(
                      r'<image top="(-?\d+)" left="(-?\d+)" width="(\d+)" height="(\d+)" src="([^"]+)"', chunk)]
        pages[n] = (texts, images)
    return pages


def lines_of(texts):
    """Group fragments into lines, left to right.

    Body-size fragments define the lines by their baseline. Smaller pieces (small capitals,
    verse numbers, symbols) sit at slightly different heights, so each joins the line whose
    band it falls in.
    """
    lines = []
    big = [t for t in texts if t["size"] >= BODY - 1 and not t["symbol"]]
    small = [t for t in texts if not (t["size"] >= BODY - 1 and not t["symbol"])]
    for t in sorted(big, key=lambda t: (t["base"], t["left"])):
        for line in lines:
            if abs(line["base"] - t["base"]) <= 6:
                line["parts"].append(t)
                break
        else:
            lines.append({"base": t["base"], "top": t["top"], "parts": [t]})
    for t in sorted(small, key=lambda t: (t["base"], t["left"])):
        middle = (t["top"] + t["base"]) / 2
        home = [l for l in lines if l["top"] - 3 <= middle <= l["base"] + 3]
        if home:
            min(home, key=lambda l: abs((l["top"] + l["base"]) / 2 - middle))["parts"].append(t)
        else:
            near = [l for l in lines if abs(l["base"] - t["base"]) <= 6 and all(p["size"] < BODY - 1 or p["symbol"] for p in l["parts"])]
            if near:
                near[0]["parts"].append(t)
            else:
                lines.append({"base": t["base"], "top": t["top"], "parts": [t]})
    for line in lines:
        line["parts"].sort(key=lambda p: p["left"])
        line["left"] = line["parts"][0]["left"]
        line["right"] = max(p["right"] for p in line["parts"])
    return sorted(lines, key=lambda l: l["base"])


def small_caps_text(parts):
    """Small caps are often drawn as full-size capitals plus smaller capitals."""
    out = ""
    for p in parts:
        out += p["text"].lower() if p["size"] < BODY - 2 else p["text"]
    return re.sub(r"\s+", " ", out).strip()


def run_html(parts):
    out = ""
    for p in parts:
        t = html.escape(p["text"], quote=False)
        if not p["symbol"] and p["size"] <= BODY - 6 and re.fullmatch(r"\s*\d{1,3}\s*", p["text"]):
            t = f"<sup>{t.strip()}</sup>"
        elif not p["symbol"] and BODY - 6 < p["size"] < BODY - 2 and p["text"].strip() and p["text"].upper() == p["text"]:
            t = '<span class="sc">' + t.title() + "</span>"
        if p["italic"]:
            t = f"<i>{t}</i>"
        if p["bold"]:
            t = f"<b>{t}</b>"
        out += t
    out = re.sub(r"</b>(\s*)<b>", r"\1", out)
    out = re.sub(r"</i>(\s*)<i>", r"\1", out)
    out = re.sub(r'</span>(\s*)<span class="sc">', r"\1", out)
    return re.sub(r"[ \t]+", " ", out).strip()


def is_heading(line):
    lead = [p for p in line["parts"] if p["text"].strip()]
    if not lead or not lead[0]["bold"] or lead[0]["italic"]:
        return False
    small = [p for p in lead if p["bold"] and BODY - 6 < p["size"] < BODY - 2 and p["text"].upper() == p["text"]]
    return bool(small) and lead[0]["size"] >= BODY - 1


def classify(line, col_left, col_right):
    parts = [p for p in line["parts"] if p["text"].strip()]
    text = "".join(p["text"] for p in line["parts"]).strip()
    if parts[0]["size"] >= 28 and parts[0]["bold"]:
        return {"type": "section", "text": small_caps_text(parts).replace("+", "").strip().title()}
    if is_heading(line):
        head = [p for p in line["parts"] if p["bold"] and not p["italic"]]
        rest = [p for p in line["parts"] if not (p["bold"] and not p["italic"]) and p["text"].strip()]
        title = small_caps_text(head)
        title = re.sub(r"\b([a-z])", lambda m: m.group(1).upper(), title)
        title = re.sub(r"\b(And|Of|The|For|In|To|At|Is)\b", lambda m: m.group(1).lower(), title)
        title = title[:2].upper() + title[2:] if title.startswith("*") else title[:1].upper() + title[1:]
        block = {"type": "heading", "text": title.lstrip("*").strip(), "stand": title.startswith("*")}
        italic = "".join(p["text"] for p in rest if p["italic"]).strip()
        plain = "".join(p["text"] for p in rest if not p["italic"]).strip()
        if italic:
            block["title"] = italic
        if plain:
            block["ref"] = plain
        return block
    if parts[0]["italic"] and (m := re.fullmatch(r"(.+?)\s+((?:ELW|ACS|TFF|WOV|LBW)\s*\d+[a-z]?)", text)):
        return {"type": "hymn", "title": m.group(1).strip(), "number": m.group(2)}
    return None


def paragraphs(lines, col_left, col_right, gap=30):
    """Join lines into blocks. Returns blocks with their top position on the page."""
    blocks = []
    current = None
    for i, line in enumerate(lines):
        text = "".join(p["text"] for p in line["parts"]).strip()
        if not text:
            continue
        special = classify(line, col_left, col_right)
        if special:
            special["_top"], special["_bottom"] = line["top"], line["base"]
            blocks.append(special)
            current = None
            continue
        new = current is None or line["base"] - current["_bottom"] > gap
        if new:
            current = {"type": "text", "_top": line["top"], "_bottom": line["base"], "_lines": [line]}
            blocks.append(current)
        else:
            current["_lines"].append(line)
            current["_bottom"] = line["base"]
    for b in blocks:
        if b["type"] != "text":
            continue
        out = ""
        for k, line in enumerate(b["_lines"]):
            piece = run_html(line["parts"])
            if k:
                prev = b["_lines"][k - 1]
                # a line that stops well short of the margin ended on purpose
                out += "<br>" if prev["right"] < col_right - 0.22 * (col_right - col_left) else " "
            out += piece
        b["html"] = re.sub(r"</b>(\s*(?:<br>)?\s*)<b>", r"\1", out)
        b["_full"] = b["_lines"][-1]["right"] > col_right - 0.12 * (col_right - col_left)
        mid = (col_left + col_right) / 2
        b["_center"] = all(abs((l["left"] + l["right"]) / 2 - mid) < 16 and l["right"] - l["left"] < 0.9 * (col_right - col_left)
                           for l in b["_lines"])
        del b["_lines"]
    return blocks


def stitch(strips, src_dir, out_path):
    """Some PDF makers cut each picture into horizontal strips; put them back together."""
    ims = [Image.open(src_dir / s["src"]).convert("L") for s in strips]
    width = max(im.width for im in ims)
    ims = [im if im.width == width else im.resize((width, round(im.height * width / im.width))) for im in ims]
    sheet = Image.new("L", (width, sum(im.height for im in ims)), 255)
    y = 0
    for im in ims:
        sheet.paste(im, (0, y))
        y += im.height
    sheet.save(out_path, optimize=True)


def picture_groups(images):
    groups = []
    for im in sorted(images, key=lambda i: (i["left"], i["top"])):
        g = groups[-1] if groups else None
        if g and g["left"] == im["left"] and g["width"] == im["width"] and abs(g["bottom"] - im["top"]) <= 3:
            g["strips"].append(im)
            g["bottom"] = im["top"] + im["height"]
        else:
            groups.append({"left": im["left"], "width": im["width"], "top": im["top"],
                           "bottom": im["top"] + im["height"], "strips": [im]})
    return sorted(groups, key=lambda g: g["top"])


def service(pages, numbers, work, out):
    blocks, count = [], 0
    for n in numbers:
        texts, images = pages[n]
        odd = n % 2 == 1
        main_l, main_r = (SIDE, PAGE_W - 0.25 * PX) if odd else (0.25 * PX, PAGE_W - SIDE)
        in_main = lambda left: main_l - 6 <= left < main_r
        texts = [t for t in texts if t["top"] < 10.45 * PX and "continued on the following" not in t["text"]]
        main = paragraphs(lines_of([t for t in texts if in_main(t["left"])]), main_l + 4, main_r - 8)
        notes = paragraphs(lines_of([t for t in texts if not in_main(t["left"])]),
                           *((0.29 * PX, SIDE - 6) if odd else (PAGE_W - SIDE + 4, PAGE_W - 0.3 * PX)), gap=26)
        page_blocks = list(main)
        side_pictures = []
        for g in picture_groups(images):
            count += 1
            name = f"images/p{n:02d}-{count:02d}.png"
            stitch(g["strips"], work, out / name)
            if in_main(g["left"] + g["width"] / 2):
                width = min(100, round(100 * g["width"] / (main_r - main_l - 0.11 * PX)))
                block = {"type": "image", "src": name, "_top": g["top"], "_bottom": g["bottom"]}
                if width < 92:
                    block["width"] = f"{width}%"
                page_blocks.append(block)
            else:
                side_pictures.append((g["top"], name))
        page_blocks.sort(key=lambda b: b["_top"])
        # a side note belongs to the block it starts beside
        for note in notes:
            if note["type"] != "text" or not page_blocks:
                continue
            anchor = min(page_blocks, key=lambda b: (abs(b["_top"] - note["_top"]) if b["_top"] <= note["_top"] + 14
                                                     else 1e6 + b["_top"]))
            text = re.sub(r"^(<i>)?Hymn Information", r"\1<u>Hymn Information</u><br>", note["html"])
            text = re.sub(r"^<i>(.*)</i>$", r"\1", text) if text.count("<i>") == 1 else text
            anchor["note"] = (anchor["note"] + "<br><br>" + text) if "note" in anchor else text
            note["_anchor"] = anchor
        for top, name in side_pictures:               # a picture in the side column goes with the note above it
            above = [n for n in notes if n["type"] == "text" and "_anchor" in n and n["_top"] <= top]
            if above:
                max(above, key=lambda n: n["_top"])["_anchor"]["noteImage"] = name
        # a paragraph that ran over from the previous page is one paragraph
        if blocks and page_blocks and blocks[-1]["type"] == "text" and page_blocks[0]["type"] == "text" \
                and blocks[-1].get("_full") and "note" not in page_blocks[0]:
            blocks[-1]["html"] += " " + page_blocks[0]["html"]
            blocks[-1]["_full"] = page_blocks[0].get("_full")
            page_blocks = page_blocks[1:]
        blocks.extend(page_blocks)
    for b in blocks:
        for k in [k for k in b if k.startswith("_")]:
            del b[k]
    return blocks


def plain_page(pages, n, work, out, prefix):
    texts, images = pages[n]
    texts = [t for t in texts if t["top"] < 10.45 * PX]
    left, right = min(t["left"] for t in texts), max(t["right"] for t in texts)
    items = []
    for b in paragraphs(lines_of(texts), left, right, gap=27):
        if b["type"] != "text":
            b = {"html": f"<b>{b.get('text', '')}</b>"}
        items.append({"html": b["html"], "align": "center" if b.get("_center") else "left"})
    pictures = []
    for k, g in enumerate(picture_groups(images)):
        name = f"images/{prefix}-{k + 1}.png"
        stitch(g["strips"], work, out / name)
        pictures.append(name)
    return items, pictures


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--service", required=True, help="first-last page of the service, e.g. 3-14")
    ap.add_argument("--back", type=int, required=True)
    a = ap.parse_args()
    (a.out / "images").mkdir(parents=True, exist_ok=True)
    x, fonts = read_fonts(a.work)
    pages = page_items(x, fonts)
    first, last = map(int, a.service.split("-"))

    cover_lines = [re.sub(r"\s+", " ", "".join(p["text"] for p in l["parts"])).strip() for l in lines_of(pages[1][0])]
    cover_lines = [c for c in cover_lines if c and c != "#"]
    _, cover_pictures = plain_page(pages, 1, a.work, a.out, "cover")
    welcome, welcome_pictures = plain_page(pages, 2, a.work, a.out, "welcome")
    back, back_pictures = plain_page(pages, a.back, a.work, a.out, "back")
    doc = {
        "meta": {"title": cover_lines[0].title().replace(" Of ", " of "),
                 "sunday": cover_lines[1].title().replace(" After ", " after ") if len(cover_lines) > 1 else "",
                 "date": cover_lines[2] if len(cover_lines) > 2 else ""},
        "cover": {"image": cover_pictures[0] if cover_pictures else "", "footer": cover_lines[3:]},
        "welcomeLogo": welcome_pictures[0] if welcome_pictures else "",
        "welcome": welcome,
        "service": service(pages, range(first, last + 1), a.work, a.out),
        "back": back + [{"logos": back_pictures}],
    }
    (a.out / "bulletin.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    kinds = {}
    for b in doc["service"]:
        kinds[b["type"]] = kinds.get(b["type"], 0) + 1
    print("service blocks", kinds, "| side notes", sum("note" in b for b in doc["service"]), "| cover:", cover_lines)


if __name__ == "__main__":
    main()
