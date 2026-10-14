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
    # Readings from the World English Bible (public domain), on one theme: the word written on the
    # heart, from stone and scroll to the congregation as a living letter
    H("First Reading", ref="Jeremiah 31:31–34",
      note="The first reading is usually from the Old Testament. All the readings here are from the World English Bible, which is in the public domain."),
    T(f"<sup>31</sup>\u201cBehold, the days come,\u201d says the {LORD}, \u201cthat I will make a new covenant with the house of Israel, "
      "and with the house of Judah, <sup>32</sup>not according to the covenant that I made with their fathers in the day that "
      "I took them by the hand to bring them out of the land of Egypt, which covenant of mine they broke, although I was a "
      f"husband to them,\u201d says the {LORD}."),
    T(f"<sup>33</sup>\u201cBut this is the covenant that I will make with the house of Israel after those days,\u201d says the {LORD}: "
      "\u201cI will put my law in their inward parts, and I will write it in their heart. I will be their God, and they shall "
      "be my people. <sup>34</sup>They will no longer each teach his neighbor, and every man teach his brother, saying, "
      f"\u2018Know the {LORD};\u2019 for they will all know me, from their least to their greatest,\u201d says the {LORD}, \u201cfor I will "
      "forgive their iniquity, and I will remember their sin no more.\u201d"),
    T("The word of the Lord.<br><b>Thanks be to God.</b>"),
    H("Psalm", ref="Psalm 40:6–10", note="The psalm is often sung or read together, as a response to the first reading."),
    T("<sup>6</sup>Sacrifice and offering you didn\u2019t desire.<br>You have opened my ears.<br>"
      "You have not required burnt offering and sin offering.<br>"
      "<sup>7</sup>Then I said, \u201cBehold, I have come.<br>It is written about me in the book in the scroll.<br>"
      "<sup>8</sup>I delight to do your will, my God.<br>Yes, your law is within my heart.\u201d"),
    T(f"<sup>9</sup>I have proclaimed glad news of righteousness in the great assembly.<br>"
      f"Behold, I will not seal my lips, {LORD}, you know.<br>"
      "<sup>10</sup>I have not hidden your righteousness within my heart.<br>"
      "I have declared your faithfulness and your salvation.<br>"
      "I have not concealed your loving kindness and your truth from the great assembly."),
    H("Second Reading", ref="2 Corinthians 3:1–6", note="The second reading is usually from one of the letters in the New Testament."),
    T("<sup>1</sup>Are we beginning again to commend ourselves? Or do we need, as do some, letters of commendation to you or "
      "from you? <sup>2</sup>You are our letter, written in our hearts, known and read by all men, <sup>3</sup>being revealed "
      "that you are a letter of Christ, served by us, written not with ink, but with the Spirit of the living God; not in "
      "tablets of stone, but in tablets that are hearts of flesh."),
    T("<sup>4</sup>Such confidence we have through Christ toward God, <sup>5</sup>not that we are sufficient of ourselves to "
      "account anything as from ourselves; but our sufficiency is from God, <sup>6</sup>who also made us sufficient as servants "
      "of a new covenant, not of the letter but of the Spirit. For the letter kills, but the Spirit gives life."),
    T("The word of the Lord.<br><b>Thanks be to God.</b>"),
    H("Gospel", True, ref="Luke 24:28–32", note="The assembly stands to hear the Gospel."),
    T("<sup>28</sup>They came near to the village where they were going, and he acted like he would go further. "
      "<sup>29</sup>They urged him, saying, \u201cStay with us, for it is almost evening, and the day is almost over.\u201d "
      "He went in to stay with them. <sup>30</sup>When he had sat down at the table with them, he took the bread and gave "
      "thanks. Breaking it, he gave it to them. <sup>31</sup>Their eyes were opened and they recognized him; then he "
      "vanished out of their sight. <sup>32</sup>They said to one another, \u201cWeren\u2019t our hearts burning within us "
      "while he spoke to us along the way, and while he opened the Scriptures to us?\u201d"),
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
