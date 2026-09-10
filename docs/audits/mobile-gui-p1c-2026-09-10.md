# Mobile GUI batch 4 — one owner for the overlay stack

Continues draft PR #691 on `audit/mobile-p0-foundation`, from `778086dc9`
("the league you asked for, and a roster you can actually tap"). That commit's
own closing note named this batch's scope exactly:

> Player card sheet and Comms drawer have no focus containment, and the Comms
> drawer does not restore focus on close. Both are reachable from My Team.

The scope turned out to be wider than "add containment to two overlays", because
the overlays could not be fixed one at a time. Every defect below needs **two**
open at once, and each overlay was individually defensible.

## The five overlays, before

| overlay | scroll lock | inert | Escape | Tab trap | focus restore |
| --- | --- | --- | --- | --- | --- |
| league tray (`AfCoreShell`) | ✅ own copy | ✅ own copy | ✅ `document` | ✅ | ✅ |
| player card (`PlayerCardProvider`) | ✅ own copy | ❌ | ✅ `document` | ❌ | ✅ |
| Comms drawer (`CommsDrawer`) | ✅ own copy | ❌ | ✅ `window` | ❌ | ❌ |
| support modal (`SupportModal`) | ❌ | ❌ | ✅ `window` | ❌ | ❌ |
| age prompt (`AgeConfirmationPrompt`) | ❌ | ❌ | ❌ | ❌ | ❌ |

Four separate owners of `document.body.style.overflow`; four independent Escape
listeners; one implementation of `inert` that was actively harmful to the others.

## What was actually wrong

### 1. The scroll lock inverted, and could strand the page locked

"The previous value" is not a property any single overlay can own. Sheet opens
and captures `overflow: ''`; drawer opens and captures `'hidden'`. Close the
sheet first and its cleanup writes back `''` — **the page scrolls behind a
still-open modal drawer**. Close the drawer after and it writes back `'hidden'`
— **the page is locked with no overlay on it at all**.

Measured on the pre-fix code (see the positive control below):

```
card→comms close:card   page STILL locked with comms open   overflow=""        FAIL
card→comms close:card   page UNLOCKED once last closed      overflow="hidden"  FAIL
comms→card close:card   page UNLOCKED once last closed      overflow="hidden"  FAIL
comms→card close:comms  page UNLOCKED once last closed      overflow="hidden"  FAIL
tray→support (both)     unlocked once both closed           overflow="hidden"  FAIL
```

### 2. One Escape closed every open overlay

Each listener was bound independently and all of them fired.
`ONE Escape closed only the topmost overlay, leaving the card` reported
`saw none` — both were gone.

### 3. 🛑 The tray inerted the very dialogs it sits beside

This is the one that made the other overlays worse rather than merely unguarded.
The tray marked **every sibling of `.af-rail`** inert. The shell's children are:

```
.af-core.af-shell
├── button.af-rail-handle      (the tray's close control)
├── aside#af-rail              (the tray)
├── div.af-main                → <main> → PlayerCardProvider → the player card
├── nav.af-tabbar
└── CommsDock                  → the Comms drawer AND the support modal
```

So `.af-main` and `CommsDock` were both inerted by the tray — meaning an open
player card or Comms drawer became **painted, modal, and completely dead**:
`inert` removes hit-testing and focusability from the whole subtree. The support
modal is opened by a button *inside the tray* (`.af-nav-support` in
`.af-rail-foot`), so the tray was inerting the dialog its own control raises.

## The fix: `components/core-app/useOverlayContainment.ts`

One hook, one owner, module-level state shared by every overlay.

- **The scroll lock is reference counted.** First acquire captures the real
  previous value, last release restores it, everything between is a no-op.
- **A stack decides who answers.** Only the topmost overlay handles Escape and
  Tab, so Escape peels one layer at a time.
- **Inertness is recomputed from the topmost overlay's ANCESTOR CHAIN**, inerting
  only the siblings alongside it. No ancestor of the active dialog is ever
  inert, so *the active dialog is never inside an inert subtree by construction*
  rather than by a list of exceptions. `keepInteractiveRefs` preserves the tray's
  one oddity — its close control is a sibling, not a child.
- **Focus handoff.** Closing the topmost overlay focuses the one revealed
  beneath it; only the last to close returns focus to the original opener, and
  only if that opener is still connected. Closing a **non**-topmost overlay moves
  focus nowhere, because something above it owns focus.

Wired into the tray, the player card sheet, the Comms drawer and the support
modal. Each of those lost its own copy of the behaviour in the same commit —
they had to move together, because two owners of `body.style.overflow` cannot
compose.

### ⚠ Correct layering is NOT "every open dialog is live"

The first version of the proof asserted that *each* open dialog is outside any
inert subtree. It failed, correctly. With a stack, the dialog **beneath** the top
one is background and *should* be inert, exactly like the page. The regression
was never "a dialog was inert" — it was that the **top** dialog was inert while
nothing else was reachable either. What the proof asserts now is that the live
layer is always the top one, and that closing it makes the next one live again.

### ⚠ Two WebKit-only defects, both real, neither visible in Chromium

1. **Tab walked out of a dialog marked `aria-modal="true"`.** The trap intervened
   only at the edges and let the browser walk the middle — which assumes both
   engines agree on what is tabbable. **WebKit leaves `<a href>` out of the tab
   order** (Safari's "press Tab to highlight each item" is off by default), so
   the computed last item was an anchor WebKit would never focus and the wrap
   never fired. Measured at 390×844: a 15-item cycle ending in `.af-cm-footlink`,
   focus on `.af-cm-input` at Tab 14, `document.body` at Tab 15 — while Chromium
   wrapped correctly on identical code. The hook now drives every Tab itself.

2. **Focus restoration missed the opener.** WebKit does not focus a `<button>` on
   click, so by the time the sheet captured `document.activeElement` it held the
   containing `<main>`. `active=main.af-content` in WebKit against
   `active=button.af-pc-trigger` in Chromium, same journey. Fixed in
   `PlayerName` by focusing the trigger on activation — one line that covers
   every surface rendering a player name, because the sheet cannot know which
   control asked for it.

Both are the shape this repo already documents: an engine-dependent check that
passes review because the engine you ran it in agreed with you.

## The fixture: `/core/my-team` finally has a roster on a live server

`lib/e2e/seedG8League` now writes `Roster.playerData` and the `SportsPlayer` rows
it resolves through, so the authenticated My Team screen renders **11 clickable
players** instead of the `rows: 0` that forced the previous batch to prove touch
targets at component level.

- Roster ids resolve via `SportsPlayer.sleeperId` (`resolvePlayers` in
  `myTeam.ts`), not `externalId` — a row is needed or the screen renders an
  "unresolved id" slot.
- `SportsPlayer` has **no FK to the league so it does not cascade**. Cleanup
  deletes those rows explicitly, filtered on `source = 'e2e-g8-fixture'`, which
  is part of `@@unique([sport, externalId, source])` — so the delete cannot reach
  a real ingested player even on an id collision.
- `seededPlayerIds` is optional on DELETE, so a caller replaying a seed response
  captured before the field existed still cleans up instead of 400ing.
- One deliberately long name (`Christian Kirkpatrick-Wetherington III`) so the
  phone ellipsis/clamp is exercised.

**The route's guards are unchanged.** `e2eAllowed()` still gates both POST and
DELETE on `NODE_ENV !== 'production' || ALLOW_E2E_SEED === '1'` **and** the
`x-allfantasy-e2e: 1` header, and POST still requires an authenticated session.
The only edit to `route.ts` is threading `seededPlayerIds` into the cleanup call.

## Verification

**`scripts/audits/mobile-overlay-stack-proof.cjs`** (new) — authenticated, real
server, real session, real seeded roster, at 390×844:

```
184 checks passed, 0 failed, across chromium AND webkit
fixture cleanup DELETE -> 200 (both engines)
```

Covering both opening orders × both closing orders for `card`+`comms`, both
closing orders for `tray`+`support`, Escape peeling, focus restoration, an
opener that has unmounted, 25-press Tab containment, backdrop close, and a route
change.

**🛑 The positive control — the proof has been seen red for the right reasons.**
Reverting only the five overlay components to `778086dc9` and re-running reports
**16 failures**, naming the inverted lock (`overflow=""` with a modal still
open), the stuck lock (`overflow="hidden"` with nothing open), one Escape closing
both, Tab escaping after 16 presses, and the missing inert. Restored afterwards
and confirmed byte-identical with `diff -q`.

**Vitest**: 73 passed across 4 files (`core-rail-default-open`,
`core-rail-active-league`, `mobile-navigation-drawer`, `core-boards`) — the same
count as the previous batch. jsdom does not implement `inert`, so the hook's
`el.inert = true` is an inert JS property there and the suites are unaffected.

**Scoped typecheck**: 0 errors in the changed files; 3 pre-existing errors in
`lib/auth.ts`, which this batch does not touch. Verified with `--listFiles` that
the files under test were actually in the compile set, and with an injected
`TS2322` that the check reports errors in them.

**ESLint** on the changed files: 0 errors, 2 pre-existing warnings
(`no-img-element` in `AfCoreShell`, an unrelated `exhaustive-deps` at
`CommsDrawer:505`).

### Reproduce

```sh
AF_NEXT_DIST_DIR=.next-dev-mobile-batch DEV_AUTH_BYPASS_ENABLED=true \
  node node_modules/next/dist/bin/next dev -p 3010 -H 127.0.0.1

node scripts/audits/mobile-overlay-stack-proof.cjs
AF_PROOF_REPORT_ONLY=1 node scripts/audits/mobile-overlay-stack-proof.cjs   # every measurement
AF_PROOF_ENGINES=chromium node scripts/audits/mobile-overlay-stack-proof.cjs
```

**Database**: `ep-muddy-leaf-adigvvph/neondb`, classified `safe (test)` by
`scripts/db-target-identity.cjs` — verified through that module's own
`identifyTarget`/`isProductionTarget` before anything ran, not by reading the
hostname. Production is `ep-curly-block-ad0dlt9o`.

## The two agreed follow-up checks

### Error copy on a league-home read failure — CONFIRMED, not fixed

`p1b` recorded this as suspected. It is now measured on a running server:

```
GET /core?league=00000000-0000-4000-8000-000000000000   ->  200
rendered:  "Your leagues"
           "We could not read your leagues just now. This is a read failure on
            our side, not a sign that you have none."
```

The mechanism is exactly as predicted: `dash34` is loaded only when
`activeKey === 'home' && !selectedLeagueId`, so a request that **names one
league** whose read fails falls through the `leagueHome ?` branch and lands on
the cross-league dashboard's plural copy.

**Deliberately not changed here.** `p1b` put this with the `getLeagueHomeData`
membership gap — that function is `findUnique({ where: { id } })` with no
`userId` clause — and a correct error path depends on which of "not yours" and
"we could not read it" is true. Fixing the copy without the membership scope
would mean writing a message the code cannot yet justify.

### `e2e/responsive-navigation-click-audit.spec.ts` — RUN, still no baseline

`p1b` listed this as not run. It has now been run against the dev server with
`PLAYWRIGHT_BASE_URL` exported by hand, twice, and **it does not reach a single
navigation assertion**. It fails inside `registerAndLogin`, on the login page:

- `loginWithRetryTo` retries **8 times with backoff**, each with a 15s request
  timeout, and the spec's own `test.describe.configure({ timeout: 240_000 })`
  expires first. A CLI `--timeout` does **not** override an in-file
  `describe.configure`, so raising it from the command line changes nothing.
- The failure snapshot is the signed-out login screen ("Welcome back / Sign in to
  your leagues"), i.e. before any responsive-navigation code runs.
- Route warm-up alone costs ~150s on this dev server (30 routes, 5–24s each
  compiling on first hit), so the budget is largely gone before the test starts.

This is unrelated to the overlay work — it is an auth-helper/runtime-budget
problem — but it is now localized rather than merely "not run". It still has no
green baseline, so it cannot yet certify anything about navigation.

## Found and NOT changed

- ⚠ **`AgeConfirmationPrompt` is an unmigrated shared overlay.** Mounted globally
  in `SafeGlobalChrome` (outside the /core shell), `role="dialog"
  aria-modal="true"`, with **no Escape, no scroll lock, no focus trap and no
  containment at all**. It is a first-visit gate, so it sits above everything
  including /core overlays. The proof dismisses it through its own
  `af_age_prompt_dismissed` sessionStorage key rather than by POSTing
  `/api/auth/confirm-age`, so nothing is written to the database that cleanup
  does not remove. It should take the hook; it is outside this batch's surface.
- ⚠ **`MobileNavigationDrawer` still hand-rolls its own containment** and has no
  scroll lock at all. It belongs to the global shell (`GlobalTopNav`), not the
  /core shell, so it cannot currently stack with the four overlays migrated here
  — but it is the fifth copy of this logic and the next one to move.
- **Backdrop close does not exist on a phone.** Measured, not assumed: at 390px
  *and* at 900px the Comms drawer covers its own scrim, and at 390px the player
  card sheet covers the full viewport. The proof reports this as a note and
  exercises the card's backdrop at 900px, where a scrim point is reachable
  (`elementFromPoint` confirms the hit target rather than trusting a corner).
- **`comms → card` is not a journey a user can perform today.** Every
  `.af-pc-trigger` lives in `.af-main`, which is inert and underneath the drawer,
  and `components/core-app/comms/*` imports neither `PlayerName` nor
  `usePlayerCard`. The order is still exercised, driven the way code drives it,
  because the stack ordering is a property of the hook — and the moment any
  surface inside the drawer renders a player name the order becomes reachable
  with no change to the hook.
- ⚠ **`lib/e2e/**` and `app/api/e2e/**` are never typechecked by any run in this
  repo.** `tsconfig.json`'s `exclude` carries `"**/e2e/**"`, so the fixture
  changes in this batch are outside every `tsc` invocation here — confirmed with
  `--listFiles`. Same family as the standing "tests are never typechecked" note.
- **WebKit rejects Next's RSC prefetch** (`?_rsc=…`) on this dev origin as a
  cross-origin fetch. It happens on navigation whether or not an overlay was ever
  opened. The proof exempts exactly that string pair and reports the count as a
  note, rather than either failing on it or wrapping the whole check in a
  try/catch that would hide the next real error.

## Remaining journey ledger

| Surface | Status |
| --- | --- |
| Dashboard → selector → league home → My Team → back → switch | Verified authenticated (p1b) |
| My Team touch targets and long names | Verified, Chromium + WebKit (p1b) |
| My Team populated roster on a live server | **Resolved** — the fixture writes `Roster.playerData`; 11 triggers render |
| Player card / Comms / tray / support containment + stacking | **Verified**, Chromium + WebKit, 184 checks |
| `100dvh` and safe-area on the card sheet and Comms drawer | Not started |
| `AgeConfirmationPrompt`, `MobileNavigationDrawer` containment | Not started |
| Landing + responsive-navigation Playwright specs | **Run, still blocked** — fails in `registerAndLogin`, no baseline |
| Trade Center, Waivers, Chimmy | Not started |
