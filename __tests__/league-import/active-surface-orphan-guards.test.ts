/**
 * Batch A/A.1 pre-merge — the corrected active surfaces stay corrected.
 *
 * The ghost-team fixture proves the RULE. These prove the READERS call it, which is the half a
 * pure test cannot reach: a surface that stops filtering still passes every behavioural test of
 * `selectActiveTeams`, because the rule itself is untouched.
 *
 * ⚠ THE TAXONOMY THIS ENCODES. Not every `leagueTeam.findMany` needs a filter, and blanket-adding
 * one would break history. Three kinds:
 *
 *   ENUMERATION for display or decision  → MUST filter (a departed team is shown or counted)
 *   LOOKUP MAP keyed by a unique id      → must NOT filter (unreachable from current data anyway,
 *                                          and filtering breaks historical resolution)
 *   HISTORICAL read                      → must NOT filter (that is the point of archiving)
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8')

/**
 * Source with block and line comments removed.
 *
 * 🛑 FOR ABSENCE ASSERTIONS ONLY, AND THEY NEED IT. A `not.toMatch` over raw file text cannot
 * tell code from prose, so documenting WHY an identifier must not appear makes it appear. That
 * is a guard failing on a correct change — the mirror of a guard passing on a wrong one, and
 * just as much a reason not to trust it.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('corrected ENUMERATION surfaces filter archived teams', () => {
  it('league-home standings uses the shared authority', () => {
    /*
     * 🛑 ASSERT THE CALL, NOT THE IDENTIFIER — THIS GUARD FAILED ITS OWN MUTATION TEST FIRST.
     *
     * The original version matched `/selectActiveTeams/` against the whole file. Removing the
     * CALL (`const leagueTeams = leagueTeamRows`) left the IMPORT line intact, so the regex still
     * matched and the guard stayed green over a reintroduced leak — a check that cannot fail, in
     * exactly the form this batch keeps finding. The assignment is what has to be pinned.
     */
    const src = read('lib', 'data', 'league-home.ts')
    expect(src).toMatch(/const leagueTeams = selectActiveTeams\(leagueTeamRows\)/)
    expect(src).toMatch(/from '@\/lib\/league-import\/activeTeams'/)
    /*
     * ⚠ `isOrphan: true` IS AMBIGUOUS — it is both the SELECT spelling and the inner half of
     * `ACTIVE_TEAM_WHERE`'s `NOT: { isOrphan: true }`. Matching it loosely would accept a surface
     * that filters in the query while never selecting the column. Pin the `select` block itself.
     */
    const query = src.slice(src.indexOf('prisma.leagueTeam.findMany'))
    const selectBlock = query.slice(query.indexOf('select:'), query.indexOf('}),'))
    expect(selectBlock.length, 'could not locate the select block').toBeGreaterThan(0)
    expect(selectBlock).toMatch(/isOrphan: true/)
    expect(selectBlock).not.toMatch(/NOT:/)
  })

  it('core-app league home team list and standings use it', () => {
    const src = read('lib', 'core-app', 'leagueHome.ts')
    expect(src).toMatch(/const teamsActive = selectActiveTeams\(teams\)/)
    /* Every downstream consumer repointed — an unfiltered `teams.` use is the regression. */
    expect(src).not.toMatch(/\bteams\.map\(\(t\) => \(\{\s*\n\s*teamId/)
    expect(src).toMatch(/teamsActive\.map/)
    expect(src).toMatch(/teamsActive\.some/)
    expect(src).toMatch(/teamsActive\.find/)
  })

  it('notification recipients exclude an archived team\'s claimer', () => {
    /*
     * ⚠ REWRITTEN FOR THE LIFECYCLE AXIS — THE INTENT IS UNCHANGED AND THE MECHANISM MOVED.
     *
     * This used to pin `return selectActiveTeams(teams)` plus `isOrphan: true` in the SELECT,
     * because the filter ran in application code and was a silent no-op without that column.
     * The reader now filters in the QUERY on `HUMAN_RECIPIENTS_INCLUDING_UNKNOWN`, so the select
     * no longer needs `isOrphan` and pinning it would force a column back that nothing reads.
     *
     * 🛑 THE OLD PREDICATE WAS ALSO WRONG IN THE OTHER DIRECTION, which is why this is not a
     * like-for-like port. `isOrphan` is true for seven unrelated reasons, so a CLAIMED row
     * carrying it — a real person — was dropped from their own league's mail. Excluding departure
     * is the requirement; excluding live managers never was.
     */
    const src = stripComments(read('lib', 'notification-engine.ts'))
    const query = src.slice(src.indexOf('prisma.leagueTeam.findMany'))
    expect(query.length, 'could not locate the recipient query').toBeGreaterThan(0)

    const whereBlock = query.slice(query.indexOf('where:'), query.indexOf('select:'))
    expect(whereBlock, 'the departure filter must be in the query').toMatch(
      /HUMAN_RECIPIENTS_INCLUDING_UNKNOWN/,
    )

    /* The identity key is the AF claim, and it must still be what is returned. */
    expect(query).toMatch(/claimedByUserId: true/)
    expect(src).toMatch(/\.map\(\(t\) => t\.claimedByUserId\)/)

    /* And the retired flag must not come back as a second, drifting authority. */
    expect(src, 'isOrphan must not be re-derived here').not.toMatch(/isOrphan/)
  })
})

describe('LOOKUP maps deliberately keep archived teams', () => {
  it('the matchup opponent map is keyed by unique externalId and is not filtered', () => {
    /*
     * An archived team cannot be reached through a CURRENT matchup — it has none — so including
     * it costs nothing, while filtering would break resolution of a historical one. The Fantrax
     * map is the exception that proves the rule: it is keyed on a NAME, which can collide, so it
     * prefers the active team rather than excluding the archived one.
     */
    const src = read('lib', 'core-app', 'matchup.ts')
    /*
     * ⚠ PIN THE CONSTRUCTION, NOT THE ABSENCE OF ONE HELPER — THIS GUARD ALSO FAILED ITS OWN
     * MUTATION FIRST. The original asserted only `not.toMatch(/selectActiveTeams/)`, so a
     * HAND-ROLLED filter (`teams.filter((t) => !t.isOrphan)`) sailed past it while doing exactly
     * the damage the guard exists to prevent. Asserting the map is built from the unfiltered
     * array catches every spelling of the mistake.
     */
    expect(src).toMatch(
      /const teamByExternal = new Map\(teams\.map\(\(t\) => \[String\(t\.externalId\), t\]\)\)/,
    )
    expect(src).not.toMatch(/selectActiveTeams/)
    expect(src).not.toMatch(/isOrphan/)
  })

  it('the Fantrax name map prefers active on collision but still maps archived teams', () => {
    const src = read('lib', 'import-os', 'collector', 'fantraxMatchupParity.ts')
    expect(src).toMatch(/labelIsFromActiveTeam/)
    /* Not an exclusion — an orphan still claims a label no active team wants. */
    expect(src).not.toMatch(/selectActiveTeams\(/)
  })
})

describe('a read serving BOTH a current and a historical consumer filters at the CONSUMER', () => {
  it('BroadcastModeEngine reads all teams and filters only the standings', () => {
    /*
     * 🛑 THE REGRESSION THIS PASS INTRODUCED AND THEN CAUGHT. One `teams` array feeds two jobs
     * here: the CURRENT standings, and the identity maps that resolve a HISTORICAL reference to
     * a name — `teamById`/`teamByExternalId` for `matchups`, and `ownerNameByManagerId` for
     * `rivalriesWithNames`. Both can name a team that has since left. Filtering the QUERY
     * starved them, so a past matchup or rivalry rendered a raw id where a name belongs.
     *
     * ⚠ NOT `dramaEvents`. `storylines` maps those straight through and touches no team map;
     * an earlier version of this comment and of the source said otherwise.
     *
     * The rule this pins: when one read serves both a current and a historical consumer, the
     * query must stay unfiltered and the filter must sit on the current consumer.
     */
    const src = read('lib', 'broadcast-engine', 'BroadcastModeEngine.ts')
    /* The query is unfiltered... */
    expect(src).toMatch(/prisma\.leagueTeam\.findMany\(\{\s*\n\s*where: \{ leagueId \},/)
    /*
     * ⚠ ASSERT ON CODE, NOT ON THE FILE. This was `expect(src).not.toMatch(/ACTIVE_TEAM_WHERE/)`
     * over the whole file, so merely NAMING the constant in a comment that explains why it must
     * not be used here turned the guard red. A whole-file text match is the same defect this
     * suite was repaired for once already (an archival-write check satisfiable by the comment
     * above the write). Strip comments first, then assert.
     */
    expect(stripComments(src)).not.toMatch(/ACTIVE_TEAM_WHERE/)
    /* ...the identity maps see every team... */
    expect(src).toMatch(/const teamById = new Map\(teams\.map/)
    expect(src).toMatch(/const teamByExternalId = new Map\(teams\.map/)
    /* ...and only the standings are narrowed. */
    expect(src).toMatch(/standings: BroadcastStandingRow\[\] = selectActiveTeams\(teams\)\.map/)
  })

  it('leagueHome keeps the unfiltered array available for anything else that needs it', () => {
    const src = read('lib', 'core-app', 'leagueHome.ts')
    /* The filter is a separate binding, not a rewrite of the query. */
    expect(src).toMatch(/const teams = await prisma\.leagueTeam\.findMany/)
    expect(src).toMatch(/const teamsActive = selectActiveTeams\(teams\)/)
  })
})

describe('HISTORICAL surfaces never filter', () => {
  /*
   * Asserted as an ABSENCE, which is unusual and deliberate: the risk here is someone "fixing"
   * a historical reader by copying the active-surface pattern into it, which would erase a
   * departed team from the record the archival exists to preserve.
   */
  const historical = [
    ['lib', 'league-history', 'leagueWarehouseReads.ts'],
    ['lib', 'league-import', 'sleeper', 'SleeperHistoricalBackfillService.ts'],
  ] as const

  for (const parts of historical) {
    it(`${parts[parts.length - 1]} does not filter archived teams`, () => {
      /*
       * ⚠ NO try/catch SWALLOW. The previous version returned early when the file could not be
       * read, so a renamed or moved path turned this contract into a silent pass — the historical
       * surface stopped being checked at the exact moment it moved. If a path in this list stops
       * existing, that is a finding: fix the list deliberately, do not let it self-disable.
       */
      const src = read(...parts)
      expect(src.length).toBeGreaterThan(0)
      expect(src).not.toMatch(/selectActiveTeams/)
      expect(src).not.toMatch(/isActiveTeam/)
      expect(src).not.toMatch(/ACTIVE_TEAM_WHERE/)
      /* A hand-rolled equivalent does the same damage. */
      expect(src).not.toMatch(/\.filter\([^)]*!\s*\w+\.isOrphan/)
    })
  }

  it('the reconciliation writer itself reads ALL teams, or it could not find the absent one', () => {
    const src = read('lib', 'import-os', 'collector', 'applySleeperLeagueSync.ts')
    const stale = src.slice(src.indexOf('const staleTeams'))
    expect(stale.slice(0, 400)).toMatch(/externalId: \{ notIn:/)
    expect(stale.slice(0, 400)).not.toMatch(/selectActiveTeams/)
  })
})

describe('one authority, not many', () => {
  it('the corrected surfaces import the shared helper rather than re-deriving the rule', () => {
    for (const parts of [
      ['lib', 'data', 'league-home.ts'],
      ['lib', 'core-app', 'leagueHome.ts'],
      ['lib', 'notification-engine.ts'],
    ] as const) {
      const src = read(...parts)
      /*
       * ⚠ EITHER SHARED AUTHORITY SATISFIES THIS, AND THAT IS THE POINT OF THE TEST.
       *
       * `activeTeams.ts` is superseded and `teamLifecycle.ts` replaces it one call site at a
       * time, so during the migration both are legitimate. What this guard actually forbids is a
       * HAND-ROLLED predicate — two implementations of one rule is the bug this whole batch keeps
       * paying for, and pinning one specific module would have turned every correct migration red
       * while catching no re-derivation at all.
       */
      expect(src, parts.join('/')).toMatch(
        /from '@\/lib\/league-import\/(activeTeams|teamLifecycle)'/,
      )
      /* A hand-rolled predicate is how the two implementations drift apart. */
      expect(src, parts.join('/')).not.toMatch(/isOrphan !== true/)
      expect(src, parts.join('/')).not.toMatch(/isOrphan === false/)
      expect(src, parts.join('/')).not.toMatch(/lifecycleState !== 'ARCHIVED'/)
    }
  })
})

describe('the three MIXED reads resolved by the 2026-09-10 corrective pass', () => {
  /*
   * 🛑 `selectActiveTeams` IS A NO-OP WHEN `isOrphan` IS NOT SELECTED, AND NOTHING TYPE-CHECKS IT.
   *
   * `isActiveTeam` tests `team.isOrphan !== true`. A Prisma `select` that omits the column yields
   * `undefined`, which is `!== true`, so EVERY row reads as active and the filter silently keeps
   * the archived seats it was added to remove. `TeamOrphanState` marks the field optional on
   * purpose — raw rows and partial mappers need that — so the compiler cannot catch it either.
   *
   * These pin the call AND the select together, because either alone is satisfiable while the
   * behaviour is wrong.
   */
  it('opponentMatchup filters the PA ranking but not the opponent resolution', () => {
    const src = stripComments(read('lib', 'ai-tools-start-sit', 'opponentMatchup.ts'))
    /* The query stays unfiltered so a past week can still name a departed opponent... */
    expect(src).toMatch(/where: \{ leagueId: args\.leagueId \}/)
    expect(src).not.toMatch(/ACTIVE_TEAM_WHERE/)
    /*
     * 🛑 THE PA RANKING IS NO LONGER FILTERED, AND THAT IS THE FIX.
     * `isOrphan` marks canonical OPEN SLOTS, which play real matchups and carry real
     * points-against, so filtering it removed live opponents from the ranking and shrank the
     * denominator. Excluding a genuinely DEPARTED team needs the lifecycle axis.
     */
    expect(src).not.toMatch(/selectActiveTeams\(teams\)/)
    expect(src).toMatch(/const paSorted = \[\.\.\.teams\]\.sort/)
    expect(src).toMatch(/const n = teams\.length/)
    /*
     * The opponent is still resolved against every team, archived included — and by the
     * PRODUCER'S CONTRACT (a LeagueTeam.id), not by a name substring. See
     * `__tests__/league-import/team-performance-opponent.test.ts`.
     */
    expect(src).toMatch(/resolveTeamPerformanceOpponent\(perf\.opponent, teams\)/)
    expect(src).not.toMatch(/includes\(\(t\.teamName \?\? ''\)/)
  })

  it('roster-context-loader filters the selectable partners but not the id resolver', () => {
    /*
     * ⚠ PORTED TO THE LIFECYCLE AXIS, AND THE BAR IS NOW HIGHER THAN IT WAS.
     *
     * The shape this pins is unchanged — filter the SELECTABLE list, leave the id resolver seeing
     * every row — but the rule changed: a partner list must exclude the ARCHIVED *and* the VACANT
     * (user's ruling, 2026-09-10). A vacant seat has a roster and points but nobody to accept an
     * offer, so `selectTradeable` is the only selector that draws that line.
     *
     * 🛑 THE SELECT ASSERTION IS THE LOAD-BEARING HALF AND IT NOW TAKES TWO FIELDS. `isTradeable`
     * reads `lifecycleState` and `managerKind`; an omitted column is `undefined`, which is neither
     * 'ARCHIVED' nor 'VACANT', so a partial select makes the filter a silent no-op that keeps
     * exactly the seats it exists to remove — the identical trap `isOrphan` had, on new fields.
     */
    const src = stripComments(read('lib', 'trade-value-console', 'roster-context-loader.ts'))
    expect(src).not.toMatch(/ACTIVE_TEAM_WHERE/)
    expect(src).not.toMatch(/isOrphan/)
    expect(src, 'lifecycleState must be selected or the filter is a no-op').toMatch(
      /lifecycleState: true/,
    )
    expect(src, 'managerKind must be selected or vacant seats survive the filter').toMatch(
      /managerKind: true/,
    )
    expect(src).toMatch(/opponentTeams: OpponentTeamOption\[\] = selectTradeable\(teams\)\.map/)
    /* The externalId resolver must keep seeing archived rows. */
    expect(src).toMatch(/teams\.find\(\(t\) => t\.externalId === args\.opponentTeamExternalId\)/)
  })

  it('userOsContext filters at the QUERY, because it has no historical consumer', () => {
    /*
     * The one of the four that was never mixed. `standings` is the sole consumer of this read and
     * `viewerTeam` is derived from `standings`, so a query filter cannot desynchronise them —
     * which is what the deferral rationale claimed it would.
     */
    const src = stripComments(read('lib', 'shared-services', 'league-hub', 'userOsContext.ts'))
    expect(src).toMatch(/where: \{ \.\.\.ACTIVE_TEAM_WHERE, leagueId: args\.canonicalLeagueId \}/)
    expect(src).toMatch(/const viewerTeam = standings\.find\(\(s\) => s\.isViewerTeam\) \?\? null/)
  })

  it('both recommendation generators still return early on an absent viewer', () => {
    /*
     * The safety property the query filter now depends on. If either generator stops guarding,
     * filtering the standings starts producing the −1 rank index the deferral warned about — so
     * the guard belongs here, next to the filter, not in the generators' own suites.
     */
    const strategy = stripComments(
      read('lib', 'shared-services', 'league-hub', 'generators', 'strategyRecommendations.ts'),
    )
    const playoff = stripComments(
      read('lib', 'shared-services', 'league-hub', 'generators', 'playoffRecommendations.ts'),
    )
    expect(strategy).toMatch(/if \(!context\.viewerTeam \|\| context\.standings\.length < 2\) return null/)
    expect(playoff).toMatch(/!context\.viewerTeam\) return \[\]/)
  })
})
