# JOURNAL — Mt. Paul Card

---

## Session 1 — 2026-06-25

### What we did

Started from a conversation about shareable Artifacts and interactive tools. Explored options — options calculators, oracle tools — before landing on a focused, practical idea: a standalone digital scorecard PWA for Mt. Paul Golf Course.

The idea came from a real problem: arriving at the 2nd tee box and realizing nobody grabbed a paper scorecard. Paul wants to be able to text Dave (golf friend, also plays Mt. Paul) a link to the app so they can each keep their own score on their phones.

### Key decisions made

**Scope — what's IN:**
- Mt. Paul Blue tees only
- 9 holes looped twice = 18 holes
- Hole-by-hole counter (− / score / +)
- Par and yardage shown per hole
- Nav dots for progress, Back/Next buttons
- Front 9 scorecard after hole 9
- Full combined scorecard after hole 18
- Birdie = circle, bogey = square, double bogey+ = blush pink cell shading
- Scores persist via localStorage
- Full back-navigation to edit any hole
- End screen: New Round, Copy Scores, Print buttons
- No player name entry

**Scope — what's OUT:**
- Stats, toggles, analytics
- Multiple courses
- Settings screen
- Hole-in-One audio
- Player name / profiles
- Backend / Apps Script

**PWA:**
- Three files: index.html, manifest.json, sw.js
- GitHub Pages hosting (new repo — separate from golf-scores)
- Local folder: ~/Documents/Studio/Projects/MtPaulCard/
- Service Worker caches everything on first visit — fully offline after that
- Updates push automatically on next connected session

**Install flow:**
- iOS: Safari → Share → Add to Home Screen
- Android: Chrome → three-dot menu → Add to Home Screen
- Install landing page planned (Phase 1) to make this painless

**End of round:**
- Combined scorecard (front + back on one screen)
- Print to PDF via browser print dialog (user's choice)
- Copy scores to clipboard as plain text
- New Round button clears and returns to Hole 1

### Business angle explored

Mt. Paul uses Chronogolf for tee time booking. Phase 1: link button to their booking URL. Phase 2: embed their widget if available.

Full product vision mapped out:
- Phase 1: scorecard + install page + QR poster + Chronogolf link + GA4
- Phase 2: driving range, lessons (Breaking Par), restaurant menu, pro shop
- Phase 3: tournament calendar, sponsors, announcements

Platform play: template reusable for other Kamloops courses. Each gets own branding, QR codes, GA4, GitHub repo.

Decision maker at Mt. Paul: Dan Latin (owner) — or pro shop staff.

### Logo

Original Mt. Paul logo PNG uploaded (white on black, 886×330, RGBA).
Python/PIL used to extract white logo with transparent background.
Saved to: `assets/mt_paul_logo_transparent.png`
Use with CSS `mix-blend-mode` or directly on green background.
To be used with permission — placeholder for demo, discuss with club before going live.

### What's NOT built yet

- index.html
- manifest.json  
- sw.js
- Install landing page
- QR code poster
- PWA icons (192×192, 512×512)

### Next session — pick up here

1. Create GitHub repo `mt-paul-scorecard`
2. Build `index.html` — full 18-hole scorecard app
3. Build `manifest.json`
4. Build `sw.js`
5. Deploy to GitHub Pages
6. Test PWA install on phone
7. Share link with Dave as first real-world test

Upload to next session: `PROJECT.md`, `JOURNAL.md`, `CLAUDE.md`

---

## Session 2 — 2026-06-27

### What we did

Converted the Mt. Paul logo into a true vector SVG (previous export was a raster PNG wrapped in an SVG container, not real vector paths).

- Affinity Photo 2 could only re-export the PNG inside SVG XML (no real tracing) — confirmed via byte-comparison that the embedded image was identical to the source PNG.
- Installed the new free "Affinity" app (by Canva, v3.2.2) to get access to true Image Trace in Vector Studio.
- Traced `mt_paul_logo_transparent.png` → 29 vector paths, exported as `assets/mt_paul_logo_vector.svg` (18 KB vs. 107 KB for the old raster-wrapped version).
- Found and removed a faint full-canvas artifact path (4% opacity near-black rectangle) that the trace algorithm added — without the fix it would have shown as a slight grey haze on a green background. Verified the cleaned file renders with true alpha=0 transparency outside the logo shapes.
- Confirmed visually on simulated green and white backgrounds — clean edges on green, as expected (logo is white-only, so it's invisible on white — same as the original PNG, not a regression).

### Files

- `assets/mt_paul_logo_vector.svg` — true vector, transparent background (new, primary logo asset going forward)
- `assets/mt_paul_logo_transparent.svg` — old raster-wrapped export, kept for reference, not a true vector
- `assets/mt_paul_logo_transparent.png` — original source, unchanged

### Next session — pick up here

Logo asset work is done. Resume the PWA build:
1. Create GitHub repo `mt-paul-scorecard`
2. Build `index.html` — full 18-hole scorecard app
3. Build `manifest.json`
4. Build `sw.js`
5. Deploy to GitHub Pages

Upload to next session: `PROJECT.md`, `JOURNAL.md`, `index.html`
---

## Session 3 — 2026-06-27

### What we did

Set up GitHub infrastructure for the PWA build.

- Created GitHub repo `mt-paul-scorecard` (kamloopspaul-a11y account, public).
- Generated a fine-grained GitHub PAT (`GITHUB_PAT_SCORECARD`, Contents: Read/write, expires 2026-12-31) — stored in `~/.studio-claude/claude-config`.
- Initialized local git repo. Hit a quoting bug: ran `cd "~/Documents/Studio/Projects/ScoreCard"` with the tilde inside quotes, which doesn't expand — commands silently ran in the sandbox home directory instead. Cleaned up the stray `~/.git` and `~/README.md` this created, then re-ran unquoted and confirmed the repo initialized in the correct folder.
- Set `origin` to `https://github.com/kamloopspaul-a11y/mt-paul-scorecard.git` — confirmed no embedded token (unlike Golf/Health/SmartCart's sandbox-pat remotes); push auth from this sandbox is not yet wired for this repo.
- Initial commit (`ed32147`) only contains GitHub's default `README.md` — `CLAUDE.md`, `JOURNAL.md`, `PROJECT.md`, and `assets/` are still untracked locally and have not been pushed.

In parallel, this session also did Studio-wide credential housekeeping (relocated `.claude-config`/`.fsri-config` out of the iCloud-synced `~/Documents/Studio` tree to `~/.studio-claude/`) — relevant to ScoreCard only insofar as `GITHUB_PAT_SCORECARD` now lives at `~/.studio-claude/claude-config` rather than an in-tree config file.

### Known gaps (carried to next session)

- No `.gitignore` — `.DS_Store` and similar should be excluded before the next commit.
- GitHub Pages not yet enabled on the repo.
- Push auth not wired — sandbox can't push to `origin` yet (no token embedded in the remote URL). Either embed `GITHUB_PAT_SCORECARD` in the remote (matching the Golf/Health/SmartCart pattern) or Paul pushes manually via Terminal/GitHub Desktop.
- Untracked project files (`CLAUDE.md`, `JOURNAL.md`, `PROJECT.md`, `assets/`) need `git add` + commit once `.gitignore` is in place.
- A `.git/index.lock` permission warning appeared during a `git status` check this session ("unable to unlink ... Operation not permitted") — didn't block the command, but worth a clean re-check next session in case it's related to the same EPERM tool quirk affecting some project files (see Studio `TODO_LIST.md`).

### Next session — pick up here

1. Add `.gitignore` (`.DS_Store`, etc.)
2. Stage and commit the untracked project files
3. Wire push auth (embed PAT in remote, or confirm Paul will push manually)
4. Enable GitHub Pages
5. Resume the PWA build itself: `index.html`, `manifest.json`, `sw.js` — still not started
