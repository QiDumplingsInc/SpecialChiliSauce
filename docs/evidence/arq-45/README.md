# ARQ-45 follow-up: backfill New Arrivals, Portfolio and Artists

These before/after screenshots show the three gallery section pages that the board reported as still empty, before and after this change.

Before shows the shipped stub ("New work coming soon" / "Content coming soon"). After shows the page rebuilt from the real catalogue (`content/artworks.json`) through the same generated-HTML build pipeline the rest of the gallery uses.

| Page | Before | After |
| --- | --- | --- |
| New Arrivals | `before-new-arrivals.jpg` | `after-new-arrivals.jpg` |
| Portfolio | `before-portfolio.jpg` | `after-portfolio.jpg` |
| Artists | `before-artists.jpg` | `after-artists.jpg` |

What each page now renders:

- New Arrivals: the recent works, newest first (Red Grapes 2024, Rockfish 2024, Figs 2023, Pears 2022, Tomatoes on the Vine 2020), driven by an editorial `newArrivalsPage.artworkIds` order.
- Portfolio: the whole catalogue grouped by medium (Painting 16, Drawing 1), derived from `mediumPages`.
- Artists: a profile of Kay with a cover, a three-paragraph bilingual bio, and the full body of work below it.

Screenshots were captured from the branch build (headless Chrome against the generated `gallery-*.html`), then downscaled to JPEG for the repository.
