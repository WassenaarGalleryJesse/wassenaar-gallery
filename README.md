# Wassenaar Gallery

The website for Handelshuis Wassenaar on **wassenaargallery.com**: a calmer, easier way to
walk through the collection that is for sale on 1stDibs. Nothing is sold here. Every piece
links to its 1stDibs page, where buying, offers and questions happen.

It is a plain static site: one HTML page, one stylesheet, one script, self-hosted fonts and a
JSON feed. No framework, no build step, no database, no cookies.

```
index.html                 the page
assets/site.css            design
assets/app.js              filters, piece view, shortlist
assets/fonts/              Newsreader + Instrument Sans (OFL, self-hosted: no Google requests)
data/listings.json         the collection (generated, do not edit by hand)
data/curation.json         hand-picked pieces for the homepage (edit freely)
data/details.json          descriptions and extra photos, loaded on demand (generated)
```

## Run it locally

```bash
python3 -m http.server 4173
```

Then open http://localhost:4173.

## Where the collection comes from

`data/listings.json` and `data/details.json` are generated from our own listing records and
committed here; nothing on this site reads from 1stDibs. Prices are the euro list prices.
Dollar and pound amounts are approximate conversions at the daily ECB reference rate and are
shown with "≈"; the 1stDibs page always has the exact amount.

`listings.json` holds what the page needs straight away:

```json
{
  "generated": "ISO date", "count": 1181,
  "fx": { "source": "ECB", "date": "2026-09-28", "USD": 1.1378, "GBP": 0.85785, "approximate": true },
  "rooms": [{ "id": "lighting", "label": "Lighting" }],
  "eras":  [{ "id": "1900", "label": "1900–1940" }],
  "items": [{
    "id": "f_52205512", "title": "…", "subtitle": "circa 1920", "rawTitle": "…",
    "url": "https://www.1stdibs.com/id-f_52205512/",
    "room": "lighting", "kind": "Chandeliers & pendants",
    "price": { "EUR": 6900, "USD": 7851, "GBP": 5919 },
    "images": ["https://…jpg", "https://…jpg"],
    "year": 1920, "date": "circa 1920", "era": "1900", "period": "Early 20th Century",
    "origin": "Italy", "style": "Art Deco", "maker": null, "materials": ["Alabaster"],
    "dimensions": { "cm": "H 56 × Ø 50 cm", "in": "H 22 × Ø 19.5 in" },
    "condition": "Good", "onHold": false, "sold": false, "order": 0
  }]
}
```

`details.json` is loaded when someone opens a piece or starts searching:
`{ "f_52205512": { "description": "…", "conditionNotes": "…", "images": ["…", "… up to 8"] } }`

Both files are public. They may only contain what a buyer can already see on the 1stDibs
listing; internal references, net prices, notes, and anything about customers or orders never
belong in them. Image URLs must accept a `?width=` parameter, or the site's `imgUrl()` helper
in `assets/app.js` needs a small change for self-hosted images.

## Choosing pieces for the homepage

Edit `data/curation.json` with 1stDibs ids (the `f_…` number at the end of a listing URL):

| Key      | What it controls                                             |
|----------|--------------------------------------------------------------|
| `salon`  | the five pieces in the opening composition (first = largest) |
| `reel`   | the lights in the dark "lighting room" band                  |
| `rooms`  | the picture that follows the cursor per category             |
| `eras`   | the object standing on the shelf per era                     |

Sold or missing pieces are skipped automatically; the site then chooses one itself.
Cut-out photos (white background) work best. The About photo is `assets/img/about.jpg`.

## Publish it for free on wassenaargallery.com

Hosted on **GitHub Pages**: free, with automatic HTTPS. DNS stays with the registrar, so the existing mail records aren't touched.

1. This repository is public, as free GitHub Pages requires; everything in it is already
   public on 1stDibs.
2. Repository → Settings → Pages → *Deploy from a branch* → `main` / `(root)`.
   Custom domain: `wassenaargallery.com` (the `CNAME` file already says so). Tick
   *Enforce HTTPS* once the certificate is issued.
3. In the **DNS settings at the registrar** for wassenaargallery.com, **add** these records and remove any
   existing A/AAAA/CNAME records for `@` and `www` (for example a parking page):

   | Type  | Name | Value                    |
   |-------|------|--------------------------|
   | A     | @    | 185.199.108.153          |
   | A     | @    | 185.199.109.153          |
   | A     | @    | 185.199.110.153          |
   | A     | @    | 185.199.111.153          |
   | AAAA  | @    | 2606:50c0:8000::153      |
   | AAAA  | @    | 2606:50c0:8001::153      |
   | AAAA  | @    | 2606:50c0:8002::153      |
   | AAAA  | @    | 2606:50c0:8003::153      |
   | CNAME | www  | `wassenaargalleryjesse.github.io.` |

   **Leave the MX, SPF (TXT), DKIM and other verification records exactly as they are.**
   Those carry the domain's email.
4. Optional but recommended: verify the domain under your GitHub *account* settings →
   Pages, which adds one TXT record and stops anyone else from claiming the domain on GitHub.

Alternative: **Cloudflare Pages** (also free: private repositories, unlimited bandwidth, and
free cookieless analytics). It is only worth it if you move the domain's nameservers to
Cloudflare, which means re-creating the mail records there. That's more work and more
risk for mail, so choose it deliberately. The `_headers` file is for this route.

Running costs: €0 beyond the domain registration. Photos load from the
1stDibs image servers, so the site itself is tiny.
