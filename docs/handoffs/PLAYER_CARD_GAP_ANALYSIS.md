# Player card pop-up — gap analysis (2026-09-07)

Source: `playercards.zip` → `design_handoff_core_pages/AF Trade Price Transparency.dc.html`,
rows **STATE 6** (universal) and **STATE 7** (league), screenshots 16–19.

Run before building, per the standing rule: *every page that changes visually gets a gap
analysis first; less functionality is acceptable, unwired functionality is not.*

This is the 16th file in the same batch as `CORE_PAGES_VISUAL_UPGRADE_GAP_ANALYSIS.md`
(fifteen `core/*` boards, built separately). It is not a board — it is a pop-up that opens
from a player's name on any of them.

## What the design asks for

A Sleeper-style detail card, opened by clicking a player name, in two flavours:

- **Universal** (outside a league): global trade price + 7d delta, overall/position rank,
  rostered % with a sparkline, next-5 projections, leaguewide recent trades, similar-price
  comps, latest news.
- **League** (inside one): this league's own price, an ownership/need-fit line, a Propose
  Trade action, playoff schedule, in-league trade history, your roster at that position.

Both ship desktop (right slide-in panel) and mobile (full-screen sheet), with a tappable
Decision-OS insight line that expands inline.

## Measured first — production, 2026-09-07

Every verdict below rests on these counts, read through `scripts/db-readonly-probe.mjs`
(`BEGIN TRANSACTION READ ONLY`, rolled back).

```
PlayerValueSnapshot   18,955 rows · 16 distinct days · newest 2026-09-06
                      but only ~475 DYNASTY / ~214 REDRAFT players (FantasyCalc)
                      every row carries overallRank AND positionRank
fantasy_projections    2,558 rows — season 2026, week 1. ONE WEEK.
AFProjectionSnapshot  21,136 rows — likewise ONE distinct week
SportsGame sport='NFL'   857 rows, weeks 0–18, season 2026
                      (rolling_insights + seasonType='regular' = 272 = the full slate)
SportsNews            11,932 rows · 6,657 carrying a player name · newest today
LeagueTrade           18,290 rows · players stored as Sleeper id arrays
allfantasy_market_player_values     283 published
```

## Per-field: backing, and what is kept vs dropped

| Design field | Backing | Verdict |
|---|---|---|
| Headshot, name, POS · TEAM #n | `SportsPlayer.imageUrl/name/position/team/number` | **Full build.** |
| Age / height / weight / EXP / college | `SportsPlayer.age/height/weight/yearsExp/college` | **Full build.** `yearsExp` 0 renders "ROOKIE" and null renders nothing — the schema comment is explicit that conflating them labels every unmatched player a rookie. |
| TRADE PRICE + 7d delta | `PlayerValueSnapshot.value`, 16 days of history | **Full build.** Delta is taken against the snapshot *closest to 7 days back*, not "7 rows back" — captures are not evenly spaced, and counting rows would label a 4-day move "7d". Claimed only when a snapshot sits ≥3 days back. |
| OVERALL RK / POS RK | `PlayerValueSnapshot.overallRank/positionRank` | **Full build**, same universe. |
| ROSTERED % | `getRosteredMarket` | **Built, RESCOPED and relabelled.** Ours is share of *AllFantasy's imported leagues*, not the whole sport. The tile says "of N AF leagues" and declines entirely below 8 leagues — `rosteredMarket.ts` ships `leaguesCounted` for exactly this gate. |
| Rostered sparkline | — | **DROPPED.** No per-day ownership history is stored; the number is recomputed, not accumulated. A sparkline would be drawn from one point. |
| NEXT 5 · PROJECTED | `SportsGame` (opponents) + projections (one week) | 🛑 **RE-AIMED. This is the big one.** Both projection tables hold **only the current week**, so a five-row projected column renders one number and four blanks every week, forever, for every player. The fixtures however are complete. Ships as **next-5 schedule** with a projection on the week one exists for, and a line saying so. |
| Bye week | derived — club absent from a week that *has* fixtures | **Full build.** A week with no fixtures for anybody is skipped rather than called a bye; un-ingested and on-bye are indistinguishable from one club's row. |
| CAREER line | `PlayerDetail.seasonStats` | **DROPPED for now.** Reachable but on a separate loader; the card does not yet pay for it. Not blocked by data. |
| RECENT TRADES | `LeagueTrade`, joined on Sleeper id | **Built, RESCOPED.** These are our imported leagues, not a global feed, and the card says so. ⚠ Every trade is stored **twice**, once per side, mirrored — deduped on `transactionId`. Ids are resolved to names in one query; an unresolvable id is dropped, never printed raw. |
| SIMILAR PRICE | nearest values in the same capture | **Full build**, and the chips open that player's card. |
| LATEST | `SportsNews` by `playerName` / `playerNames[]` | **Full build.** |
| Insight line | derived | **Built, DERIVED — never generated.** AI spend is ratcheted to zero. Every headline is arithmetic over numbers already on the card, and the expander names its `basis` so the claim is checkable. Returns null rather than reaching for a weaker fact. |
| **LEAGUE PRICE** | `getMarketValues` under the league's own variant/scoring/size | **Full build.** Re-derived, not reused — in superflex the universal number is simply a different number. |
| OWNED BY / slot | `Roster.playerData` + `LeagueTeam` | **Full build.** Ownership from the ROSTER, team row joined only for a name — the rule `playerLeagueView.ts` already states. |
| YOUR NEED FIT | — | **REPLACED, deliberately.** No auditable scale exists for a HIGH/MED/LOW fit. The card shows **your actual players at his position with their prices**, which is the comparison the grade would have hidden. |
| PLAYOFF SOS | — | 🛑 **DROPPED.** There is no defence-vs-position or strength-of-schedule rating for NFL opponents anywhere in the schema. The `sos` hits in `lib/` are all *fantasy-team* power rankings, which is a different measurement that shares the acronym. Inventing one is a five-grade swing on a trade verdict. |
| PLAYOFF SCHEDULE wk15–17 | `SportsGame` | **Buildable** from the same loader as next-5; not yet surfaced separately. |
| Propose Trade | existing trade flow | **NOT WIRED YET** — see below. |

### The value book, and why it is deliberately the "wrong" one

Raised by the core-boards session, 2026-09-07, and they were right.

The card first read `format: 'DYNASTY', qbFormat: 'ONE_QB'` — arguably the better default,
since most leagues are one-QB. That is precisely the wrong reason to differ. Both
`lib/core-app/trades.ts` and the cross-league `tradesBoard.ts` hardcode
`source: 'FANTASYCALC', format: 'DYNASTY', qbFormat: 'SUPERFLEX'`, so a card quoting a
different number for the same player **on the same page** reads as a bug in one of them.

Measured, and the gap is not cosmetic — Jahmyr Gibbs:

```
ONE_QB     11,422   overall #1
SUPERFLEX  10,427   overall #2      <- a QB outranks him in superflex
```

The card now pins the same three literals (`VALUE_SOURCE` / `VALUE_FORMAT` /
`VALUE_QB_FORMAT` in `playerCard.ts`) and renders the book on screen
("dynasty · superflex · fantasycalc"). It **is** a known wrongness for a redraft league —
but a SHARED one, stated, rather than two surfaces silently disagreeing. The league
flavour is unaffected: it re-derives from the league's own variant and scoring.

🛑 **And `source: 'FANTASYCALC'` was missing from all three of this file's reads.** It is a
**licence boundary**, not a tidy filter: DynastyProcess's value files are FantasyPros ECR
derivatives whose terms bar commercial use, and a permissive licence on the redistributing
repo cannot relicense third-party data inside it. Today only FantasyCalc rows exist so the
filter is a no-op — which is exactly why it has to be written at every new read site.
Without it, the day a second source lands, this card starts pricing on data we may not be
licensed to use and nothing fails.

## Decisions taken (each a deliberate drop, not an accident)

1. **Next-5 projections became next-5 fixtures.** The single most visible change from the
   design, and the alternative was four permanent blanks per card.
2. **Ownership and trades are scoped to AllFantasy's own leagues, and labelled.** The design's
   framing is leaguewide; ours is not, and a percentage whose denominator is hidden is the
   failure this codebase keeps undoing.
3. **Playoff SOS dropped rather than approximated.**
4. **Need fit replaced with your actual roster** at that position.
5. **The sparkline dropped** — one data point is not a trend.
6. **The insight line is derived and carries its basis.**

## What is wired, and what is not

**Wired:**
- `lib/core-app/playerCard.ts` — the payload. Every section is a `SectionState`; an
  unavailable one carries its reason and the card prints the reason, not a dash.
- `app/api/core/player-card/route.ts` — rate-limited, membership-gated on the league flavour.
  A non-member gets the **universal** card rather than a 403: the league half is what they
  may not see, not the player.
- `components/core-app/player-card/*` + `af-player-card.css` — one component for both
  flavours, one media query for desktop/mobile.
- Mounted once in `AfCoreShell` around `{children}`, so it is available on every `/core` screen.
  ⚠ That file is edited by several sessions at once. The mount was backed out on request
  while the core-boards session held ~110 uncommitted lines in it, and re-applied only once
  their work was in a commit (`421ce94d2`) and the file measured byte-identical to HEAD.
  The re-applied diff is **16 insertions / 1 deletion**, the deletion being the `{children}`
  line it re-wraps — provably additive, per CLAUDE.md's path-scoped-commit hazard.
- Opening from **My Team**, **Matchup** (both lineup columns), **Trades**, and
  **Waiver "Worth adding"** rows — all in the league flavour via `PlayerCardLeagueScope`.

### Two surfaces needed data work first, not just a name swap

**Matchup** — `MatchupPlayerCell` carried only `playerId`, which is the **roster's own
id**: the same as the Sleeper id on a Sleeper league, but an ESPN id on an ESPN one.
Handing that to a Sleeper-keyed lookup would 404 at best and match the wrong player at
worst. The loader already knew the real id (`sleeperIdByRosterId`) and kept it private,
so the cell now carries `sleeperId: string | null` — null exactly when the identity join
missed, which is what makes the name fall back to plain text instead of an inert button.

**Trades** — 🛑 **this file's own header said the data did not exist, and that was wrong.**
It read *"WHAT IS NOT IN THAT DATA: WHICH players moved"*. True of `dw_transaction_facts`,
whose payload is counts only — but `LeagueTrade` holds the Sleeper id arrays for the same
trades, and **17,501 of 17,657 trade facts (99.1%)** join to it on
`payload.sleeperTransactionId`. Measured 2026-09-07; the names were one join away. The
header is corrected in place and `TradeRecord.players` now carries them.

🛑 **And the first fix under-claimed in exactly the same way — twice in one file.** It
shipped the names as an *unordered set*, saying direction was unrecoverable "without going
through `LeagueTradeHistory.sleeperUsername`" — naming, in that very sentence, the
mechanism that recovers it. Caught by the core-boards session, whose board had been
grading on it all along. `playersGiven`/`playersReceived` ARE directional with respect to
the history's username. Measured on a real mirrored pair:

```
tx 1022535786568249344   owner 411273464511479808   got  ["9756"]
tx 1022535786568249344   owner 671391748378935296   gave ["9756"]
```

`TradeRecord.players` now carries **one entry per side, named by the manager who received
it**, and the card renders "You got X" / "<manager> got Y". The lesson is the durable part:
*twice* the honest-looking move was to declare data absent, and *twice* it was one join
away. Check the join before writing the refusal.

⚠ `sleeperUsername` is a numeric Sleeper **user** id — it maps to
`LeagueTeam.platformUserId` on 3,413 of 4,362 histories (78%) and to `externalId` on
**zero**. Keying it the obvious way would have left every side anonymous with nothing on
screen to say why. An unresolved side reads "Another manager got", never a raw id.

⚠ **Order before you collapse.** The two mirrors tie on every payload field, so the survivor
of a dedupe — and therefore which way round a two-sided row reads — is whatever Postgres
returned first. `trades.ts` now orders by `historyId` before grouping. The player card is
immune for a different reason and it is worth knowing which: it orients by *which side the
subject is on*, not by which row won, so both mirrors yield the same answer.

The letter grade is still withheld, but **the reason is coverage, not direction**:
`gradeTrade(received, gave)` works now; what withholds it is that a grade needs every asset
on both sides priced, and `PlayerValueSnapshot` covers ~475 dynasty players.

### The league flavour, verified against a real league (2026-09-07)

This was the one path that had never executed — every browser check fell through to the
universal card, because a dev preview has no session and the route is membership-gated. Run
server-side through `getPlayerCard` in a dev route against a real Sleeper dynasty league
("BB Dynasty League 26!", 14 teams) and a real claimed team:

| | player on YOUR roster | player on ANOTHER manager's |
|---|---|---|
| `context` | `league` | `league` |
| `slot` | `BENCH` | `STARTER` |
| `isYours` | `true` | `false` |
| `owner` | `null` | resolves to the manager |
| `price` | `126` (dynasty, 1QB, 14-team) | `11568` |
| `yourRoster` | Charbonnet 1,809 · Jones 1,114 · Blue 361 · Mixon 25 — **subject excluded** | subject now included |

Everything the flavour claims is real: the slot comes from `Roster.playerData`, the price is
re-derived under the league's own variant (note **1QB, 14-team** — not the app-wide superflex
book), and "YOUR ROSTER AT RB" answers the need-fit question better than a grade would have
(126 against a 1,809 incumbent).

🛑 **`owner` is null on your OWN roster, and that is correct rather than a gap.** Measured: of
332 claimed Sleeper teams the roster matches `claimedByUserId` **332/332** and
`platformUserId`/`externalId` **0/332** — rosters for a claimed team are keyed on the
AllFantasy user id, not the Sleeper one. So the holder key for your own roster resolves no
`LeagueTeam` row. The three-candidate claim predicate copied from `playerLeagueView.ts`
includes `userId`, which is the only reason `isYours` works at all; the two "obvious" keys
would have found nothing. The header renders "ON YOUR ROSTER · BENCH" in that case and never
needs the name.

Two bugs this pass caught, and one of them is not about this feature at all — see below.

**Not wired yet, stated rather than hidden:**
- **Propose Trade** — the button is not on the card. Wiring it means choosing a target
  surface and prefilling it; that is a trade-flow decision, not a card decision.
- **Star / watchlist** — the design's ☆. No watchlist table was identified for it.
- **The `core/*` boards** (`components/core-app/boards/`) are being built concurrently by
  another session; their player names are a one-line `PlayerName` swap once they land.
- **Playoff schedule (wk 15–17)** as its own section on the league card.

## Verification

- **Typecheck**, scoped, with the `--listFiles` control confirming all 8 files were actually
  in the compile set: **0 errors in every file touched**. The 3 reported are pre-existing in
  `lib/auth.ts`, untouched here.
- **Tests — 63 passed across 6 suites** (`matchup-lineup-player-card`, `matchup-screen-banner`,
  `my-team-screen`, `waiverLineupBoard`). They render without a provider, which is why
  `usePlayerCard` returns a no-op outside one rather than throwing.
- 🛑 **`matchup-screen-banner` could not have caught a regression here** — it sets
  `lineups: { available: false }` on purpose, so it never reaches `PlayerHalf`. The matchup
  wiring was covered by a green suite that would have stayed green with the wiring deleted.
  `__tests__/matchup-lineup-player-card.test.tsx` was added for it, and **verified red before
  green**: forcing the name back to plain text failed 3 of its 4 tests (the 4th guards empty
  slots and correctly does not depend on the wiring). The mutation was proved applied with
  `diff -q` before the run, and the restore proved the same way afterwards.
- 🛑 **The Trades screen had NO test at all** — and its sides are the newest and least
  obvious thing on it, having already been wrong twice (counts, then unordered). Covered by
  `__tests__/trades-screen-player-sides.test.tsx`, also **red-before-green** under two
  mutations, each proved applied by `diff -q` first:

  | mutation | red |
  |---|---|
  | drop the second side (reverts to the "unordered set" shape) | 3 of 6 |
  | print the raw Sleeper id instead of "Another manager" | 1 of 6 — the right one |

  Note the first mutation still renders every player name, which is why the suite asserts
  *which side each player is under* rather than that the names appear. Restored and
  NUL-scanned (a shell wrote the file).
- **End-to-end against production data** in the browser: Jahmyr Gibbs renders price 11,422 /
  +349 · 7d / overall #1 / RB #1 / rostered 86% of 266 AF leagues, real trades, real comps,
  real news. Ka'imi Fairbairn (K) is the **control**: no price tiles at all and the stated
  reason "FantasyCalc publishes no value for kickers or defenders" — not a zero.
- **Trades verified end-to-end in the browser**: the join yields real names on real rows
  (3, 5 and 2 named players on the newest three transactions), the screen renders
  "PLAYERS INVOLVED · Jahmyr Gibbs, Bijan Robinson, Christian McCaffrey", and a picks-only
  trade whose join found nothing renders **no row at all** rather than an empty label.
  Clicking a name inside a trade card opens the card; because the preview's league id is
  not a real membership it correctly degraded to the **universal** card rather than erroring.
- 🛑 **A NUMBER RENDERED AGAINST THE WRONG NAME IS INVISIBLE TO A TEXT SCAN**, and
  `PlayerCardSheet` had no test at all. Borrowed from the core-boards session, which ran a
  side-flattening mutation against its own board suite and got **45 passed / 45 passed** —
  every name and value still *appeared*. The card pairs a number with a label in three
  places (roster name → price, week → projection, comp name → price), so
  `__tests__/player-card-sheet-pairing.test.tsx` asserts the **pair**, never the presence.
  Red-before-green under two mutations, each proved applied by `diff -q` first:

  | mutation | red |
  |---|---|
  | shift each roster price onto the next player's row | 2 of 6 — both roster-pairing cases |
  | give every week the first week's projection | 1 of 6 — the schedule case |

  Both mutations still render every name and every number. Tight blast radius rather than
  everything reddening, which is the sign the mutation was aimed. Restored, NUL-scanned.
  ⚠ Writing it also caught a misreading of my own component: SIMILAR PRICE is gated on
  `!league`, so the league card swaps that column for league trades. Correct behaviour,
  wrong fixture — now pinned as its own case.
- 🛑 **A `tsc --noEmit` PASS IS NOT A BUILD, AND THIS SHIPPED A BROKEN ROUTE FOR AN HOUR.**
  `Trades.tsx` opened its JSX return with two `//` line comments:

  ```
  return (
    // Names on this screen belong to THIS league...
    <PlayerCardLeagueScope leagueId={data.league.id}>
  ```

  `tsc` accepts that and reported **0 errors across 13 files, twice**. SWC rejects it —
  `Unexpected token 'PlayerCardLeagueScope'. Expected jsx identifier` — and the import trace
  ran through `app/core/[[...screen]]/page.tsx`, so **the entire core route failed to
  compile**. It was invisible because the attestation was a typecheck, the tests mock at the
  module boundary, and `next.config.js` sets `typescript.ignoreBuildErrors: true` — so the two
  checks are not a superset of each other in either direction. Found only by loading a page
  that imports the file. The other two screens used `/* */` and were unaffected; the block
  comment now carries the reason. **Load a page that imports the file before attesting to a
  UI change.**
- Two bugs found and fixed by the earlier pass, both invisible to the typecheck:
  1. "Moved with Jahmyr Gibbs" on Gibbs's own card — the subject was dropped by array
     *position*, and he is not at index 0 of his own side. Now dropped by name.
  2. 🛑 **The insight bar and stat tiles collapsed to 2px on mobile.** `.af-pc-body` is a
     column flex container, so each section is a flex item with `flex-shrink: 1`, and a
     `display: block`/`grid` child has no automatic minimum height to resist with. Measured
     at 375×812: insight 2px against a 41px scrollHeight, tiles 2px against 155px. Fixed
     with `.af-pc-body > * { flex: none }` — **globally, not in the media query**: desktop
     escaped it only because the panel happened to be tall enough.
