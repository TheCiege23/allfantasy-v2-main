import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Which providers may write `WeeklyMatchup`, and the measured reason MFL may not.
 *
 * 🛑 THE INVARIANT. `WeeklyMatchup.rosterId` is an Int, and every reader joins it back to a
 * team as a STRING:
 *
 *     const teamBy = new Map(teams.map((t) => [t.externalId, t]))
 *     teamBy.get(String(row.rosterId))
 *
 * — lib/core-app/leagueScoreboard.ts, allPlay.ts, dash3aPanels.ts and leagueHome.ts all do
 * this. So a provider may only write matchup rows if `String(Number(teamId)) === teamId`.
 * Sleeper, ESPN, Yahoo and Fantrax satisfy that because their team ids are plain integers.
 *
 * ⚠ MFL DOES NOT, AND THE FAILURE IS SILENT. Its franchise ids are zero-padded — this repo's
 * own fixtures use `franchiseId: '0001'` — and `MflAdapter` stores `source_team_id:
 * team.franchiseId` verbatim, so `league_teams.externalId` is "0001". A collector would write
 * rosterId 1, the row count would look right, and every board would render an unknown manager.
 * Same shape as the `ingestCFBDStats` failure CLAUDE.md records: a surface pointed at data
 * nothing can resolve fails silently and looks correct.
 *
 * This file exists because everything needed to BUILD that collector already exists —
 * getMflAuthForUser, the TYPE=schedule fetch, parseMflSchedule, applySchedule — so the next
 * person to look will find a short, obvious, wrong task.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

/** The join every WeeklyMatchup reader performs, reduced to the one thing that can break it. */
const survivesTheJoin = (externalId: string) => String(Number(externalId)) === externalId

describe('WeeklyMatchup rosterId must round-trip to a team externalId', () => {
  it.each([
    ['sleeper', '1'],
    ['sleeper', '12'],
    ['espn', '3'],
    ['fantrax', '7'],
  ])('%s id %s survives Int -> String', (_provider, id) => {
    expect(survivesTheJoin(id)).toBe(true)
  })

  /*
   * The measurement, using the value the repo's own MFL fixtures actually contain. Not a
   * hypothetical: `Number('0001')` is 1 and `String(1)` is "1", which no reader will match
   * against "0001".
   */
  it.each(['0001', '0002', '0010'])('MFL franchise id %s does NOT survive it', (id) => {
    expect(survivesTheJoin(id)).toBe(false)
  })

  it('and the padded id is what MFL actually stores, verbatim', () => {
    const adapter = read('lib/league-import/adapters/mfl/MflAdapter.ts')
    expect(adapter).toContain('source_team_id: team.franchiseId')
    // Nothing normalizes it on the way in.
    expect(adapter).not.toMatch(/franchiseId[^\n]*padStart/)
    expect(adapter).not.toMatch(/franchiseId[^\n]*replace\(\/\^0\+/)
  })

  it('and the readers really do join on the raw externalId', () => {
    const scoreboard = read('lib/core-app/leagueScoreboard.ts')
    expect(scoreboard).toContain('new Map(teams.map((t) => [t.externalId, t]))')
    expect(scoreboard).toContain('teamBy.get(String(r.rosterId))')
  })
})

describe('the absence of an MFL matchup writer is recorded, not accidental', () => {
  /*
   * If someone reconciles the id space and adds the collector, this test SHOULD fail — the
   * note above it is then wrong and must be updated in the same change. That is the point:
   * the constraint and its explanation move together, or neither moves.
   */
  const index = read('lib/fantasy-os/sync/collector/index.ts')

  it('exports the writers whose ids are safe', () => {
    expect(index).toContain('runExternalMatchupParity')
    expect(index).toContain('runFantraxMatchupParity')
  })

  it('exports no MFL matchup writer', () => {
    expect(index).not.toMatch(/runMflMatchupParity/)
  })

  it('says why, in a form the next reader will actually hit', () => {
    expect(index).toContain('MFL HAS NO WEEKLY-MATCHUP WRITER ON PURPOSE')
    expect(index).toContain('0001')
    // Fleaflicker is absent for a different reason and conflating them would send
    // someone hunting an id bug in a provider that has no schedule endpoint at all.
    expect(index).toContain('FLEAFLICKER IS ABSENT FOR A DIFFERENT AND SIMPLER REASON')
  })
})
