import { describe, expect, it } from 'vitest'
import { buildNextGameMap, withNewestKickoffs } from '@/lib/core-app/nextGameMap'

/*
 * The production rows for 2026 week 11 after a flex swap, as they stood on 2026-11-17: the weekly
 * sources (Rolling Insights, API-Sports) still carried the old slots; TheSportsDB, fetched later and
 * untyped, had the new ones, and ESPN agreed with it.
 */
const MON = new Date('2026-11-16T03:00:05Z')
const TUE = new Date('2026-11-17T18:13:28Z')
const ONE_PM = new Date('2026-11-22T18:00:00Z')
const FOUR_25 = new Date('2026-11-22T21:25:00Z')

const row = (homeTeam: string, awayTeam: string, startTime: Date, fetchedAt: Date, seasonType: string | null) => ({
  homeTeam, awayTeam, startTime, fetchedAt, seasonType, venue: null as string | null,
})

const week11 = [
  row('Philadelphia Eagles', 'Pittsburgh Steelers', FOUR_25, MON, 'regular'), // rolling_insights
  row('PHI', 'PIT', FOUR_25, MON, 'regular'), // api_sports
  row('Philadelphia Eagles', 'Pittsburgh Steelers', ONE_PM, TUE, null), // thesportsdb
  row('New York Giants', 'Jacksonville Jaguars', ONE_PM, MON, 'regular'),
  row('NYG', 'JAX', ONE_PM, MON, 'regular'),
  row('New York Giants', 'Jacksonville Jaguars', FOUR_25, TUE, null),
  row('Buffalo Bills', 'Miami Dolphins', ONE_PM, MON, 'regular'),
  row('Buffalo Bills', 'Miami Dolphins', ONE_PM, TUE, null),
]
const typed = week11.filter((g) => g.seasonType === 'regular')

describe('withNewestKickoffs', () => {
  it('moves both flexed games to the time the newest source has', () => {
    const map = buildNextGameMap(withNewestKickoffs(typed, week11), new Set(['PHI', 'PIT', 'NYG', 'JAX', 'BUF']))
    expect(map.get('PHI')?.at).toEqual(ONE_PM)
    expect(map.get('PIT')?.at).toEqual(ONE_PM)
    expect(map.get('NYG')?.at).toEqual(FOUR_25)
    expect(map.get('JAX')?.at).toEqual(FOUR_25)
    expect(map.get('BUF')?.at).toEqual(ONE_PM)
  })

  it('shows the stale time without the correction, which is the bug', () => {
    const map = buildNextGameMap(typed, new Set(['PHI', 'NYG']))
    expect(map.get('PHI')?.at).toEqual(FOUR_25)
    expect(map.get('NYG')?.at).toEqual(ONE_PM)
  })

  it('keeps every other field of the typed row', () => {
    const [phi] = withNewestKickoffs([typed[0]], week11)
    expect(phi).toMatchObject({ homeTeam: 'Philadelphia Eagles', seasonType: 'regular', fetchedAt: MON, startTime: ONE_PM })
  })

  it('lets a corrector fix a kickoff but never add a game', () => {
    const out = withNewestKickoffs(typed.filter((g) => g.homeTeam !== 'Buffalo Bills'), week11)
    expect(out.some((g) => g.homeTeam === 'Buffalo Bills')).toBe(false)
    expect(out).toHaveLength(4)
  })

  it('ignores a newer row for the same pairing more than a week away (a preseason meeting)', () => {
    const august = row('Philadelphia Eagles', 'Pittsburgh Steelers', new Date('2026-08-15T23:00:00Z'), TUE, null)
    const [phi] = withNewestKickoffs([typed[0]], [august])
    expect(phi.startTime).toEqual(FOUR_25)
  })

  it('matches a pairing filed home/away the other way round', () => {
    const flipped = row('Pittsburgh Steelers', 'Philadelphia Eagles', ONE_PM, TUE, null)
    expect(withNewestKickoffs([typed[0]], [flipped])[0].startTime).toEqual(ONE_PM)
  })

  it('leaves a row alone when the disagreeing row is older, or carries no fetch time', () => {
    const older = row('Philadelphia Eagles', 'Pittsburgh Steelers', ONE_PM, new Date('2026-11-10T00:00:00Z'), null)
    expect(withNewestKickoffs([typed[0]], [older])[0].startTime).toEqual(FOUR_25)
    const undated = { homeTeam: 'Philadelphia Eagles', awayTeam: 'Pittsburgh Steelers', startTime: ONE_PM, fetchedAt: null }
    expect(withNewestKickoffs([typed[0]], [undated])[0].startTime).toEqual(FOUR_25)
  })

  it('keeps its own kickoff on a fetch-time tie', () => {
    const tie = row('Philadelphia Eagles', 'Pittsburgh Steelers', ONE_PM, MON, null)
    expect(withNewestKickoffs([typed[0]], [tie])[0].startTime).toEqual(FOUR_25)
  })
})
