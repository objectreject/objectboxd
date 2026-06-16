# objectboxd

A tiny web app that pulls a **random pick** from your [Letterboxd](https://letterboxd.com/) watchlist or any of your lists. Choose a source, hit **Spin**, watch the reel roll, and get a random film with its poster, title, and a link to the release on Letterboxd.

🎬 **Live:** https://objectreject.github.io/objectboxd/

## How it works

Letterboxd has no public API, so objectboxd fetches your public Letterboxd pages through a CORS proxy and parses them in the browser:

1. On load it reads `letterboxd.com/object_reject/lists/` to populate the dropdown (watchlist is always available).
2. When you spin, it finds how many pages the source has, picks a random page, then a random film on it.
3. It opens that film's page and grabs the poster (`og:image`) and title (`og:title`).

No build step, no backend — just static HTML/CSS/JS hosted on GitHub Pages.

## Configure for a different account

Change one line at the top of [`app.js`](app.js):

```js
const USERNAME = "object_reject";
```

## Notes

- Relies on free public CORS proxies (it tries several in order). If picks stop loading, a proxy may be rate-limited or down — wait a bit and retry.
- Only reads **public** Letterboxd data.

## Develop locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
