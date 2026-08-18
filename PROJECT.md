# PROJECT — A Bit of Bogey

*A standalone digital golf scorecard + stats PWA for Mt. Paul Golf Course, Kamloops BC. Separate from Paul's main Golf Scores app. Distributed via link/QR code, installed as a PWA on any phone. Formerly prototyped under the working name "Mt. Paul Card"/"ScoreCard" — renamed and rebuilt from scratch 2026-07-23 (the old Spring Green concept was carried into `Projects/Golf` instead; this project is the new, separate build).*

---

## Status

**Version:** v1.0 — functional, verified in a real browser (Chrome, local dev server). Commit history is in git; this file does not track it.

**Analytics settled 2026-07-27.** Sixteen sections down to fourteen. The rule Paul set: *if no governing body defines it, it doesn't get a chart.* FIR, GIR, scrambling, putt distribution, score bands and the WHS handicap survive on that test; Score by Day of Week, Monthly Scoring Trend, 1 Putts and Penalty Impact were removed (all four kept in code, out of the render chain). "Hole Ratings" became "Strokes per Hole" for the same reason — the name implied a WHS quantity that doesn't exist.

**Every rendered figure has been verified** against the raw rounds, independently of `stats.js` — including Net/Course Handicap, which was previously unverified. The arithmetic is sound throughout. The problems found were in what labels claimed, not what the maths did.

**Membership ROI is the open area.** The ledger must wipe each 1 January (Paul, 2026-07-27) and currently does not — a season with no fees on file silently inherits the previous year's fee, round count and savings. A field for rounds played before install is specced and not built. See `JOURNAL.md` "NEXT SESSION".
**Live URL:** https://kamloopspaul-a11y.github.io/mt-paul-scorecard/ — confirmed serving the real build 2026-08-10 (title "A Bit of Bogey", theme `#8C2E39`). The old placeholder is gone.
**GitHub repo:** `https://github.com/kamloopspaul-a11y/mt-paul-scorecard`.
**Local folder:** `~/Documents/Studio/Projects/ScoreCard/`.

### What's built
- **Onboarding → Setup/Settings → Home** flow, with a Mt. Paul film-poster-style onboarding screen.
- **Live 18-hole (or 9-hole) scoring**: real stroke counter, FIR/GIR/PEN/UD toggles (FIR shown on every hole including par-3s, per owner decision 2026-07-23), putts counter, per-hole crash-resilient localStorage writes.
- **Quit logic**: discards rounds under 9 holes, saves 9+ holes as a pending nine-hole record.
- **Nine-hole pairing**: a later front/back nine automatically pairs with a waiting widow into a full 18-hole record; a same-half replay abandons the old widow rather than faking a pairing.
- **Final Score → Save**: builds and appends a real round record to `rounds-history` in localStorage.
- **Analytics/Reports screen**: Season Stats, Score Distribution, WHS-style Handicap Index (best-8-of-20 differentials × 0.96, truncated), 20-Round Average, per-hole Hole Ratings, Scrambling/Putting/Penalty splits, Weekly Trends (real-calendar-anchored, gated to 2+ rounds, with a one-time grow-in animation on a newly-revealed week), Today's Stats (gated to 1+ round), Membership ROI (cumulative savings + rounds-to-break-even, gated on Settings having real fee values).
- **Settings screen**: name, dark/light mode (instant toggle), tee (Blue/Red), stats visibility, Membership Fee, Green Fees, a live weather readout (Open-Meteo, no key required), and a visible-but-disabled "Export Scores" row (CSV export/import is an explicitly deferred later phase — see below).
- **Bar & Grill Menu screen**: the clubhouse's printed food and drink menu as a read-only reference page, reachable from the slide-out menu on every topbar. Thirteen groups (Breakfast through Draft on Tap), 75 priced items plus the two-across extras grids and the Pints/Jugs draft table. Content lives in `js/bar-menu.js` as data, not markup, so a price change is a one-token edit; the screen function only supplies the wrapper, topbar and the way out. Prices are stored without the dollar sign and rendered with one, so no row can drift into a different format. Layout follows the printed sheet (name left, price right, italic description under); type and colour come from this app's tokens, not the print piece's faces.
- **PWA/offline**: `manifest.json` (GitHub-Pages-subpath-correct `start_url`/`scope`), a cache-first, versioned `sw.js` precaching the full app shell, real icon set.
- **Architecture**: multi-file (`index.html` + `css/styles.css` + `js/*.js` ES modules), not a single-file app. Data-layer modules (`round-record.js`, `settings-record.js`, `stats-defaults.js`) came verbatim from the design handoff and are considered stable/correct — don't rewrite their logic, only the app shell/UI around them.
- **Pass 6 additions (2026-07-24 — real bugs found on the live build)**: Stats Console rebuilt field-for-field from `Design Handoff/Stats Counter.dc.html` (the FIR/GIR/PEN/UD rocker track is always `rgba(0,0,0,.4)`, only the knob moves/recolors, labels dim/brighten, Putts redesigned as arrow/box/arrow with a Spline Sans Mono digit); logo forced black in Light Mode (`brightness(0)` filter); a real slide-out hamburger menu (Analytics/Play Round/Settings) available from every topbar; putts now default to 2, not 0; every hole 2-18 has both Back and Next (Hole 10's Back goes to the new Front 9 Score screen instead of Hole 9); a new Front 9 Score mid-round scorecard screen after Hole 9 (Continue/Quit toggle for an 18-hole session in flight, Post Now for a standalone 9-hole session); shared `scoreCellHTML()` birdie/bogey/double-bogey+ cell styling on both Final Score and Front 9 Score. See `JOURNAL.md` Session 10 for full detail.

### Settled — do not re-open

Closed decisions. Each carries who decided and why. If you find yourself about to raise one of
these again, don't: the reason is here, and re-litigating it costs Paul time he has already spent.

| Decision | Closed | Why |
|---|---|---|
| Score Distribution bands stay as they are | 2026-08-10, Paul | The bands suit our level of play. The 40%-in-the-top-bucket observation is not a defect. |
| Membership ROI ledger work is parked | 2026-08-10, Paul | ROI will be seeded with real rounds before Dave gets it. The 1-January wipe spec stays in `JOURNAL.md`, unbuilt, on purpose. |
| Analytics section list is final at fourteen | 2026-07-27, Paul | The rule: if no governing body defines it, it doesn't get a chart. Four sections were cut on that test and kept in code, out of the render chain. |
| Deep Analytics waits for twenty rounds | 2026-07-26, Paul | "Are there 20 rounds yet, yes-then render, no-stay hidden." Below that the windows aren't full and a "20 round" heading would be describing three. |
| FIR shows on every hole, including par-3s | 2026-07-23, Paul | Owner decision. |
| The app is not developed for desktop browsers | 2026-08-10, Paul | The target is an installed PWA. Chrome on the dev server is a build convenience, not the bar. |
| Safari on iOS is the routine test; no PWA build per session | 2026-08-10, Paul | Paul tests changes in Safari and only chases what looks wrong. Installing after every session costs time and reveals nothing new. Do not ask him to install to verify ordinary changes. |
| "Captions in three registers" is dropped | 2026-08-10 | Carried in notes for weeks with no statable test. Nobody could say what would close it, so it should never have been written down. |
| Pushes are batched to end of session | 2026-08-10, Paul | Per-edit pushes make the Pages redeploy wait dominate the session. |

### Open — each with the test that closes it

Nothing goes on this list without a test. If the test can't be written, the item isn't real yet
and doesn't belong in this file.

| Open item | Closed when |
|---|---|
| One-time install pass never done | Routine testing is Safari on iOS and that is correct — it covers layout, copy, colours, flow, fonts and dark mode. Installing to the home screen reveals only three things and is done **once**, before Dave gets the link: nothing hides under the notch or home indicator, the icon opens to the right screen, and the app still works with the network off. Share-sheet testing waits until CSV export exists. |
| Post-onboarding landing screen undecided | Paul says Home or Settings for a first-time finish. Nothing to build until then. |
| Best Round is displayed nowhere | It came off the Trends grid and never landed anywhere else. Closed when it appears somewhere on Analytics. |
| Membership ROI needs seeding for Dave | Dave's rounds played before install are counted in ROI and nowhere else. Two possible forms: a typed number, or a CSV out of Apple Numbers whose columns won't match ours. |
| Two figures never hand-checked | Membership ROI break-even/per-round/savings, and Last Round's Net. Closed when each is worked out by hand against raw rounds and matched. Note `PROJECT.md` and `JOURNAL.md` disagreed about whether Net was already done — trust neither, redo it. |
| Settings still shows the testing card | Removed before the link goes to Dave. |
| Onboarding credit copy was reconstructed, not transcribed | Compared against the original design file, if the exact names matter. |
| Salsa's price is inferred, not sourced | Closed when Paul reads the price off the clubhouse menu or till. It is on the page at $2.25 — the 2022 menu had it at $2.00 and every other row in that block rose $0.25 since, but nobody has actually checked. The item itself is not in doubt: the current sheet prints Onions twice and the 2022 PDF shows Salsa in the second of those two slots, so the row was displaced rather than duplicated. |
| "Nudes" on the drinks list is unverified | Paul checks the label behind the bar. The BC brand is Nüdes; the parent brand is plain Nude. Left exactly as the clubhouse prints it until he can confirm which. Every other correction candidate was ruled on 2026-08-17 — see the header comment in `js/bar-menu.js` for the full list of deliberate departures from the printed sheet. |
| Dark palette was a judgment call | No source mockup exists. Closed when Paul approves the dark theme on a real device, or supplies one. |
| CSV Export/Import not built | A deferred phase, not a defect. Spec is in "Export / Import — CSV Backup" below. |

### Working rule, not an open item

**`sw.js`'s `CACHE_NAME` must be bumped** any time a precached file's content changes, or already-installed
users will keep serving stale assets. Bump `index.html`'s `?devcb` cache-buster with it. **The current version
is recorded in `sw.js` and nowhere else — do not copy it into this file.**

---

## Distribution Model — Two Firewalled Tracks

Decided 2026-07-07: this project splits into two separate builds before production, kept fully independent of each other and of the main Golf app. **This build (v1.0) is the Private Distribution track only.**

**1. Market Distribution (with Dashboard)** — not started
- Public-facing version aimed at anonymous walk-up players at Mt. Paul
- Shared via QR code poster at pro shop / first tee
- Includes GA4 usage tracking and an analytics dashboard (rounds tracked, unique users, peak days) — the value prop for the pitch to Dan Latin / pro shop staff
- Carries Phase 1-3 of the original Vision (booking button, club life, events) — see "Business Model" and "Tee Time Integration" below for that pitch material, kept for whenever this track starts

**2. Private Distribution (localStorage only) — this is what v1.0 is**
- Shared privately via text link (e.g., to Dave) for personal use between known players
- No account, no backend, no Apps Script, no analytics, no dashboard
- Scores persist only in the local player's browser (`localStorage`)

**Firewall rule:** the two tracks do not share files, a repo, or analytics/config. Neither ties into the main Golf app's Google Sheets / webhook infrastructure.

---

## Core Spec (Private track, as built)

- Mt. Paul Golf Course — Blue or Red tees (player's choice in Settings)
- 9 holes looped twice = 18 holes, Blue tees Par 64 / 3,974 yards (see `mt-paul-course-data.json` for full per-hole par/yardage/stroke-index, both tees)
- Name captured once in Setup, editable later in Settings
- Full stat tracking: score, putts, FIR, GIR, PEN, UD per hole
- Scores persist via localStorage (survive back button, tab close, and — as of the Pass 5 crash-resilience fix — a completed-but-unsaved Final Score screen surviving a reload)
- Full back-navigation to edit a just-recorded hole (from Final Score's Back button)

---

## PWA Spec (as built)

- `index.html` + `css/styles.css` + `js/*.js` (multi-file, ES modules) + `manifest.json` + `sw.js`
- Service Worker: cache-first, versioned (see `sw.js` for the current `CACHE_NAME`), full app-shell precache
- `display: standalone`, `viewport-fit=cover` with real `env(safe-area-inset-*)` usage
- Theme colours: CTA gradient `#8C2E39` → `#5C1620`, light-mode background `#F4EFE3`, dark mode available
- Fonts: Bebas Neue (titles/score numerals), Hanken Grotesk (UI labels), loaded from Google Fonts (system-font fallback when offline on first-ever launch)
- Icons: full 32/192/512/maskable/apple-touch set in `icons/`

---

## Export / Import — CSV Backup (researched, not yet built)

Applies to the Private Distribution track. No account, no backend — CSV export/import is the only backup/portability mechanism (phone upgrades, personal backup, importing scores elsewhere).

- **Export (primary path):** Web Share API Level 2, `navigator.share({ files: [csvFile] })`, feature-detected via `navigator.canShare({ files: [...] })`. Pops the native iOS share sheet — works inside the installed standalone PWA. Must be called synchronously from the tap handler (user-gesture requirement); keep CSV-build fast/synchronous before the `share()` call.
- **Export (fallback path):** if `canShare` with files is unsupported, open the CSV as a blob URL in a new tab.
- **Not usable at all:** `<a download>` inside standalone mode (historically unreliable across iOS versions) and the File System Access API (not implemented in WebKit on any iOS version).
- **Import:** plain `<input type="file" accept=".csv">` + `FileReader` — no known standalone-mode issues.
- **Must-test-on-device item:** some iOS point releases have had share-sheet bugs specific to home-screen-launched standalone PWAs vs. Safari tabs — test from the installed icon, not a Safari tab or desktop dev tools.

---

## Tee Time Integration (Market track only, not built)

- Mt. Paul uses Chronogolf (owned by Lightspeed)
- Phase 1: simple link button → their Chronogolf public booking URL
- Full API integration not realistic (requires Lightspeed enterprise partnership)

---

## Business Model (Market track pitch, not started)

Decision maker: Dan Latin (owner) or pro shop staff.
- Branded digital scorecard replaces paper cards; QR poster drives installs; booking shortcut drives Chronogolf traffic; GA4 monthly usage report
- Pricing options: one-time build fee $500-$1,500; monthly maintenance $50-$150/month; sponsor facilitation cut (future)
- Template reuse: same build deployable to other Kamloops courses (Bighorn, Sun Peaks, etc.) with branding swap

---

## Single Source of Truth

Every fact lives in exactly one place. Where a value already exists in code, this file points at the
code rather than repeating the value — a copied version number or status line goes stale silently and
then misleads the next session. Known owners:

| Fact | Lives in |
|------|----------|
| Service worker version (`CACHE_NAME`) | `sw.js` |
| Asset cache-buster (`?devcb`) | `index.html` |
| Course/tee/handicap data | `mt-paul-course-data.json`, `mt-paul-handicap-ratings.json` |
| Gating thresholds (1 / 2 / 20 rounds) | `js/stats.js` — `isTodaysStatsVisible`, `isWeeklyChartsVisible`, `isTwentyRoundStatsVisible` |
| Build status, settled decisions, open items | this file — the two lists under Status |
| Session history and decisions | `JOURNAL.md` |
| Where to resume | `Studio/TODO_LIST.md` — a pointer only, never a restatement |

## Files in This Project

| File | Notes |
|------|-------|
| `PROJECT.md` | This file |
| `JOURNAL.md` | Session notes — Sessions 1-4 cover the old placeholder/style-exploration era; Sessions 5+ cover the real v1.0 build (Session 5 = CSV research, 6 = Analytics, 7 = Settings/weather/PWA, 8 = visual fidelity, 9 = debug pass, 10 = Pass 6 bug-fix pass from live-build review) |
| `CLAUDE.md` | Claude context for future sessions — kept in sync with this file |
| `index.html` | Real app shell (replaced the placeholder 2026-07-23) |
| `css/styles.css`, `js/*.js` | App code — see "What's built" above |
| `manifest.json`, `sw.js`, `icons/` | PWA files |
| `mt-paul-course-data.json`, `mt-paul-handicap-ratings.json` | Course/tee/handicap data, project root (fetched at runtime) |
| `assets/` | Hole photos, logo (`assets/Logos/mt_paul_logo_vector.svg`), onboarding/final-score art |
| `Design Handoff/` | The original design handoff package (README spec, `.dc.html` design reference, mockup screenshots, source data files) this build was implemented from — kept for reference, not shipped |
| `wip/` | Gitignored scratch space for in-progress work not yet promoted |

---

