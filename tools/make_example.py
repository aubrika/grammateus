"""Writes examples/example.bulletin, the bulletin a new one starts from.

Everything in it is either made up or in the public domain (scripture is from the King
James Version), and the "music" is drawn here as a stand-in, so it can be given to anyone.

    python tools/make_example.py        (needs Pillow)
"""
import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw


def music(systems, seed):
    """A stand-in for a page of music: staves with notes, so that page breaks can be seen."""
    w, sys_h = 1500, 230
    im = Image.new("L", (w, systems * sys_h + 40), 255)
    d = ImageDraw.Draw(im)
    x = seed
    for s in range(systems):
        top = 40 + s * sys_h
        for line in range(5):
            d.line([(40, top + line * 18), (w - 40, top + line * 18)], fill=0, width=2)
        d.line([(40, top), (40, top + 72)], fill=0, width=3)
        d.line([(w - 40, top), (w - 40, top + 72)], fill=0, width=3)
        for n in range(14):
            x = (x * 1103515245 + 12345) % 2147483648
            cx, cy = 110 + n * 96, top + (x % 9) * 9
            d.ellipse([cx - 11, cy - 8, cx + 11, cy + 8], fill=0)
            d.line([(cx + 10, cy), (cx + 10, cy - 58)], fill=0, width=3)
            d.text((cx - 14, top + 100), "la", fill=60)
    return data_url(im)


def emblem():
    im = Image.new("L", (600, 600), 255)
    d = ImageDraw.Draw(im)
    d.ellipse([60, 60, 540, 540], outline=0, width=14)
    d.rectangle([280, 140, 320, 460], fill=0)
    d.rectangle([180, 240, 420, 280], fill=0)
    return data_url(im)


def data_url(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


T = lambda html, **k: {"type": "text", "html": html, **k}
H = lambda text, stand=False, **k: {"type": "heading", "text": text, "stand": stand, **k}
LORD = '<span class="sc">Lord</span>'

welcome = [
    T("<b>Welcome to Example Church</b>", float="img:emblem", floatSide="left", floatWidth="15%"),
    T("This is an example bulletin that comes with Grammateus. Open it, change the words, and save it under a new name "
      "to make your own. Nothing here is specific to any one church."),
    T("<b>How to read this bulletin</b>", align="center"),
    T("An asterisk (*) before a heading invites you to stand, as you are able. <b>Bold print</b> is said by everyone "
      "together. <i>Italic print</i> gives directions. The grey column explains parts of the service."),
    T("<b>How this bulletin is put together</b>", align="center"),
    T("It is made of parts: this welcome page, the service, extra pages and the back page. Every part can hold "
      "any kind of item, and each part chooses whether its pages have the grey side column for notes."),
]

service = [
    {"type": "section", "text": "Gathering"},
    H("Prelude"),
    H("Greeting", True, note="The greeting is among the oldest parts of Christian worship."),
    T("The Lord be with you.<br><b>And also with you.</b>"),
    H("Gathering Hymn", True),
    {"type": "hymn", "title": "Amazing Grace", "number": "No. 1",
     "note": "<u>Hymn Information</u><br>Text: John Newton, 1725–1807<br>Music: an example only"},
    {"type": "image", "src": "img:music1"},
    H("Prayer of the Day", True, note="This prayer gathers the themes of the day's readings."),
    T("Let us pray.<br>Gracious God, be present with your people gathered here, that we may hear your word and be glad.<br><b>Amen.</b>"),

    {"type": "section", "text": "Word"},
    H("First Reading", ref="Isaiah 40:28-31",
      note="The first reading is usually from the Old Testament. The readings here are from the King James Version, which is in the public domain."),
    T(f"<sup>28</sup>Hast thou not known? hast thou not heard, that the everlasting God, the {LORD}, the Creator of the ends "
      "of the earth, fainteth not, neither is weary? there is no searching of his understanding. <sup>29</sup>He giveth "
      "power to the faint; and to them that have no might he increaseth strength."),
    T("<sup>30</sup>Even the youths shall faint and be weary, and the young men shall utterly fall: <sup>31</sup>But they "
      f"that wait upon the {LORD} shall renew their strength; they shall mount up with wings as eagles; they shall run, "
      "and not be weary; and they shall walk, and not faint."),
    T("The word of the Lord.<br><b>Thanks be to God.</b>"),
    H("Psalm", ref="Psalm 23", note="The psalm is often sung or read together, as a response to the first reading."),
    T(f"<sup>1</sup>The {LORD} is my shepherd; I shall not want. <sup>2</sup>He maketh me to lie down in green pastures: he "
      "leadeth me beside the still waters. <sup>3</sup>He restoreth my soul: he leadeth me in the paths of righteousness "
      "for his name's sake."),
    T("<sup>4</sup>Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; "
      "thy rod and thy staff they comfort me. <sup>5</sup>Thou preparest a table before me in the presence of mine "
      "enemies: thou anointest my head with oil; my cup runneth over. <sup>6</sup>Surely goodness and mercy shall follow "
      f"me all the days of my life: and I will dwell in the house of the {LORD} for ever."),
    H("Second Reading", ref="Romans 8:38-39", note="The second reading is usually from one of the letters in the New Testament."),
    T("<sup>38</sup>For I am persuaded, that neither death, nor life, nor angels, nor principalities, nor powers, nor things "
      "present, nor things to come, <sup>39</sup>Nor height, nor depth, nor any other creature, shall be able to separate "
      "us from the love of God, which is in Christ Jesus our Lord."),
    T("The word of the Lord.<br><b>Thanks be to God.</b>"),
    H("Gospel", True, ref="John 1:1-5", note="The assembly stands to hear the Gospel."),
    T("<sup>1</sup>In the beginning was the Word, and the Word was with God, and the Word was God. <sup>2</sup>The same was "
      "in the beginning with God. <sup>3</sup>All things were made by him; and without him was not any thing made that "
      "was made. <sup>4</sup>In him was life; and the life was the light of men. <sup>5</sup>And the light shineth in "
      "darkness; and the darkness comprehended it not."),
    T("The Gospel of the Lord.<br><b>Praise to you, O Christ.</b>"),
    H("Sermon"),
    T("<i>A time of silence follows the sermon.</i>"),
    H("Hymn of the Day", True),
    {"type": "hymn", "title": "A Longer Example Hymn", "number": "No. 2"},
    {"type": "image", "src": "img:music2"},
    H("Prayers", True, note="We pray for the church, the world, and all who are in need."),
    T("<i>After each petition:</i><br>Lord, in your mercy,<br><b>hear our prayer.</b>"),

    {"type": "section", "text": "Sending"},
    H("Blessing", True),
    T("The Lord bless you and keep you.<br><b>Amen.</b>"),
    H("Dismissal", True),
    T("Go in peace.<br><b>Thanks be to God.</b>"),
    H("Postlude"),
]

extras = [
    {"type": "roster", "title": "Serving Today",
     "rows": [{"left": "Presiding", "right": "The Rev. A. N. Example"}, {"left": "Reader", "right": "A Reader"},
              {"left": "Musician", "right": "A Musician"}, {"left": "Usher", "right": "An Usher"}]},
    H("Announcements"),
    {"type": "rule"},
    T("<b>Coffee hour</b><br>Coffee hour follows the service. All are welcome."),
    {"type": "rule"},
    T("<b>About these pages</b><br>Pages like this one use the full width of the page. Add or remove whole sheets of "
      "paper with the buttons at the top of the window."),
]

back = [
    T("<b>You are welcome here.</b>", align="center"),
    T("Example Church · 1 Example Street · Anytown", align="center"),
    {"type": "logos", "images": ["img:emblem"]},
]

doc = {
    "format": 2,
    "style": {"font": "EB Garamond", "noteSize": 12},
    "meta": {"title": "Service of the Word", "sunday": "An Example Sunday", "date": "January 1, 2027"},
    "cover": {"show": True, "image": "img:emblem", "footer": ["Example Church", "Anytown"]},
    "parts": [
        {"name": "Welcome page", "side": False, "size": 13, "blocks": welcome},
        {"name": "The service", "side": True, "size": 15, "blocks": service},
        {"name": "Extra pages", "side": False, "size": 14.5, "blocks": extras},
        {"name": "Back page", "side": False, "size": 14, "last": True, "blocks": back},
    ],
    "extraSheets": 0,
    "images": {"emblem": emblem(), "music1": music(3, 7), "music2": music(9, 99)},
}
target = Path(__file__).resolve().parents[1] / "examples" / "example.bulletin"
target.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
print(f"wrote {target} ({target.stat().st_size // 1024} KB)")
