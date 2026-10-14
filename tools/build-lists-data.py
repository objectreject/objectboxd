#!/usr/bin/env python3
# Merge the scraped TSVs into a compact lists-data.json for objectboxd.
# Key = alnum(lowercased title) + "|" + year  (matched identically in JS).
import re, json, unicodedata, os, datetime, html

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

# order matters: index is referenced from films[]; tier drives priority
LISTS = [
    {"key":"ubuweb",       "name":"UbuWeb",             "tier":"stream", "url":"https://letterboxd.com/j__e__r__m/list/ubuweb-master-list/"},
    {"key":"oedipus",      "name":"Oedipus Rex upload", "tier":"stream", "url":"https://letterboxd.com/shenanigance/list/oedipus-rex-upload/"},
    {"key":"zenxiu",       "name":"Zen Xiu",            "tier":"stream", "url":"https://letterboxd.com/zenxiu/list/zen-xiu/"},
    {"key":"japanokru",    "name":"Japanese on ok.ru",  "tier":"stream", "url":"https://letterboxd.com/fabianpena/list/japanese-movies-uploaded-to-okru/"},
    {"key":"solidarity",   "name":"Solidarity Cinema",  "tier":"dlfast", "url":"https://letterboxd.com/solidaritycine/list/solidarity-cinema-archive/"},
    {"key":"rarefilmm",    "name":"rarefilmm.com",      "tier":"dlslow", "url":"https://letterboxd.com/rhettman417/list/movies-on-rarefilmmcom/"},
    {"key":"worldscinema", "name":"worldscinema.org",   "tier":"dlslow", "url":"https://letterboxd.com/kordian86/list/films-featured-on-worldscinemaorg/"},
    {"key":"internetarchive", "name":"Internet Archive", "tier":"stream", "url":"https://letterboxd.com/_pigsty/list/internet-archive/"},
    {"key":"pompoarismo", "name":"Acervo Pompoarismo", "tier":"stream", "url":"https://letterboxd.com/pompoarism0/list/acervo-pompoarismo/"},
    {"key":"intlfilms", "name":"International Films to Check Out", "tier":"stream", "url":"https://letterboxd.com/hotsake/list/international-films-to-check-out/"},
    {"key":"outragechannel", "name":"The Outrage Channel", "tier":"stream", "url":"https://letterboxd.com/fakeoutrage/list/everything-on-the-outrage-channel-1/"},
    {"key":"kodasusaka", "name":"Kodasusaka", "tier":"stream", "url":"https://letterboxd.com/hotsake/list/kodasusaka/"},
    {"key":"patomorto", "name":"Pato Morto", "tier":"dlslow", "url":"https://letterboxd.com/rogeriopg1976/list/pato-morto/"},
]

NAME_RE = re.compile(r'^(.*)\s+\((\d{4})\)\s*$')

def xref_key(title, year):
    t = unicodedata.normalize('NFC', title).lower()
    t = ''.join(c for c in t if c.isalnum())
    return t + '|' + year

films = {}   # key -> set(list index)
per_list = {}

for idx, L in enumerate(LISTS):
    path = os.path.join(OUT, L["key"] + ".tsv")
    n = 0
    if not os.path.exists(path):
        print(f"WARN missing {path}")
        per_list[L["key"]] = 0
        continue
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            name = html.unescape(parts[1])   # decode &#039; &amp; &quot; etc. before keying
            m = NAME_RE.match(name)
            if not m:
                continue   # no year → skip (can't match reliably)
            title, year = m.group(1), m.group(2)
            k = xref_key(title, year)
            if not k.split('|')[0]:
                continue
            films.setdefault(k, set()).add(idx)
            n += 1
    per_list[L["key"]] = n

# compact JSON: films maps key -> sorted list of indices
films_out = {k: sorted(v) for k, v in films.items()}

data = {
    "generated": datetime.date.today().isoformat(),
    "lists": LISTS,
    "films": films_out,
}

out_path = os.path.join(HERE, "lists-data.json")
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))

print("per-list rows:", per_list)
print("unique film keys:", len(films_out))
print("bytes:", os.path.getsize(out_path))
