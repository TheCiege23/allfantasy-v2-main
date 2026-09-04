import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildRosterIdMap, rosterIdsMatch } from '@/lib/core-app/rosterIdMatch'

/**
 * Which providers may write `WeeklyMatchup`, and the measured reason MFL still may not.
 *
 * 🛑 THE INVARIANT, UPDATED 2026-09-03 — READ THE DATE BEFORE TRUSTING THIS COMMENT.
 * `WeeklyMatchup.rosterId` is an Int. Until 2026-09-03 every reader joined it back to a team
 * with a NAIVE string map:
 *
 *     const teamBy = new Map(teams.map((t) => [t.externalId, t]))
 *     teamBy.get(String(row.rosterId))
 *
 * which only round-trips when `String(Number(teamId)) === teamId` — true for Sleeper, ESPN,
 * Yahoo and Fantrax (plain integers) and false for MFL (zero-padded franchise ids, e.g. "0001").
 *
 * That naive join is GONE from the readers now — see `lib/core-app/rosterIdMatch.ts`
 * (`buildRosterIdMap`/`rosterIdsMatch`), used by leagueScoreboard.ts, allPlay.ts,
 * dash3aPanels.ts and leagueHome.ts. It registers a numeric-normalized alias for an all-digits
 * externalId alongside the raw one, so `String(row.rosterId)` finds an MFL team too, and is a
 * no-op for the four providers that were already fine.
 *
 * ⚠ THIS DOES NOT MEAN MFL CAN WRITE MATCHUPS NOW. `MflAdapter` still stores
 * `source_team_id: team.franchiseId` verbatim, and the DECISION about what a real MFL writer
 * should store (padded, unpadded, or a schema change) is still open — see the note in
 * lib/import-os/collector/index.ts. Only one of that note's three costly options has
 * actually been done; a second (the schema change) is now PREPARED but NOT APPLIED — see
 * prisma/migrations-pending/20260903222531_weekly_matchup_roster_id_text/README.md entry.
 * This file's job is now split in two: prove the read-side fix really works, and keep
 * confirming the writer itself is still, correctly, absent.
 *
 * This file exists because everything needed to BUILD that collector already exists —
 * getMflAuthForUser, the TYPE=schedule fetch, parseMflSchedule, applySchedule — so the next
 * person to look will find a short, obvious, wrong task if they skip straight to writing it.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

/** The join a NAIVE reader performs, reduced to the one thing that breaks it for MFL. */
const survivesTheJoin = (externalId: string) => String(Number(externalId)) === externalId

describe('WeeklyMatchup rosterId must round-trip to a team externalId', () => {
  it.each([
    ['sleeper', '1'],
    ['sleeper', '12'],
    ['espn', '3'],
    ['fantrax', '7'],
  ])('%s id %s survives Int -> String under a naive join', (_provider, id) => {
    expect(survivesTheJoin(id)).toBe(true)
  })

  /*
   * The measurement, using the value the repo's own MFL fixtures actually contain. Not a
   * hypothetical: `Number('0001')` is 1 and `String(1)` is "1", which a NAIVE reader will not
   * match against "0001" — this is exactly the case `rosterIdMatch.ts` exists to handle, and
   * the next `describe` block proves it does.
   */
  it.each(['0001', '0002', '0010'])('MFL franchise id %s does NOT survive a naive join', (id) => {
    expect(survivesTheJoin(id)).toBe(false)
  })

  it('and the padded id is what MFL actually stores, verbatim', () => {
    const adapter = read('lib/league-import/adapters/mfl/MflAdapter.ts')
    expect(adapter).toContain('source_team_id: team.franchiseId')
    // Nothing normalizes it on the way in — the write-side decision is still open.
    expect(adapter).not.toMatch(/franchiseId[^\n]*padStart/)
    expect(adapter).not.toMatch(/franchiseId[^\n]*replace\(\/\^0\+/)
  })
})

describe('rosterIdMatch.ts actually resolves a zero-padded id, not just in theory', () => {
  it('buildRosterIdMap finds an MFL-style team by its Int-truncated rosterId', () => {
    const teams = [
      { externalId: '0001', name: 'Franchise One' },
      { externalId: '0012', name: 'Franchise Twelve' },
    ]
    const teamBy = buildRosterIdMap(teams, (t) => t.externalId)
    // What WeeklyMatchup.rosterId actually holds after the Int column has truncated it.
    expect(teamBy.get(String(1))?.name).toBe('Franchise One')
    expect(teamBy.get(String(12))?.name).toBe('Franchise Twelve')
    // The raw, unpadded lookup a non-MFL reader already relied on still works too.
    expect(teamBy.get('0001')?.name).toBe('Franchise One')
  })

  it('is a no-op for a non-numeric externalId, e.g. a Yahoo team key', () => {
    const teams = [{ externalId: '449.l.12345.t.3', name: 'Yahoo Team' }]
    const teamBy = buildRosterIdMap(teams, (t) => t.externalId)
    expect(teamBy.size).toBe(1)
    expect(teamBy.get('449.l.12345.t.3')?.name).toBe('Yahoo Team')
  })

  it('rosterIdsMatch agrees, for the direct-comparison call sites', () => {
    expect(rosterIdsMatch('0001', 1)).toBe(true)
    expect(rosterIdsMatch('12', 12)).toBe(true)
    expect(rosterIdsMatch('1', 2)).toBe(false)
    expect(rosterIdsMatch(null, 1)).toBe(false)
    expect(rosterIdsMatch(undefined, 1)).toBe(false)
  })

  /**
   * ⚠ `rosterId` ALSO ARRIVES AS A STRING NOW, from any reader sourced off
   * `AllPlayBoard`/`WeeklyMatchup` post text-column migration — not just as the
   * legacy Int this function was originally written against. A version that
   * only coerced `externalId` and compared it to the raw `rosterId` number
   * would silently return false for every one of these once `rosterId` is a
   * string (`1 === "1"` is false), which is exactly the bug this locks in.
   */
  it('rosterIdsMatch agrees when rosterId itself is already a string', () => {
    expect(rosterIdsMatch('0001', '1')).toBe(true)
    expect(rosterIdsMatch('12', '12')).toBe(true)
    expect(rosterIdsMatch('1', '2')).toBe(false)
    expect(rosterIdsMatch(null, '1')).toBe(false)
    expect(rosterIdsMatch(undefined, '1')).toBe(false)
  })

  it('and the four readers actually call it, not a reintroduced naive join', () => {
    for (const [file, expected] of [
      ['lib/core-app/leagueScoreboard.ts', 'buildRosterIdMap(teams, (t) => t.externalId)'],
      ['lib/core-app/allPlay.ts', 'buildRosterIdMap(teams, (t) => t.externalId)'],
      ['lib/core-app/leagueHome.ts', 'rosterIdsMatch(yours?.externalId, r.rosterId)'],
    ] as const) {
      const src = read(file)
      expect(src).toContain(expected)
      expect(src).not.toContain('new Map(teams.map((t) => [t.externalId, t]))')
    }
    const dash3a = read('lib/core-app/dash3aPanels.ts')
    expect(dash3a).toContain('buildRosterIdMap(')
    expect(dash3a).not.toContain("leagueTeams.map((t) => [String(t.externalId)")
  })
})

describe('the absence of an MFL matchup writer is recorded, not accidental', () => {
  /*
   * If someone reconciles the id space and adds the collector, this test SHOULD fail — the
   * note above it is then wrong and must be updated in the same change. That is the point:
   * the constraint and its explanation move together, or neither moves.
   */
  const index = read('lib/import-os/collector/index.ts')

  it('exports the writers whose ids are safe', () => {
    expect(index).toContain('runExternalMatchupParity')
    expect(index).toContain('runFantraxMatchupParity')
  })

  it('exports no MFL matchup writer', () => {
    expect(index).not.toMatch(/runMflMatchupParity/)
  })

  it('says why, in a form the next reader will actually hit', () => {
    expect(index).toContain('MFL STILL HAS NO WEEKLY-MATCHUP WRITER')
    expect(index).toContain('0001')
    // The read-side fix is dated so nobody mistakes this comment for describing the
    // pre-2026-09-03 state, where the readers themselves were also part of the problem.
    expect(index).toContain('RESOLVED 2026-09-03')
    expect(index).toContain('rosterIdMatch.ts')
    // Fleaflicker is absent for a different reason and conflating them would send
    // someone hunting an id bug in a provider that has no schedule endpoint at all.
    expect(index).toContain('FLEAFLICKER IS ABSENT FOR A DIFFERENT AND SIMPLER REASON')
  })
})
