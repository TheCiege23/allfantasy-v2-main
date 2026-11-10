import { describe, expect, it, vi } from 'vitest'
import { buildWeekKickoffMap, nflRegularSlate } from '@/lib/redraft/lineupLock'

/*
 * The shape measured on production 2026-11-09 for 2026 week 2: the regular-season slate, tagged
 * `regular` by one source and untagged (same kickoffs) by another, PLUS preseason games filed under the
 * same week number — tagged `pre` by one source and untagged by another (`espn`, Aug 13–16).
 */
const at = (iso: string) => new Date(iso)
const KC_REGULAR = at('2026-09-20T17:00:00Z')
const rows = [
  { homeTeam: 'KC', awayTeam: 'DEN', startTime: KC_REGULAR, seasonType: 'regular' },
  { homeTeam: 'KC', awayTeam: 'DEN', startTime: KC_REGULAR, seasonType: null },
  { homeTeam: 'BUF', awayTeam: 'MIA', startTime: at('2026-09-18T00:15:00Z'), seasonType: 'regular' },
  { homeTeam: 'NYG', awayTeam: 'DAL', startTime: at('2026-09-22T00:15:00Z'), seasonType: null }, // only an untagged source has it
  { homeTeam: 'KC', awayTeam: 'ARI', startTime: at('2026-08-15T00:00:00Z'), seasonType: null }, // preseason, untagged
  { homeTeam: 'KC', awayTeam: 'CHI', startTime: at('2026-08-22T17:00:00Z'), seasonType: 'pre' },
  { homeTeam: 'BUF', awayTeam: 'PIT', startTime: at('2026-08-13T23:00:00Z'), seasonType: null },
]
const db = (r: unknown[]) => ({ sportsGame: { findMany: vi.fn(async () => r) } }) as never

describe('NFL lineup locks ignore preseason games filed under a regular-season week', () => {
  it('a team locks at its regular-season kickoff, not an August preseason game', async () => {
    const map = await buildWeekKickoffMap(db(rows), { sport: 'NFL', season: 2026, week: 2 })
    expect(map.byTeam.get('KC')).toEqual(KC_REGULAR)
    expect(map.byTeam.get('BUF')).toEqual(at('2026-09-18T00:15:00Z'))
    expect(map.byTeam.has('ARI')).toBe(false)
    expect(map.byTeam.has('CHI')).toBe(false)
    // The trade-deadline reader takes `firstKickoff`: the week's real opener, not mid-August.
    expect(map.firstKickoff).toEqual(at('2026-09-18T00:15:00Z'))
    expect(map.warnings.join(' ')).toMatch(/Ignored 3 NFL preseason\/postseason row/)
  })

  it('an in-season game only an untagged source carries still counts', () => {
    expect(nflRegularSlate(rows).map((r) => `${r.homeTeam}-${r.awayTeam}`)).toContain('NYG-DAL')
  })

  it('a postseason game filed under week 1 numbers is not a week-1 kickoff', () => {
    const week1 = [
      { homeTeam: 'KC', awayTeam: 'BAL', startTime: at('2026-09-11T00:20:00Z'), seasonType: 'regular' },
      { homeTeam: 'KC', awayTeam: 'PHI', startTime: at('2027-02-14T23:30:00Z'), seasonType: null },
      { homeTeam: 'KC', awayTeam: 'HOU', startTime: at('2027-01-17T21:00:00Z'), seasonType: 'post' },
    ]
    expect(nflRegularSlate(week1).map((r) => r.awayTeam)).toEqual(['BAL'])
  })

  it('one tagged game is enough to anchor the week: Sunday and Monday untagged games still count', async () => {
    // The e2e zombie rehearsal's shape: a recorded slate with no season type, plus one game tagged
    // regular at the week's opener (Thursday).
    const partial = [
      { homeTeam: 'CONTROLLED_CLOCK_HOME', awayTeam: 'CONTROLLED_CLOCK_AWAY', startTime: at('2025-09-05T00:20:00Z'), seasonType: 'regular' },
      { homeTeam: 'PHI', awayTeam: 'DAL', startTime: at('2025-09-05T00:20:00Z'), seasonType: null },
      { homeTeam: 'KC', awayTeam: 'LAC', startTime: at('2025-09-06T00:00:00Z'), seasonType: null },
      { homeTeam: 'BUF', awayTeam: 'BAL', startTime: at('2025-09-08T00:20:00Z'), seasonType: null },
      { homeTeam: 'CHI', awayTeam: 'MIN', startTime: at('2025-09-09T00:15:00Z'), seasonType: null },
      { homeTeam: 'KC', awayTeam: 'ARI', startTime: at('2025-08-10T00:00:00Z'), seasonType: null }, // preseason
    ]
    const map = await buildWeekKickoffMap(db(partial), { sport: 'NFL', season: 2025, week: 1 })
    expect(map.byTeam.get('MIN')).toEqual(at('2025-09-09T00:15:00Z'))
    expect(map.byTeam.get('BUF')).toEqual(at('2025-09-08T00:20:00Z'))
    expect(map.byTeam.get('KC')).toEqual(at('2025-09-06T00:00:00Z'))
    expect(map.byTeam.has('ARI')).toBe(false)
  })

  it('a week with no tagged regular game keeps its untagged rows (nothing to judge them by)', async () => {
    const untagged = [
      { homeTeam: 'KC', awayTeam: 'DEN', startTime: KC_REGULAR },
      { homeTeam: 'BUF', awayTeam: 'MIA', startTime: at('2026-09-18T00:15:00Z') },
    ]
    const map = await buildWeekKickoffMap(db(untagged), { sport: 'NFL', season: 2026, week: 2 })
    expect(map.byTeam.get('KC')).toEqual(KC_REGULAR)
    expect(map.warnings).toEqual([])
  })
})
