/**
 * The read side of the team lifecycle axis.
 *
 * 🛑 THE RULE THAT MATTERS IS `not: ARCHIVED`, NOT `equals: CURRENT`, AND THE DIFFERENCE IS THE
 * WHOLE PRODUCT. `UNKNOWN` is the column default and every one of the 3,300 team rows on the test
 * database still holds it, because the lifecycle writer only landed with the archive change. A
 * filter asking for CURRENT would therefore return NOTHING — every league would render empty —
 * while a filter excluding ARCHIVED changes nothing for an unclassified row. That is what makes
 * this safe to apply to a live read, and it is the assertion most worth pinning.
 *
 * 🛑 AND THE DISCRIMINATOR IS `lifecycleState`, NEVER `archivedAt`. The schema says so in its own
 * comment: "`archivedAt IS NULL` does not mean current, because UNKNOWN rows also have no
 * timestamp." A timestamp-based filter would pass every test written against archived rows — they
 * do carry a timestamp — while silently treating every unclassified row as current. It looks
 * identical until someone archives a row without stamping one.
 */
import { describe, expect, it } from 'vitest'

import { CURRENT_TEAMS, currentTeamsOnly, isArchivedTeam } from '@/lib/leagues/leagueTeamLifecycle'

/** A file's source with comments stripped, so a guard cannot match the note that explains it. */
function code(file: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path')
  const raw = readFileSync(join(__dirname, '..', file), 'utf8')
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('the current-teams filter', () => {
  it('excludes only what is positively archived', () => {
    // Pinning the SHAPE, because the whole safety argument rests on it being `not`, not `equals`.
    expect(CURRENT_TEAMS).toEqual({ lifecycleState: { not: 'ARCHIVED' } })
  })

  it('does not key on archivedAt', () => {
    // A row can be UNKNOWN with no timestamp; a timestamp filter would call that current.
    expect(JSON.stringify(CURRENT_TEAMS)).not.toContain('archivedAt')
  })
})

describe('the in-memory counterpart agrees with the query', () => {
  const unclassified = { id: 'a', lifecycleState: 'UNKNOWN' }
  const current = { id: 'b', lifecycleState: 'CURRENT' }
  const archived = { id: 'c', lifecycleState: 'ARCHIVED' }

  it('keeps an unclassified row', () => {
    // 🛑 The one that matters: today this is every row in the product.
    expect(isArchivedTeam(unclassified)).toBe(false)
    expect(currentTeamsOnly([unclassified])).toEqual([unclassified])
  })

  it('keeps a row known to be current', () => {
    expect(isArchivedTeam(current)).toBe(false)
  })

  it('drops a row known to be archived', () => {
    expect(isArchivedTeam(archived)).toBe(true)
    expect(currentTeamsOnly([unclassified, current, archived])).toEqual([unclassified, current])
  })

  it('keeps a row whose lifecycleState was never selected', () => {
    /*
     * ⚠ DELIBERATE, AND THE SAFER DIRECTION. A caller that forgot the column in its `select` must
     * not have its rows silently dropped — that turns one forgotten field into an empty league,
     * which is far worse than showing a single departed team.
     */
    expect(currentTeamsOnly([{ id: 'd' }])).toEqual([{ id: 'd' }])
    expect(currentTeamsOnly([{ id: 'e', lifecycleState: null }])).toEqual([{ id: 'e', lifecycleState: null }])
  })
})

describe('the display reads that were migrated actually use it', () => {
  /*
   * A source guard, because these are the sites where an archived franchise would be VISIBLE or
   * would hold a seat. Nothing type-checks a `where` clause back into place, and two of them use
   * `(prisma as any)`, so a revert would be silent. Comments are stripped first — the note in
   * `leagueHome.ts` explaining the filter names the symbol it is explaining.
   *
   * 🛑 IT COUNTS, IT DOES NOT ASK WHETHER THE SYMBOL APPEARS, AND THE FIRST VERSION DID THE LATTER.
   * Two of these files hold MORE THAN ONE league-wide read. A presence check passes while one of
   * them is reverted, because the other still mentions `CURRENT_TEAMS` — proven by mutation: the
   * filter was removed from `fill-empty-slots`'s seat count and all 23 tests stayed green. Pinning
   * both counts is what makes a partial revert visible.
   *
   * `draft/settings` is deliberately 2 reads / 1 filtered: the second is a label lookup over an
   * already-randomized order, and filtering it would blank a name rather than hide a team.
   */
  const FILES: Array<[file: string, reads: number, filtered: number]> = [
    ['lib/core-app/leagueHome.ts', 1, 1],
    ['app/api/rankings/route.ts', 1, 1],
    ['app/api/dynasty-outlook/route.ts', 1, 1],
    ['app/api/trade-value/league-teams/route.ts', 1, 1],
    // A departed franchise must not hold a seat or be dealt a draft slot.
    ['app/api/leagues/[leagueId]/fill-empty-slots/handler.ts', 2, 2],
    ['app/api/leagues/[leagueId]/draft/settings/route.ts', 2, 1],
  ]

  const countOf = (src: string, needle: string) => src.split(needle).length - 1

  for (const [file, reads, filtered] of FILES) {
    it(`${file} filters ${filtered} of its ${reads} league-wide read(s)`, () => {
      const src = code(file)
      // Blindness guard: if the reads moved or changed shape, this test is asserting nothing.
      expect(countOf(src, 'leagueTeam.findMany')).toBe(reads)
      expect(countOf(src, 'where: { leagueId, ...CURRENT_TEAMS }')).toBe(filtered)
    })
  }
})

/**
 * 🛑 THESE READ THE WHOLE LEAGUE ON PURPOSE. FILTERING ONE IS A BUG, NOT A MISSING MIGRATION.
 *
 * Of the 23 league-wide `leagueTeam.findMany` sites, only seven should exclude an archived team.
 * The rest are NAME LOOKUPS or POSITIONAL JOINS, and the failure mode is the opposite of the one
 * the filter exists for: instead of hiding a departed franchise, filtering blanks a label on a row
 * that is still shown, or silently shifts an array index.
 *
 * The danger this guards is somebody reading "7 of 23 migrated" as unfinished work and completing
 * the sweep mechanically. Each entry names what would break.
 */
describe('the league-wide reads that must NOT be filtered', () => {
  const UNFILTERED: Array<[string, string]> = [
    ['lib/core-app/matchup.ts', 'teamByExternal names opponents — filtering anonymises a past matchup'],
    ['lib/core-app/commissionerWaivers.ts', 'names waiver rows'],
    ['lib/core-app/leaguePairing.ts', 'resolves ONE team by externalId; filtering breaks an explicit franchise mapping'],
    ['app/api/league/trades-panel/route.ts', 'labels trade partners — a past trade with a departed team must keep its name'],
    ['app/api/discover/orphan-teams/route.ts', 'only attaches a W-L record; the card comes from the roster row, so filtering shows a fake 0-0'],
    ['app/api/leagues/[leagueId]/claim-roster/handler.ts', 'labels placeholders; claimability is decided by the roster query, not here'],
    ['app/api/leagues/[leagueId]/downsize/handler.ts', 'nameByExternal — filtering renders "Team" instead of the name'],
    ['app/api/leagues/[leagueId]/rivalries/[rivalryId]/head-to-head/route.ts', 'history; filtering anonymises the rivalry we preserved the row for'],
    ['app/api/leagues/[leagueId]/draft/import/validate/route.ts', 'POSITIONAL ZIP: teams[index] against rosters — filtering misnames every team'],
    ['app/api/leagues/[leagueId]/zombie/summary/route.ts', 'POSITIONAL ZIP: teams[i] against rosters[i] — filtering misaligns every row'],
    ['app/api/leagues/[leagueId]/dynasty-projections/handler.ts', 'teams.map(externalId) identifies a traded pick ORIGINAL owner; filtering degrades pick provenance'],
  ]

  for (const [file, why] of UNFILTERED) {
    it(`${file} stays league-wide — ${why}`, () => {
      const src = code(file)
      // Blindness guard: if the read moved, this test is asserting nothing.
      expect(src).toContain('leagueTeam.findMany')
      expect(src).not.toContain('CURRENT_TEAMS')
    })
  }
})
