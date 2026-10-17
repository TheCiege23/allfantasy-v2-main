import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'
import YourWeek from '@/components/core-app/screens/YourWeek'
import { WeekBoard } from '@/components/core-app/boards/WeekBoard'
import { lineupProjectionFor, type WeekLineups } from '@/lib/core-app/weekLineups'
import type { LeagueWeekBoard, WeekBoard as WeekBoardData, WeekMatchup } from '@/lib/core-app/weekBoard'
import type { RailMatchup, RailSideProjection } from '@/lib/core-app/railMatchups'

/*
 * This week's LINEUP projections on the Your Week screens (2026-09-30): AllFantasy's own engine (AF)
 * and the provider's (API), summed over each lineup as set — the rail's own totals, handed down.
 * A different measure from the week model's team-average projection, and never another week's.
 */

const side = (over: Partial<RailSideProjection> = {}): RailSideProjection => ({
  projected: 110, afProjected: 118.2, afEngine: 121.5, afEngineFrom: 9, pricedFrom: 9, starterCount: 9, ...over,
})

const rail = (over: Partial<RailMatchup> = {}): RailMatchup => ({
  leagueId: 'l1', yourTeam: 'Mine', yourAvatarUrl: null, yourScore: 0,
  yourProjection: side(), opponentTeam: 'Gridiron Ghosts', opponentAvatarUrl: null, opponentScore: 0,
  opponentProjection: side({ afProjected: 112.4, afEngine: 115 }),
  unpaired: false, standing: null, scored: false, freshAt: null, source: 'live_cache', season: 2026, week: 3,
  ...over,
})

const lineups = (m: Partial<RailMatchup> = {}, projectionWeek = { season: '2026', week: 3 }): WeekLineups => ({
  byLeague: { l1: rail(m) },
  projectionWeek,
})

function matchup(over: Partial<WeekMatchup> = {}): WeekMatchup {
  return {
    leagueId: 'l1', leagueName: 'Turf Wars', platform: 'sleeper', leagueImageUrl: null, season: 2026, week: 3,
    opponent: { rosterId: '2', name: 'Gridiron Ghosts', avatarUrl: null }, elimination: false,
    projection: { you: 120, them: 119, margin: 1, winProbability: 0.52 }, form: null, yourSampleWeeks: 5,
    live: null, href: '/core/matchup?league=l1',
    ...over,
  } as WeekMatchup
}

describe('lineupProjectionFor', () => {
  it('gives both sources for both sides in the matchup’s own week', () => {
    expect(lineupProjectionFor(lineups(), 'l1', 2026, 3)).toEqual({
      af: { you: 121.5, them: 115 }, api: { you: 118.2, them: 112.4 }, partial: false, unpaired: false,
    })
  })

  it('🛑 returns nothing for a fallback projection week, or a different week on the rail', () => {
    expect(lineupProjectionFor(lineups({}, { season: '2026', week: 4 }), 'l1', 2026, 3)).toBeNull()
    expect(lineupProjectionFor(lineups({ week: 4 }), 'l1', 2026, 3)).toBeNull()
    expect(lineupProjectionFor(null, 'l1', 2026, 3)).toBeNull()
  })

  it('an elimination week has no opponent side, and a partial lineup is flagged', () => {
    const v = lineupProjectionFor(lineups({ unpaired: true, yourProjection: side({ afEngineFrom: 7 }) }), 'l1', 2026, 3)
    expect(v).toEqual({ af: { you: 121.5, them: null }, api: { you: 118.2, them: null }, partial: true, unpaired: true })
  })
})

describe('the Your Week screens draw the lineup line', () => {
  it('single-league hero', () => {
    const board: LeagueWeekBoard = {
      leagueId: 'l1', leagueName: 'Turf Wars', platform: 'sleeper', season: 2026, week: 3, yours: matchup(),
      sidelines: [], rivalry: null, records: {}, yourRosterId: '1', yourTeamName: 'My Team', yourAvatarUrl: null,
    } as LeagueWeekBoard
    const { container } = render(<YourWeekLeague board={board} allWeeksHref="/core/week" lineups={lineups()} />)
    const line = container.querySelector('.af-wk-lineup')
    expect(line?.textContent).toBe('Lineup proj · AF 121.5–115.0 · Sleeper 118.2–112.4')
  })

  it('the full table — including a matchup the week model cannot project yet', () => {
    const data = {
      season: 2026, week: 3, coinFlips: [matchup()], leaning: [],
      unprojected: [matchup({ projection: null, leagueId: 'l1' })],
      eliminationWeeks: [], model: { basis: 'b', sampleSize: 1 }, withoutSchedule: 0, firstKickoffAt: null,
    } as unknown as WeekBoardData
    const { container } = render(<YourWeek data={data} rivalriesHref="/r" lineups={lineups()} />)
    const lines = [...container.querySelectorAll('.af-wk-lineup')].map((e) => e.textContent)
    expect(lines).toHaveLength(2)
    expect(lines.every((t) => t?.includes('AF 121.5–115.0'))).toBe(true)
  })

  it('the default two-column board', () => {
    const data = {
      season: 2026, week: 3, coinFlips: [matchup()], leaning: [], unprojected: [], eliminationWeeks: [],
      model: { basis: 'b', sampleSize: 1 }, withoutSchedule: 0, firstKickoffAt: null,
    } as unknown as WeekBoardData
    const { container } = render(
      <WeekBoard board={data} outlook={null} rivalriesHref="/r" allHref="/a" totalLeagues={1} lineups={lineups()} />,
    )
    expect(container.querySelector('.af-wk-lineup')?.textContent).toContain('AF 121.5–115.0')
  })

  it('without lineups, nothing is drawn — the screens are exactly as before', () => {
    const { container } = render(
      <WeekBoard
        board={{ season: 2026, week: 3, coinFlips: [matchup()], leaning: [], unprojected: [], eliminationWeeks: [],
          model: { basis: 'b', sampleSize: 1 }, withoutSchedule: 0, firstKickoffAt: null } as unknown as WeekBoardData}
        outlook={null} rivalriesHref="/r" allHref="/a" totalLeagues={1}
      />,
    )
    expect(container.querySelector('.af-wk-lineup')).toBeNull()
  })
})
