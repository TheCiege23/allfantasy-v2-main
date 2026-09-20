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
   * A source guard, because these are the four sites where an archived franchise would be VISIBLE:
   * the standings list, the power rankings, the dynasty outlook, and the trade-counterparty picker.
   * Nothing type-checks a `where` clause back into place, and two of these use `(prisma as any)`,
   * so a revert here would be silent. Comments are stripped first — the note in `leagueHome.ts`
   * explaining the filter names the symbol it is explaining.
   */
  const FILES = [
    'lib/core-app/leagueHome.ts',
    'app/api/rankings/route.ts',
    'app/api/dynasty-outlook/route.ts',
    'app/api/trade-value/league-teams/route.ts',
  ]

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

  for (const file of FILES) {
    it(`${file} spreads CURRENT_TEAMS into its league-wide read`, () => {
      const src = code(file)
      // Guard against the guard being blind: the file must still contain the read it is about.
      expect(src).toContain('leagueTeam.findMany')
      expect(src).toContain('CURRENT_TEAMS')
      expect(src).toMatch(/where:\s*\{\s*leagueId,\s*\.\.\.CURRENT_TEAMS\s*\}/)
    })
  }
})
