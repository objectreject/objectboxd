#!/bin/bash
# Scrape membership (slug + "Title (YYYY)") from each Letterboxd list into a TSV.
# No HTML saved; curl -> perl -> tsv. Polite delay between requests.
set -uo pipefail
OUT="$(dirname "$0")/out"
mkdir -p "$OUT"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

# key|user|listslug|lastpage|tier
lists=(
"ubuweb|j__e__r__m|ubuweb-master-list|26|stream"
"oedipus|shenanigance|oedipus-rex-upload|22|stream"
"zenxiu|zenxiu|zen-xiu|55|stream"
"japanokru|fabianpena|japanese-movies-uploaded-to-okru|3|stream"
"solidarity|solidaritycine|solidarity-cinema-archive|108|dlfast"
"rarefilmm|rhettman417|movies-on-rarefilmmcom|39|dlslow"
"worldscinema|kordian86|films-featured-on-worldscinemaorg|278|dlslow"
"internetarchive|_pigsty|internet-archive|252|stream"
"pompoarismo|pompoarism0|acervo-pompoarismo|16|stream"
"intlfilms|hotsake|international-films-to-check-out|84|stream"
"outragechannel|fakeoutrage|everything-on-the-outrage-channel-1|11|stream"
"kodasusaka|hotsake|kodasusaka|48|stream"
"patomorto|rogeriopg1976|pato-morto|140|dlslow"
"rarelust_a|owmylawd|rarelust|64|dlslow"
"rarelust_b|ooopha|rarelust-completeish-list|167|dlslow"
)

for entry in "${lists[@]}"; do
  IFS='|' read -r key user slug last tier <<< "$entry"
  : > "$OUT/$key.tsv"
  for ((p=1;p<=last;p++)); do
    if [ "$p" -eq 1 ]; then
      url="https://letterboxd.com/$user/list/$slug/"
    else
      url="https://letterboxd.com/$user/list/$slug/page/$p/"
    fi
    curl -s --compressed -A "$UA" "$url" \
      | perl -ne 'while(/data-item-name="([^"]*)" data-item-slug="([^"]*)"/g){print "$2\t$1\n"}' \
      >> "$OUT/$key.tsv"
    sleep 0.3
  done
  echo "$key done: $(wc -l < "$OUT/$key.tsv" | tr -d ' ') films"
done
# Rarelust is one source split across two lists → combine into rarelust.tsv
cat "$OUT/rarelust_a.tsv" "$OUT/rarelust_b.tsv" > "$OUT/rarelust.tsv" 2>/dev/null
echo "ALL DONE"
