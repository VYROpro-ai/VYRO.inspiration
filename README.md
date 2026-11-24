# Seesaw — Design Inspiration Directory

A category-wise directory of every site featured on
[Seesaw](https://www.seesaw.website/) — *"The best web design inspiration.
Browse the best of the internet, hand-picked and updated daily."*

Static site, no build step, no tracking. Host it anywhere static files work
(GitHub Pages, Netlify, Vercel…).

## What is here

| File | What it is |
|---|---|
| `index.html` | Page shell: header, search, sticky category bar, card grid, footer |
| `style.css` | Baked.design-inspired light UI — off-white `#FAFAF7`, white 24px-radius cards, black pill buttons, small grey uppercase labels |
| `app.js` | Loads `data.json`, renders categories + search + cards |
| `data.json` | All data: 14 categories (All + 13), **912 distinct sites**, **1,188 category cards** |
| `_parts/` | Working files: the raw per-slice `sites-*.json` extracts from `sites.json` and per-category `cat-*.json` membership lists |

## Counts (snapshot 2026-11-24)

| Category | Sites |
|---|---|
| All (distinct sites) | 912 |
| Agency | 76 |
| AI | 238 |
| Crypto | 96 |
| Design | 184 |
| Design Tools | 36 |
| Developer Tools | 102 |
| E-Commerce | 44 |
| Fintech | 104 |
| Hardware | 59 |
| Marketing | 31 |
| Portfolios | 69 |
| Productivity | 121 |
| Social | 28 |

Total across the 13 categories: **1,188 cards** — sites appear in more than one
category, which is how Seesaw organises them.

### Count notes (honest shortfalls vs Seesaw's live counts)

The category pages as returned by Seesaw's text crawl list slightly fewer
entries than the live site's own counts (expected 1,266 cards in total):
AI 238 vs 271 (−33), Design 184 vs 197 (−13), Agency 76 vs 81 (−5),
Crypto 96 vs 101 (−5), Productivity 121 vs 128 (−7), Hardware 59 vs 62 (−3),
Design Tools 36 vs 38 (−2), E-Commerce 44 vs 46 (−2), Fintech 104 vs 106 (−2),
Marketing 31 vs 32 (−1), Portfolios 69 vs 72 (−3). Developer Tools (102 vs 104)
and Social (28) are within 2 of expected. The shortfall is in what the
category pages returned, not in transcription — every entry the pages listed
was captured, and **0 entries are unmatched** (every card has a real link and
preview image from `sites.json`).

A handful of cards are repeat listings of the same site with a different
version/description (e.g. Morpho, Patagon Markets, June, Sol) — kept as
separate cards, as on Seesaw. Exact duplicate cards inside one category were
removed.

## How it works

- `app.js` fetches `data.json` (relative path) and renders a sticky category
  bar with per-category counts, a search box (filters title + description in
  the active category), and a responsive card grid.
- Each card shows the site's preview image (`ogImg` from Seesaw — mostly
  `media.seesaw.website/og/…`; ~242 older entries still use Seesaw's original
  `uploads-ssl.webflow.com` og image), title and description.
- **Hover:** the preview blurs + darkens + scales slightly, and a black pill
  **"View Website ↗"** button fades in centred over the image.
- **Click anywhere on a card** opens the live site in a new tab
  (`target="_blank"`, `rel="noopener"`).
- Images are lazy-loaded, with a neutral `SEESAW ✦` placeholder if one fails.

## Run locally

```bash
cd seesaw-directory
python3 -m http.server 8000
# open http://localhost:8000
```

(`file://` works for the page shell, but `fetch('data.json')` is blocked by
some browsers from `file://`, so serve over HTTP.)

## Deploy (GitHub Pages)

Push this folder to a repo and enable Pages (branch deploy, root). No build
step — `index.html` + `data.json` + `style.css` + `app.js` is the whole site.

## Source & credit

All titles, descriptions, links and preview images come from
https://www.seesaw.website/ (`sites.json` + the 13 `/category/<slug>` pages),
snapshot 2026-11-24. The directory links back to Seesaw in its footer.
