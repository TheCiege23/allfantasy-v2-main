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
    const src = read('lib', 'notification-engine.ts')
    /* The CALL in its return position — not merely the imported name. */
    expect(src).toMatch(/return selectActiveTeams\(teams\)/)
    const query = src.slice(src.indexOf('prisma.leagueTeam.findMany'))
    const selectBlock = query.slice(query.indexOf('select:'), query.indexOf('})'))
    expect(selectBlock.length, 'could not locate the select block').toBeGreaterThan(0)
    expect(selectBlock).toMatch(/isOrphan: true/)
    expect(selectBlock).not.toMatch(/NOT:/)
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
     * here: the CURRENT standings, and the identity maps that resolve `dramaEvents` and
     * `rivalries` — which are historical and can name a team that has since left. Filtering the
     * QUERY starved the maps, so a drama beat about a departed team rendered against an
     * unresolvable id.
     *
     * The rule this pins: when one read serves both a current and a historical consumer, the
     * query must stay unfiltered and the filter must sit on the current consumer.
     */
    const src = read('lib', 'broadcast-engine', 'BroadcastModeEngine.ts')
    /* The query is unfiltered... */
    expect(src).toMatch(/prisma\.leagueTeam\.findMany\(\{\s*\n\s*where: \{ leagueId \},/)
    expect(src).not.toMatch(/ACTIVE_TEAM_WHERE/)
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
      expect(src, parts.join('/')).toMatch(/from '@\/lib\/league-import\/activeTeams'/)
      /* A hand-rolled predicate is how the two implementations drift apart. */
      expect(src, parts.join('/')).not.toMatch(/isOrphan !== true/)
      expect(src, parts.join('/')).not.toMatch(/isOrphan === false/)
    }
  })
})
