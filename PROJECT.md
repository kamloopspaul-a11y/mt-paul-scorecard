# PROJECT — Mt. Paul Card

*A standalone digital scorecard PWA for Mt. Paul Golf Course, Kamloops BC. Separate from the main Golf Scores app. Designed to be shared via link (GitHub Pages) and installed as a PWA on any phone.*

---

## Status

**Version:** v0.1 — GitHub Pages live, placeholder home page up (commit `d349c1a`, 2026-06-27). Real app code (`index.html`/`manifest.json`/`sw.js`) not built yet.
**Style exploration (parallel track, 2026-06-27):** In progress in `wip/style-refs/` — colour-wheel palettes, a Steadman-style ink illustration, and a landing-page concept using the "Hillside Haze" palette. Exploratory only; not committed, doesn't change the version number, doesn't replace the Design spec below unless Paul says so. See JOURNAL.md Session 4.
**Live URL:** https://kamloopspaul-a11y.github.io/mt-paul-scorecard/ — confirmed live (currently showing "Hello world" placeholder).
**GitHub repo:** `https://github.com/kamloopspaul-a11y/mt-paul-scorecard` — `main` branch has `CLAUDE.md`, `JOURNAL.md`, `PROJECT.md`, `.gitignore`, `index.html` (placeholder), and `assets/`.
**Local folder:** `~/Documents/Studio/Projects/ScoreCard/`

---

## Known Issues

- Git operations on this repo from the Cowork sandbox occasionally hit a stuck `.git/index.lock` (suspected iCloud-sync interference, since this folder lives inside the synced `~/Documents/Studio` tree — timing-based, not yet confirmed). Current approach: Claude pushes directly and tries to self-resolve locks; pushes are batched at checkpoints rather than per-edit to reduce collisions; Paul helps only if Claude gets stuck. See JOURNAL.md Session 3 (2026-06-27) for the full discussion — this is an experiment, not a settled fix.

---

---

## Repo Hygiene — Working Files

- Draft/working files (alternate UI versions, test scripts, anything mid-iteration during a UX-tweaking session) go in `/wip/` — gitignored, never committed.
- Nothing gets `git add`ed until Paul has reviewed it locally (in chat, or opened directly from `~/Documents/Studio/Projects/ScoreCard/wip/` in Chrome/Finder) and confirmed it's the version to keep.
- Once approved, the file is moved/renamed into its real tracked location (e.g. `index.html`) — that's what gets committed, not the draft.
- Goal: keep the GitHub repo clean — no abandoned experiments, no clutter from the iteration process. (Agreed with Paul 2026-06-27.)

## Vision

Phase 1 — Demo (build first):
- Digital scorecard PWA for Mt. Paul Golf Course
- Mt. Paul Blue tees only, 9 holes looped twice as 18
- Install landing page with device-specific instructions
- QR code poster for clubhouse / first tee
- "Book a Tee Time" button → Chronogolf URL
- GA4 usage tracking
- Co-branded with Mt. Paul logo

Phase 2 — Club Life (post demo approval):
- Driving range hours / info
- Lessons — Breaking Par contractor info + booking link
- Restaurant menu + hours
- Pro shop highlights

Phase 3 — Events & Community:
- Tournament calendar (Seniors Tue, Men's Wed, Ladies TBD)
- Skill prizes, door prizes, sponsor recognition
- Announcements / news feed (simple JSON file)
- Sponsor display

Platform play:
- Mt. Paul as pilot — template reusable for other Kamloops courses
- Each course gets own branding, QR codes, GA4 property, GitHub repo

---

## Core Spec

- Mt. Paul Golf Course — Blue tees only
- 9 holes looped twice = 18 holes, Par 64, 3,974 yards
- No player name entry — anonymous use
- No stats, no toggles, no settings, no analytics screen
- No Hole-in-One audio
- Scoring legend: birdie = circle, bogey = square, double bogey+ = blush pink cell
- End of round: combined scorecard (front + back), New Round button, Copy Scores button, Print button
- Scores persist via localStorage (survive back button, tab close)
- Full back-navigation through all 18 holes to edit any score

## Hole Data — Blue Tees

| Hole | Par | Yds | | Hole | Par | Yds |
|------|-----|-----|-|------|-----|-----|
| 1    | 4   | 275 | | 10   | 4   | 275 |
| 2    | 3   | 137 | | 11   | 3   | 137 |
| 3    | 3   | 179 | | 12   | 3   | 179 |
| 4    | 4   | 300 | | 13   | 4   | 300 |
| 5    | 3   | 95  | | 14   | 3   | 95  |
| 6    | 4   | 345 | | 15   | 4   | 345 |
| 7    | 3   | 135 | | 16   | 3   | 135 |
| 8    | 4   | 251 | | 17   | 4   | 251 |
| 9    | 4   | 270 | | 18   | 4   | 270 |

Par 32 front, Par 32 back, Par 64 total.

---

## PWA Spec

- Three files: `index.html`, `manifest.json`, `sw.js`
- Service Worker: cache-first after first install — fully offline capable
- `display: standalone` — hides browser chrome
- Theme colour: `#377f09` (Mt. Paul green)
- Icons: 192×192 and 512×512 PNG (TBD — placeholder or Mt. Paul branded)
- Updates propagate automatically on next connected open

---

## Design

- Spring Green palette from main Golf app: `#377f09` primary
- White logo on green masthead (logo PNG extracted, saved to assets/)
- Masthead: compact — logo at ~55px height, no wasted space
- Fixed layouts, no shifting elements (Paul's standard rule)
- No browser chrome when installed as PWA

**Style exploration note (2026-06-27):** A separate, exploratory colour direction — "Hillside Haze" (cream/khaki/olive analogous palette) — is being tried in a landing-page concept (`wip/style-refs/2026-06-27-ScoreCard-LandingPage.html`). This has NOT replaced the Spring Green spec above; nothing here is locked until Paul says so.

---

## Tee Time Integration

- Mt. Paul uses **Chronogolf** (owned by Lightspeed)
- Phase 1: simple link button → their Chronogolf public booking URL
- Phase 2 option: embed Chronogolf widget if they have one on their site
- Full API integration not realistic (requires Lightspeed enterprise partnership)

---

## Business Model (Pitch to Mt. Paul)

Decision maker: Dan Latin (owner) or pro shop staff.

Value proposition:
- Branded digital scorecard replaces paper cards
- QR poster at pro shop / first tee drives installs
- Booking shortcut drives traffic to Chronogolf
- GA4 monthly usage report: rounds tracked, unique users, peak days
- Expandable: restaurant, lessons (Breaking Par), tournaments, sponsors

Pricing options:
- One-time build fee: $500–$1,500
- Monthly maintenance: $50–$150/month
- Sponsor facilitation cut (future)

Template reuse: same build deployable to other Kamloops courses (Bighorn, Sun Peaks, etc.) with branding swap.

---

## Files in This Project

| File | Notes |
|------|-------|
| `PROJECT.md` | This file |
| `JOURNAL.md` | Session notes |
| `CLAUDE.md` | Claude context for future sessions |
| `assets/mt_paul_logo_vector.svg` | True vector logo (28 paths), transparent bg — sole logo asset, others deleted by Paul 2026-06-27 |
| `index.html` | Placeholder "Hello world" live — real app not yet built |
| `manifest.json` | PWA manifest — NOT YET BUILT |
| `sw.js` | Service Worker — NOT YET BUILT |
| `wip/courses.json` (draft, gitignored) | Mt. Paul-only course data (id 6, Blue + Red tees), trimmed from Golf's regional `courses.json` — awaiting Paul's review before moving into `assets/` |
| `wip/style-refs/2026-06-27-ScoreCard-ColourWheelPalettes.png` (draft, gitignored) | 4 colour-wheel palettes extracted from reference photos — too muted per Paul, may be redone from `wip/Hole-Layout-Sketch.webp` / `wip/Colour-Palette-Sample-03.jpeg` |
| `wip/style-refs/2026-06-27-ScoreCard-SteadmanGolferIllustration.png` (draft, gitignored) | Monochromatic ink illustration of a golfer + original Steadman-style splatter, used as a design reference |
| `wip/style-refs/2026-06-27-ScoreCard-LandingPage.html` (draft, gitignored) | Landing-page style concept using the "Hillside Haze" palette — concept only, not the production `index.html` |

Note: `assets/mt_paul_logo_transparent.png`, `.af`, and `.svg`, plus `assets/files.zip`, were deleted by Paul via Finder 2026-06-27 (the .png/.af were the raster source/working files for the now-superseded trace; the .svg was confirmed not a true vector). `mt_paul_logo_vector.svg` is the only remaining — and only needed — logo asset.
