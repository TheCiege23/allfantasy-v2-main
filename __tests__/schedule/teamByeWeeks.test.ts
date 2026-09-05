/**
 * Deriving a team's bye week from the schedule.
 *
 * 🛑 WHY THIS IS DERIVED AND NOT READ. There is no bye-week column anywhere that holds data.
 * `RedraftRosterPlayer.byeWeek` and `DraftPick.byeWeek` are real `Int?` columns nothing fills —
 * 60,909 of 60,911 rows null — and `fantasy_players.bye_week` sits on a table with ZERO rows. A
 * team's bye is the regular-season week it has no game, and `SportsGame` has that: measured on
 * production, NFL 2026, 32 teams, 32 with exactly one gap, 0 ambiguous.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ queryRaw: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: h.queryRaw } }))

import { byeForTeam, resolveTeamByeWeeks } from '@/lib/schedule/teamByeWeeks'

beforeEach(() => {
  vi.resetAllMocks()
  h.queryRaw.mockResolvedValue([])
})

describe('resolveTeamByeWeeks', () => {
  it('maps full schedule names onto canonical abbreviations', async () => {
    // The `regular` rows name teams in full; every consumer holds an abbreviation.
    h.queryRaw.mockResolvedValue([
      { team: 'Arizona Cardinals', bye: 14 },
      { team: 'Green Bay Packers', bye: 11 },
      { team: 'Buffalo Bills', bye: 7 },
    ])

    const byes = await resolveTeamByeWeeks('NFL', 2026)

    expect(byes.get('ARI')).toBe(14)
    expect(byes.get('GB')).toBe(11)
    expect(byes.get('BUF')).toBe(7)
  })

  it('🛑 drops a club that does not map to a canonical abbreviation', async () => {
    /*
     * `normalizeTeamAbbrev` returns its INPUT UPPERCASED when nothing matches — not null. Without
     * the canonical-set check, a stale club (the schedule's null-seasonType rows still carry a
     * "St. Louis Rams") becomes a plausible-looking key that silently never joins to a player.
     */
    h.queryRaw.mockResolvedValue([
      { team: 'St. Louis Rams', bye: 3 },
      { team: 'Buffalo Bills', bye: 7 },
    ])

    const byes = await resolveTeamByeWeeks('NFL', 2026)

    expect(byes.has('BUF')).toBe(true)
    expect(byes.size).toBe(1)
    expect([...byes.keys()]).not.toContain('ST. LOUIS RAMS')
  })

  it('🛑 refuses a season outside a plausible range, so the 2099 rows are unreachable', async () => {
    /*
     * `SportsGame` holds two rows for season 2099. Deriving with `max(season)` picks them and
     * collapses the calculation to 4 teams over 1 week — zero byes, looking exactly like a
     * schedule that is not loaded. The season is a parameter and is bounded.
     */
    expect((await resolveTeamByeWeeks('NFL', 2099)).size).toBe(0)
    expect((await resolveTeamByeWeeks('NFL', 1999)).size).toBe(0)
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('returns an empty map for a missing or unparseable season rather than guessing one', async () => {
    expect((await resolveTeamByeWeeks('NFL', null)).size).toBe(0)
    expect((await resolveTeamByeWeeks('NFL', undefined)).size).toBe(0)
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('survives the query failing', async () => {
    h.queryRaw.mockRejectedValue(new Error('db down'))
    expect((await resolveTeamByeWeeks('NFL', 2026)).size).toBe(0)
  })

  it('🛑 asks only for regular-season rows', async () => {
    /*
     * Not merely to exclude preseason. The same season exists under two spellings written by
     * different importers, and they disagree about team naming: `regular` says "Arizona
     * Cardinals", NULL-seasonType says "ARI". Taking both turns 32 teams into 65 and makes 33 of
     * them ambiguous.
     */
    await resolveTeamByeWeeks('NFL', 2026)
    const sql = String(h.queryRaw.mock.calls[0][0])
    expect(sql).toContain('regular')
    // And it must never take the max: that is how 2099 gets in.
    expect(sql).not.toContain('max(season)')
  })

  it('🛑 asks the database for exactly-one-gap teams only', async () => {
    // Two gaps means an incomplete schedule; a "first gap" would be a guess shown as a fact.
    await resolveTeamByeWeeks('NFL', 2026)
    expect(String(h.queryRaw.mock.calls[0][0])).toContain('HAVING count(*) = 1')
  })
})

describe('byeForTeam', () => {
  const byes = new Map([['GB', 11], ['BUF', 7]])

  it('accepts an abbreviation or a full name', () => {
    expect(byeForTeam(byes, 'GB')).toBe(11)
    expect(byeForTeam(byes, 'Green Bay Packers')).toBe(11)
    expect(byeForTeam(byes, 'green bay')).toBe(11)
  })

  it('🛑 returns null for a player with no team, never a week', () => {
    /*
     * 9 of 214 players on the measured league carry `team = null` — free agents, the same names
     * that carry no dynasty value. A bye invented for them would be a fact a manager plans around.
     */
    expect(byeForTeam(byes, null)).toBeNull()
    expect(byeForTeam(byes, undefined)).toBeNull()
    expect(byeForTeam(byes, '')).toBeNull()
  })

  it('returns null for a team the schedule could not resolve', () => {
    expect(byeForTeam(byes, 'PIT')).toBeNull()
  })
})
