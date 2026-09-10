# Import Batch A.2 — closeout

**Nothing merged. Nothing deployed. Batch B not started. No Prisma schema change, no migration,
no production writes.**

| | |
|---|---|
| Branch | `integration/import-batch-a` |
| Batch A.1 tip | `337bf69e2` |
| **Batch A.2 final SHA** | **`799cf13ac`** |
| Baseline | `origin/main` `1a43ebbd8` |
| A.2 commits | `f214174cd`, `cd4c96b3d`, `0a8a16edf`, `799cf13ac` |

A.2 closes the remaining archival-reader risk inside Platform Import scope. Its headline is not
a new class of bug — it is that **the guard built in A.1 to police the class was still deciding
per FILE**, and per-file was wrong in three separate ways at once.

---

## 1. Protection is per call, not per file

The old test was one line:

```ts
if (FILTERED_MARKERS.some((m) => src.includes(m))) continue   // over the WHOLE FILE
```

Three ways to be silently wrong:

| | |
|---|---|
| another query in the file is filtered | exempts this one |
| an **unrelated** consumer calls `selectActiveTeams(other)` | exempts this one |
| a **comment** names `ACTIVE_TEAM_WHERE` | exempts every call in the file |

`app/api/leagues/join/route.ts` is that shape in production: line 302 filters, line 395 did not,
and the guard saw a clean file. **Eight files in the tree hold more than one reported call.**

Protection is now decided per call — a filter in *this* call's own `where`, or `selectActiveTeams`
receiving *this* call's binding. An undetermined binding counts as **unprotected**: a consumer
that cannot be read is one that cannot be checked. Comments are blanked to spaces (offsets and
line numbers preserved) before anything is matched, so prose can neither grant nor revoke an
exemption.

### Four further detection bugs, each found by measuring

- A **1200-character lookback window** put `BroadcastModeEngine`'s `Promise.all` destructure out
  of range — its explanatory comment is ~1800 characters — so a correctly filtered call was
  reported. That is the **third** fixed window this file has been bitten by. There is no window
  now.
- The binding regex anchored at `await\s*$`, but the match starts at `leagueTeam`, leaving
  `prisma.` in between. **Six correctly-filtered readers** were reported as leaks.
- A receiver segment can be parenthesised — `(prisma as any).leagueTeam` in
  `app/api/rankings/route.ts`.
- 🛑 `claimedByUserId:\s*[^{]` **did not fire**, because `\s*` backtracks to zero width and
  `[^{]` then matches the *space*. `[^{\s]` is the fix. Until then `claimedByUserId: { not: null }`
  — which selects *many* rows — read as a narrowing key, hiding **seven** league-wide reads.

### The registry is keyed by call-site identity

`file#ordinal`, not `file`. A file-keyed exemption reintroduces the bug above, and an ordinal
survives edits above it in a way a line number does not.

A new assertion refuses a **dead** exemption — an entry that no longer matches an unprotected
call stops describing anything but keeps matching, so a future call reusing that id is waved
through on a reason written about different code. It caught `dynasty-projections` the moment A.2
filtered it.

---

## 2. The population, and its classification

| | |
|---|---|
| Unprotected league-wide calls at the A.1 tip, per-call | **88** |
| Fixed in A.2 | **16** |
| Remaining, **all classified** | **72** → 71 after the dynasty fix |
| `PENDING_CLASSIFICATION` | **empty**, budget **0** |

Every one of the 72 carries a reason established by tracing its binding, not by inferring from
the file's name or directory.

### The 16 fixed — every one a count, a list, an eligibility decision, or a write

| surface | what an archived seat did |
|---|---|
| `app/api/leagues/join` (×2) | "N of M teams claimed" — **both halves**. A full league whose twelfth manager left reported 11 of 12 for ever; the bar could never reach the end |
| `lib/invite-engine/InviteEngine` | 🛑 the count **gates `leagueTeam.create`** — a manual league that lost a seat reported itself full, so a joining manager got a roster and **no team** |
| `app/api/cron/weekly-awards` | departed managers kept receiving the weekly award email |
| `lib/league-chat/leagueMemberIds` | a departed seat's claimer stayed in the chat room |
| `lib/survivor/notificationEngine` | same, for survivor notifications |
| `.../members/autocomplete` | @-mention autocomplete offered departed members |
| `lib/core-app/commissionerHub` | the "Claimed teams" tile could never reach 100% |
| `lib/core-app/scout` | scouted-manager list and the coverage denominator |
| `lib/core-app/trades` | league size feeds **trade grading** context |
| `lib/core-app/draftHq` (×2) | league size feeds pick-in-round maths — **every printed pick number shifted** |
| `lib/trade-intel/tradeContextNotes` (×3) | two league-size inputs and a current standings list |
| `lib/chimmy-context/StandingsContextProvider` | standings rows built straight from the array, model-facing |

⚠ **`isOrphan` was added to every `select` feeding `selectActiveTeams`.** `isActiveTeam` reads
`isOrphan !== true`; an omitted column is `undefined`, which reads **active**. A consumer-side
filter without it is a silent no-op, and `TeamOrphanState` marks the field optional on purpose,
so nothing type-checks it.

### Two priorities that turned out NOT to be leaks

Both were named for prioritisation; the evidence says retain, and saying so is the finding.

- **`lib/waiver-wire/process-engine.ts` (the write path).** `rankByPlatformUserId` is read as
  `.get(claimant) ?? 999` to break ties **between claimants**. An archived seat adds an
  unreachable entry, shifts no live rank and awards nothing — and filtering it would **drop the
  rank of a seat archived between a claim and its processing**.
- **`lib/core-app/leagueStandings.ts` #1 and #3 (current vs historical).** Both are *name maps*.
  The rows come from `WeeklyMatchup` and `SeasonStandingFact`, not from the team array, so
  filtering would leave a played week unlabelled and remove nobody. The current/historical split
  lives in the fact tables, not in this read.

---

## 3. `TeamPerformance.opponent` — resolved by the producer's contract

The only production writer is `SleeperLeagueCreationBootstrapService`:

```ts
opponent: tid2 ?? undefined      // tid2 = teamIdByExternalId.get(mu.roster_id_2)
```

**It stores a `LeagueTeam.id`.** `prisma/seed.ts` writes the literal `"Opponent Team"` — a
fixture, and the likely source of the name-shaped reading both readers were built on.

1. **Dead.** `opponentMatchup` matched with a bidirectional substring test on `teamName`. A UUID
   contains no team name and no team name contains a UUID, so the matchup-difficulty note never
   fired on real imported data. `resolveMatchupOpponent` used a normalising `fuzzyTeamMatch` and
   fell through to its "pick the matching team" note on every imported league.
2. 🛑 **Worse.** `perf.opponent.includes((t.teamName ?? ''))` — every string contains the empty
   string. A seat with a **null or empty name matched every opponent**, and `Array.find` returned
   the first. An unnamed seat became the opponent of record for the whole league, and the screen
   printed a confident points-against ranking **about the wrong team**. Unclaimed seats are the
   least likely to be named, and A.1 newly *retains* them — so this branch grew the triggering
   population.

`lib/league-import/teamPerformanceOpponent.ts` is now the single resolver: team id → externalId →
an **exact**, case-insensitive legacy name, never a substring and never against a blank name. An
unresolved value resolves to **nothing**, and the caller says so. `fuzzyTeamMatch` and `normName`
are deleted rather than left dead.

Covered by 13 cases: id, externalId, exact legacy name, substring refused (both directions),
unknown id, empty/whitespace/null value, the empty-name seat, an archived opponent, and
self-exclusion.

---

## 4. `dynasty-projections` — the last MIXED read, in its own commit

`generateDynastyProjection(input, { persist: true })` writes a row per target, so an archived seat
**acquired a stored projection** later reads treat as real.

- **Filtered:** `targetTeams` in both branches (the explicit `teamIdFilter` too — asking for a
  departed seat by id should find nothing rather than mint a projection for it), and the
  `teamCount` valuation fallback.
- 🛑 **Not filtered, deliberately:** `buildFuturePicksByTeam` receives the unfiltered array. It
  seeds its ledger from every *original* team and resolves traded picks through an alias map keyed
  on ids a departed seat still owns — narrowing it would **silently delete a future pick a live
  team acquired from a manager who has since left.**

### The honest boundary on its testing

`buildTeamInputsFromLeague` is exported so the assertion can be made on what reaches the
persisting generator **without persisting anything to prove it**. Four structural assertions run
everywhere and are what CI has today.

The database assertion is `describe.skipIf`-gated and **skipped in this run** — visibly, in the
summary. 🛑 `DATABASE_URL` unset in this repo means **production**, not "no database": importing
`@prisma/client` populates `process.env` from `.env`, which is why `vitest.setup.db-guard.ts` pins
the unset case to `127.0.0.1:1`. The fixture-creating test therefore runs only against a database
a human names, and carries its own second refusal against a `neon.tech` host.

**So: the persisted behaviour is asserted, and that assertion has not executed here.** It is
listed as an open item in §7 rather than counted as covered.

---

## 5. Three claims corrected

Recorded in `BATCH_A_CORRECTIONS.md`; history was not rewritten.

1. **"Three of the four MIXED reads were not mixed."** Only **one** was. `userOsContext` had a
   single consumer, so "MIXED" never described it. `opponentMatchup` and `roster-context-loader`
   are **genuinely mixed and remain so** — each still holds a current consumer and a historical
   one that disagree, and each would break if its query were filtered. Filtering the current
   consumer is the correct treatment *of* a mixed read, not evidence it was never mixed.
2. **"70 call sites (263 vs 194)"** pairs a difference with the wrong operand.
   263 − **193** = **70** is what a same-line scan of the tree today cannot see.
   263 − **194** = **69** is how many rows the census table is short. They differ by one because
   the table still lists `lib/chimmy/tools/leagueByName.ts`.
3. **"The run was terminated before Vitest reported."** Not established. `DONE=4` with no summary
   block establishes that the run did not complete normally and that **no result may be read from
   it** — which is all the gate decision required. It does **not** identify a cause; an internal
   error, a killed child, a crashed worker pool and a wrapper losing the process are
   indistinguishable from what was kept. *An abnormal exit plus truncated output is sufficient to
   reject a result and insufficient to diagnose one.*

---

## 6. Gates at `799cf13ac`

Run **one at a time**. The box carries other sessions' `tsc` and `vitest` processes, and this repo
has a recorded incident of concurrent runs killing each other into output that reads exactly like
a clean pass. The ratchet was started only once the box showed 1 `tsc` and 0 `vitest`; the suite
only once it showed 0 and 0.

| gate | result |
|---|---|
| **TypeScript ratchet** at `799cf13ac` | ✅ **`DONE=0` — 143 errors against a 143 baseline, no regressions** |
| `__tests__/league-import` (33 files) | ✅ 360 tests pass |
| Registry guard incl. per-call controls | ✅ 18/18 |
| Cross-cutting run over the touched areas | ✅ 68 files / 701 tests pass |
| New opponent + dynasty suites | ✅ 16 pass, **1 skipped** (the gated database assertion) |
| Secret scan over the tree | ✅ exit 0 |
| **Full-suite baseline comparison** | ⏳ **running at the time of writing** |

⚠ **The ratchet number is read against a baseline, not in isolation.** 143 is exactly this repo's
standing count — neither higher (a regression) nor *lower*, which on a repo with a known baseline
is the tell for a run that measured nothing. `DONE=0` and a printed count together make it a
verdict; either alone would not.

⚠ **The full-suite comparison is stated as pending rather than summarised.** The baseline to beat
is `broad-base.txt` at `origin/main` `1a43ebbd8`: **81 failed files / 145 failed tests**. It will
be reported by **failure identity** — which files gained or lost failures — not as a net count,
and only once the run writes a summary block **and** a `DONE=` of 0 or 1. Any other exit value is
not a verdict; see `BATCH_A_CORRECTIONS.md` §8 for why that rule exists.

**Known-good reference points:** `__tests__/user-os` was **7 of 7 failing at `origin/main`**
(a stale prisma mock, repaired in A.1) and now passes 58, so this branch runs **−7** against the
baseline before A.2's changes are counted.

---

## 7. Open items

1. **The dynasty persisted-write assertion has not executed.** It is written and gated; it needs
   an isolated database to run against.
2. **`FILTERED_MARKERS` semantics are now per call, but `QUERY_FILTER` still accepts a bare
   `isOrphan:` anywhere in the `where`.** That is deliberate (it covers `ORPHAN_TEAM_WHERE` and
   hand-written positive tests) but it would also accept a `where` that filters the wrong way.
   Not observed in the tree; recorded rather than fixed.
3. **A shorthand narrowing key is not recognised.** `where: { leagueId, externalId }` carries no
   colon, so it reports as an enumeration. A false positive in the safe direction — it gets
   inspected — and left as-is.
4. **Batch B (Sleeper certification) is not started.**
