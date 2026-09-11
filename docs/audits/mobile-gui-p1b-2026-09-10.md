# Mobile GUI continuation — the authenticated /core journey

Continues draft PR #691 on `audit/mobile-p0-foundation`, starting at
`743923814` ("make league tray and standings usable on phones"). That commit was
also `origin/audit/mobile-p0-foundation` and was **0 commits behind
`origin/main`**, so nothing upstream had superseded the branch.

This batch is the first one here to run the journey **authenticated, against a
real server and a real database**, rather than against components alone.

## What was actually exercised

The journey asked for, driven end to end in Chromium at 390×844 and then swept
at 320/360/390/430:

1. signed-in dashboard (`/core`)
2. open the league selector, select a league
3. league home loads and stays selected (`/core?league=<id>`)
4. My Team (`/core/my-team?league=<id>`)
5. browser Back, then switch to a second league

Every step passed. Measured, not asserted:

| Step | Evidence |
| --- | --- |
| Dashboard | `overflow: false`, `scrollWidth == innerWidth` at 390 |
| Tray open | `.af-main` `inert = true`, `body { overflow: hidden }`, 2 league tiles at 58px |
| Select | URL `?league=ac71c772…`, `.af-lh` present, `h1` = the league name |
| Stays selected | the rail tile for that league is the only one with `data-active="true"` |
| League tabs | `My team / Matchup / Your week / Standings / Outlook`, tab href carries `?league=` |
| My Team | `leagueInUrl` matches the selected league; `h1` = "<user>'s Team" |
| Back | returns to `/core?league=<same id>`, same `h1` |
| Switch | `data-active` moves to the second league; the phone tray auto-closes |
| Widths | no document overflow at **320, 360, 390 or 430** |

**Environment.** A dev server in an isolated worktree, on its own port and dist
dir, pointed at `ep-muddy-leaf-adigvvph/neondb` — classified `safe (test)` by
`scripts/db-target-identity.cjs`, printed by `playwright-dev-server.cjs` on every
boot. Production was never reachable: the worktree carries no `.env`/`.env.local`
of its own, so there was no production URL to fall back to. The two leagues were
created through the tracked `POST /api/e2e/decision-os-proof-league` fixture and
**deleted through its `DELETE` (both returned 200)**.

⚠ `ep-winter-salad-ad34lce8/neondb (staging)` was tried first and **cannot run
this journey today**: its schema is behind `prisma/schema.prisma` and the league
seed dies on `P2022 · The column 'tenantId' does not exist in the current
database`. Applying that schema is a migration and was deliberately not done.

## Defects fixed

### 1. Signing in threw away the league you asked for

`app/core/[[...screen]]/page.tsx` built the sign-in `callbackUrl` from the path
only. `?league=` is the **only** thing that decides whether `/core` renders the
cross-league dashboard or one league's home — there is no cookie, no stored
default, no first-league fallback. So every signed-out deep link into a league
silently downgraded to the dashboard after sign-in.

Measured on the running server, before and after:

```
/core?league=abc123                     -> callbackUrl=%2Fcore                      (before)
                                        -> callbackUrl=%2Fcore%3Fleague%3Dabc123    (after)
/core/my-team?league=abc123&week=3      -> callbackUrl=%2Fcore%2Fmy-team%3Fleague%3Dabc123%26week%3D3
```

### 2. The roster's most-tapped control was an 18px target

`.af-mt-player-name` carries `overflow: hidden` for its ellipsis.
`af-player-card.css` grows `.af-pc-trigger` to a 44px hit area with an
absolutely-positioned `::after` — and that file's own note already records that
the area is cut back wherever an ancestor clips, because **clipping applies to
hit testing as well as painting**. On this screen it was clipped to the line box.

Hit-tested with `elementFromPoint` down the centre line of every trigger in the
roster (the worst of six, not the first — a long two-line name is nearly twice
the height of a short one and hides the real floor):

| width | before | after |
| --- | --- | --- |
| 320 | 35px | 45px |
| 360 | **18px** | 45px |
| 390 | **18px** | 45px |
| 430 | **18px** | 45px |

The ellipsis moves onto the button, the wrapper becomes an unclipped flex row,
and the button carries the height — so the shared `::after` is redundant here
rather than fought. The `<=560px` two-line clamp moves onto the button with it.

### 3. Every primary action on My Team was 36px

`Fix in {platform}`, `Fix Lineup in {league}` and `Ask Chimmy why they differ`
all inherit `.af-btn { min-height: 36px }`. Raised to 44px **by name, on phones
only** — widening the shared primitive would move every button in the app.

Measured 36px → 44px at all four widths, in both engines.

## Verification

- **Authenticated journey**: passed end to end, Chromium, 320/360/390/430 + the
  seeded-league sweep. Two fixture leagues created and deleted (cleanup 200).
- **`scripts/audits/mobile-my-team-browser-proof.cjs`** (new): passed in
  **Chromium 152 and WebKit** at 320/360/390/430 — no document overflow, no
  content escaping a roster row, every player-name target ≥44px, every primary
  action ≥44px.
- **Positive control**: reverting only `af-my-team.css` and re-running the same
  proof reports **16 failures** across the two engines' widths, naming the 18px
  targets and the 36px buttons. The check has been seen red for the right reason.
- **`scripts/audits/mobile-core-browser-proof.cjs`** (existing): 🛑 **this line
  read "still passes", and it was wrong.** Re-run on 2026-09-11 from a clean
  detached checkout it exits **1** on `desktop focus restoration` — and
  identically at `633467801`, this branch's own later tip, so it was not a
  regression introduced afterwards. It was never re-run.

  What makes the claim easy to write anyway: all four phone widths DO pass and
  print `"status":"passed"` each, so the run looks green until the last line.
  The failing assertion is the one non-phone step in the file.

  Cause: `useOverlayContainment` restored focus on `restoreTo.isConnected`.
  `.af-rail-handle` is the tray's opener and is `display: none` above 720px —
  still connected, so the guard passed and `.focus()` silently no-opped, landing
  focus on `<body>`. Fixed by testing `isFocusable` (which the file already had,
  and which covers `display: none` via `getClientRects()`) and adding
  `restoreFallbackRef`, wired to `.af-rail-toggle` — the desktop control that
  replaces the handle. Proof now exits 0 with `Breakpoint transition passed`.

  ⚠ The measured red → green transition is the control here: the failure was
  observed first, at two separate tips, then the fix was made and the same
  command re-run.
- **Vitest**: **73 passed across 4 files** — `core-rail-default-open`,
  `core-rail-active-league`, `mobile-navigation-drawer`, `core-boards`. Same
  count as the previous batch; no regression.

Reproduce, after `npm ci` and a Playwright browser install:

```sh
node scripts/audits/mobile-my-team-browser-proof.cjs
AF_PROOF_REPORT_ONLY=1 node scripts/audits/mobile-my-team-browser-proof.cjs   # every measurement, no early exit
AF_PROOF_ENGINES=chromium node scripts/audits/mobile-my-team-browser-proof.cjs
```

⚠ The proof builds a fixture roster because **the tracked e2e league fixture
cannot exercise this screen**: `lib/e2e/seedG8League` writes `DraftPick` rows,
while `MyTeam` reads `Roster.playerData.starters`. The authenticated run
therefore rendered My Team with `rows: 0` and no primary control at all. That is
a fixture limitation, not a product defect — and it is why the touch-target work
is proved at component level rather than on the live server.

## Found and deliberately NOT changed

- 🛑 **`getLeagueHomeData` does not scope on membership.** It is
  `prisma.league.findUnique({ where: { id: leagueId } })` with no `userId`
  clause, so `/core?league=<any real uuid>` renders that league's home —
  standings, activity, buzz — for a viewer who is not in it, with `yourTeam`
  degrading to "we cannot tell which team is yours". `leagueNameForTitle` in the
  same file *does* scope. Out of scope for a mobile GUI batch and too large to
  fold in silently; raised here so it is not lost.
- **A league-home read failure renders the dashboard's copy** ("Your leagues /
  We could not read your leagues just now") for a request that named one
  specific league, because `dash34` is never loaded when `?league=` is present.
  Small, but it is a behaviour change to an error path and belongs with the
  membership fix above.
- **Player card sheet and Comms drawer have no focus containment**, and the
  Comms drawer does not restore focus on close. Both are reachable from My Team.
  Neither uses `100dvh` or safe-area padding. This is the next batch.

## Remaining journey ledger

| Surface | Status |
| --- | --- |
| Dashboard → selector → league home → My Team → back → switch | **Verified authenticated**, 320/360/390/430 + 1280 desktop reachable |
| My Team touch targets and long names | **Verified**, Chromium + WebKit, component level |
| My Team populated roster on a live server | **Blocked** — the e2e league fixture writes no `Roster.playerData` |
| Player card sheet / Comms drawer focus, `100dvh`, safe area | Not started |
| Landing + responsive-navigation Playwright specs | Not run here — see below |
| Trade Center, Waivers, Chimmy | Not started |

## Blockers, stated exactly

1. **`e2e/responsive-navigation-click-audit.spec.ts` was not run.** It is tagged
   `@db` and no CI lane runs it (`test:e2e:core` greps `@db` out), so it has no
   green baseline to compare against. It needs `PLAYWRIGHT_BASE_URL` exported by
   hand — `playwright.config.ts` has its dotenv import commented out, so
   `.env.staging`'s own `PLAYWRIGHT_BASE_URL` is never loaded.
2. **Staging cannot host this journey until its schema is migrated** (`P2022`,
   `League.tenantId`). That is a migration and belongs to the user.
3. **A populated live roster needs a fixture that writes `Roster.playerData`.**
   Until then, roster-level phone verification is component-level by necessity.
