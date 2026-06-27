# CLAUDE.md — Mt. Paul Card

*Context file for Claude. Upload this along with PROJECT.md and JOURNAL.md at the start of each session.*

---

## What this project is

A standalone PWA digital scorecard for Mt. Paul Golf Course, Kamloops BC. Completely separate from Paul's main Golf Scores app (`golf-scores` repo). Shareable via link — no account required, no backend, no Apps Script.

## Who it's for

- Dave (Paul's golf friend at Mt. Paul) — first real-world user
- Other Mt. Paul golfers — shared via text or QR code at the clubhouse
- Eventually: pitch to Mt. Paul clubhouse as a branded companion app

## Paul's design rules (always apply)

- Fixed layouts — no shifting elements between screens
- Compact mastheads — logo at ~55px height, no wasted real estate
- Consistent font sizes across equivalent elements
- No leaderboard, no multi-player
- Visual stability is a meaningful UX concern

## Tech stack

- Pure HTML/JS — single `index.html` file
- No framework, no build tools
- `manifest.json` + `sw.js` for PWA
- GitHub Pages hosting
- `localStorage` for score persistence
- No backend, no API calls, no Apps Script

## Colour / branding

- Primary green: `#377f09`
- White logo on green masthead
- Logo PNG: `assets/mt_paul_logo_transparent.png` (white, transparent bg)
- Logo used with placeholder permission for demo — confirm with Dan Latin (owner) before going live

## Course data — hardcoded in index.html

Mt. Paul Golf Course, Blue tees, 9 holes looped twice as 18. Par 64, 3,974 yards.

Holes 1–9 (same as 10–18):
1: Par 4, 275 yds
2: Par 3, 137 yds
3: Par 3, 179 yds
4: Par 4, 300 yds
5: Par 3, 95 yds  ← NOTE: new tee box coming, yardage TBD
6: Par 4, 345 yds
7: Par 3, 135 yds
8: Par 4, 251 yds
9: Par 4, 270 yds

## Scoring legend

- Birdie (−1): circle around score
- Par: plain
- Bogey (+1): square box around score
- Double bogey+ (≥+2): blush pink cell background
- Eagle or better: double circle (optional — Mt. Paul is all par 3s and 4s, eagle rare)

## What's built

- Logo PNG extracted (assets/)
- PROJECT.md, JOURNAL.md, CLAUDE.md

## What's NOT built yet

- index.html
- manifest.json
- sw.js
- Install landing page
- QR code poster
- PWA icons

## Next session — start here

1. Create GitHub repo `mt-paul-scorecard` (public, separate from `golf-scores`)
2. Build index.html
3. Build manifest.json + sw.js
4. Deploy to GitHub Pages
5. Test PWA install on phone
6. Share with Dave

## Key references

- Main Golf app: `~/Documents/Studio/Projects/Golf/` — do NOT modify
- This project: `~/Documents/Studio/Projects/MtPaulCard/`
- courses.json reference copy in `assets/` — Mt. Paul is ID 6 (Blue tees)
- Chronogolf booking: ask Paul for Mt. Paul's public Chronogolf URL next session
