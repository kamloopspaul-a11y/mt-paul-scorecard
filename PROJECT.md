# PROJECT — Mt. Paul Card

*A standalone digital scorecard PWA for Mt. Paul Golf Course, Kamloops BC. Separate from the main Golf Scores app. Designed to be shared via link (GitHub Pages) and installed as a PWA on any phone.*

---

## Status

**Version:** v0.1 — Planning + GitHub repo set up. App code (`index.html`/`manifest.json`/`sw.js`) not built yet.
**Live URL:** TBD — GitHub Pages not yet enabled.
**GitHub repo:** `https://github.com/kamloopspaul-a11y/mt-paul-scorecard` — created 2026-06-27. Initial commit contains only GitHub's default README; project files not yet pushed (see Known Issues).
**Local folder:** `~/Documents/Studio/Projects/ScoreCard/`

---

## Known Issues

- No `.gitignore` yet.
- GitHub Pages not enabled.
- Push auth not wired from the sandbox (remote has no embedded token) — Paul pushes manually via Terminal for now.
- `CLAUDE.md`, `JOURNAL.md`, `PROJECT.md`, `assets/` are untracked locally — not yet committed or pushed.

---

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
| `assets/mt_paul_logo_vector.svg` | True vector logo (29 paths), transparent bg — primary asset |
| `assets/mt_paul_logo_transparent.png` | Original raster source, white logo, transparent bg |
| `assets/mt_paul_logo_transparent.svg` | Old raster-wrapped export, kept for reference only — not a true vector |
| `assets/courses.json` | Full Kamloops course seed data (reference) |
| `index.html` | Main app — NOT YET BUILT |
| `manifest.json` | PWA manifest — NOT YET BUILT |
| `sw.js` | Service Worker — NOT YET BUILT |
