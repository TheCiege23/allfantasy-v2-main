/**
 * Found live 2026-11-23: every imported league's "League scoreboard" said "Scores appear here once week
 * N is scored" mid-week, because the route read only `TeamWeekResult`. These pin the stored-week board.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importedBoardGames } from '@/lib/matchup-center/importedScoreboard'

const names: Record<string, string> = { '1': '(F) SF TEP', '2': 'Connor0488', '3': 'GrindingFFB', '4': 'Scorescotty', '5': 'Bye Team' }
const nameOf = (id: string) => names[id] ?? `Team ${id}`

describe('imported league scoreboard', () => {
  const rows = [
    { rosterId: '3', matchupId: 2, game: 1, pointsFor: 120.5 },
    { rosterId: '2', matchupId: 1, game: 1, pointsFor: 184.04 },
    { rosterId: '4', matchupId: 2, game: 1, pointsFor: 98 },
    { rosterId: '1', matchupId: 1, game: 1, pointsFor: 77.04 },
    { rosterId: '5', matchupId: null, game: 1, pointsFor: 0 },
  ]

  it('pairs rows into games, the viewer first, byes last', () => {
    const g = importedBoardGames(rows, { nameOf, viewerRosterId: '1', weekFinal: false })
    expect(g).toHaveLength(3)
    expect(g[0]).toMatchObject({ mine: true, status: 'live', home: { teamName: '(F) SF TEP', totalPoints: 77.04 }, away: { teamName: 'Connor0488', totalPoints: 184.04 } })
    expect(g[1]).toMatchObject({ mine: false, home: { teamName: 'GrindingFFB', totalPoints: 120.5 }, away: { teamName: 'Scorescotty', totalPoints: 98 } })
    expect(g[2]).toMatchObject({ away: null, home: { teamName: 'Bye Team' } })
  })

  it('a finished week reads final; an unscored week shows no 0-0', () => {
    expect(importedBoardGames(rows, { nameOf, viewerRosterId: '1', weekFinal: true })[0].status).toBe('final')
    const unscored = importedBoardGames(rows.map((r) => ({ ...r, pointsFor: 0 })), { nameOf, viewerRosterId: '1', weekFinal: false })
    expect(unscored[0]).toMatchObject({ status: 'upcoming', home: { totalPoints: null }, away: { totalPoints: null } })
  })

  it('a league that plays several games a week keeps each game apart', () => {
    const multi = [
      { rosterId: '1', matchupId: 1, game: 1, pointsFor: 10 },
      { rosterId: '2', matchupId: 1, game: 1, pointsFor: 12 },
      { rosterId: '1', matchupId: 1, game: 2, pointsFor: 30 },
      { rosterId: '3', matchupId: 1, game: 2, pointsFor: 20 },
    ]
    const g = importedBoardGames(multi, { nameOf, viewerRosterId: '1', weekFinal: false })
    expect(g.map((x) => `${x.home.teamName} v ${x.away?.teamName}`)).toEqual(['(F) SF TEP v Connor0488', '(F) SF TEP v GrindingFFB'])
  })

  it('the route serves an imported league from the stored week before the native-only read', () => {
    const src = readFileSync(resolve(__dirname, '../../app/api/leagues/[leagueId]/scoring/matchups/route.ts'), 'utf8')
    const branch = src.indexOf('if (league.platformLeagueId && !isNativePlatform(league.platform))')
    expect(branch).toBeGreaterThan(-1)
    expect(src.indexOf('loadImportedScoreboard({')).toBeGreaterThan(branch)
    expect(branch).toBeLessThan(src.indexOf('prisma.teamWeekResult.findMany'))
    expect(src).toMatch(/platformLeagueId: true/)
  })
})
