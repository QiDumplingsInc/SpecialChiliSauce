# ARQ-45 tier 2: Exhibitions, Work on Paper and the unrepresented media

Before/after screenshots for the five remaining placeholder surfaces in the gallery. Before is the branch this work was cut from (`feature/arq-45-backfill-section-pages` at `a2648b9`); after is this branch. Both were rendered in headless Chrome against the generated `gallery-*.html`, then downscaled to JPEG for the repository.

| Surface | Before | After | What changed |
| --- | --- | --- | --- |
| Exhibitions | `before-exhibitions.jpg` | `after-exhibitions.jpg` | "Content coming soon" becomes seven hang scenes built from the 11 in-situ photographs already in the catalogue, each with the works visible in it cross-linked to the page that shows them. |
| Work on Paper | `before-work-on-paper.jpg` | `after-work-on-paper.jpg` | Empty state becomes the one drawing, reached through the new `support` field rather than a second catalogue entry. |
| Sculpture (and Photography, Printmaking, Mixed Media) | `before-sculpture.jpg` | `after-sculpture.jpg` | One grey line of empty state becomes a written bilingual page and a commission enquiry link. |
| Hub: Explore by Medium | `before-hub-media.jpg` | `after-hub-media.jpg` | Work on Paper now shows a photograph; the four unrepresented cards read "Not yet represented" instead of "No works yet". The About panel states what is true instead of promising a journey "coming soon", and points at the Artists page that now carries it. |
| Hub: lower page | `before-hub-video.jpg` | `after-hub-video.jpg` | The "Recent Video Features / Video coming soon" dashed panel is gone. There is no video to put in it, so the section goes until there is one; restoring it is one commit plus its two style rules. |
