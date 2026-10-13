# Refreshing the "what can i watch" list snapshot

`lists-data.json` (in the repo root) is a frozen snapshot of the 7 followed
Letterboxd lists, used by the **what can i watch** view to cross-reference the
uploaded watchlist. To refresh it when those lists change:

```bash
cd tools
./scrape-lists.sh        # curls every page of all 7 lists -> tools/out/*.tsv (a few min)
python3 build-lists-data.py   # merges + dedups -> tools/lists-data.json
cp lists-data.json ../lists-data.json   # move into repo root
```

Then bump the `?v=` query on the `lists-data.json` fetch in `app.js` (optional,
for cache-busting) and commit + push.

## The lists (edit in both files to add/remove)
Defined in `scrape-lists.sh` (the `lists=(...)` array) and
`build-lists-data.py` (the `LISTS` list — keep the same order/keys). Each entry
has a `tier`: `stream`, `dlfast`, or `dlslow`. A matched film is shown in its
best available tier; a film only on `dlslow` lists gets the "start ahead" flag.

Matching is by `alnum(lowercased title) + "|" + year`, computed identically in
`build-lists-data.py` (`xref_key`) and `app.js` (`xrefKey`).
