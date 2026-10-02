// @vitest-environment node
/**
 * 🛑 ONE GAME FROM TWO FEEDS WAS TWO ROWS (2026-10-01): "PIT at VIRGINIA TECH" and "Pittsburgh at
 * Virginia Tech", because the band keyed a game on its exact team names and the feeds spell teams
 * differently. Same sport + same kickoff + any team in common is one game — a team cannot play two
 * games at one kickoff.
 */
import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ games: vi.fn(), odds: vi.fn(), teams: vi.fn() }))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsGame: { findMany: h.games }, gameOdds: { findMany: h.odds }, sportsTeam: { findMany: h.teams } },
}))
import { getTodayStrip } from '@/lib/core-app/todayStrip'
import { clearStoredTeamLogoCache } from '@/lib/sport-teams/storedTeamLogos'

const PITT = 'https://r2.thesportsdb.com/images/media/team/badge/x3hydm1568478796.png'
const VT = 'https://r2.thesportsdb.com/images/media/team/badge/hwesp71564337090.png'
const now = new Date('2026-10-01T22:00:00Z')
const kickoff = new Date('2026-10-02T23:30:00Z')

beforeEach(() => {
  clearStoredTeamLogoCache()
  h.odds.mockReset()
  h.odds.mockResolvedValue([])
  h.teams.mockResolvedValue([
    { externalId: '1', name: 'Pittsburgh', shortName: null, city: null, logo: PITT, source: 'thesportsdb' },
    { externalId: '2', name: 'Virginia Tech', shortName: 'VT', city: null, logo: VT, source: 'thesportsdb' },
  ])
})

const g = (source: string, id: string, away: string, home: string, startTime = kickoff) =>
  ({ sport: 'NCAAF', source, externalId: id, startTime, week: 5, awayTeam: away, homeTeam: home })
const load = async () => (await getTodayStrip('u', [{ id: 'l', sport: 'NCAAF' }], now)).next24.filter((r) => r.kind === 'game')

it('the reported pair is one row, shown with the full names and both crests', async () => {
  h.games.mockResolvedValue([g('espn', 'e1', 'PIT', 'VIRGINIA TECH'), g('cfbd', 'c1', 'Pittsburgh', 'Virginia Tech')])
  const rows = await load()
  expect(rows).toHaveLength(1)
  expect(rows[0]!.game).toMatchObject({ away: 'Pittsburgh', home: 'Virginia Tech', awayLogo: PITT, homeLogo: VT })
  // The ESPN copy still provides the deep link, though it is not the copy shown.
  expect(rows[0]!.game?.href).toBe('/core/live?sport=NCAAF&game=e1')
})

it('merges when no name matches but both sides resolve to the same crests', async () => {
  h.games.mockResolvedValue([g('espn', 'e1', 'Pittsburgh', 'VT'), g('cfbd', 'c1', 'PITTSBURGH', 'Virginia Tech')])
  expect(await load()).toHaveLength(1)
})

it('merges a copy that lists the teams the other way round', async () => {
  h.games.mockResolvedValue([g('espn', 'e1', 'Virginia Tech', 'PIT'), g('cfbd', 'c1', 'Pittsburgh', 'Virginia Tech')])
  expect(await load()).toHaveLength(1)
})

it('keeps the line a hidden copy holds', async () => {
  h.games.mockResolvedValue([g('espn', 'e1', 'PIT', 'VIRGINIA TECH'), g('cfbd', 'c1', 'Pittsburgh', 'Virginia Tech')])
  h.odds.mockResolvedValue([{ sport: 'NCAAF', source: 'espn', gameExternalId: 'e1', spreadHome: -6.5, totalPoints: 51.5, fetchedAt: new Date('2026-10-01T21:50:00Z') }])
  expect((await load())[0]!.game?.odds).toBe('Virginia Tech favored by 6.5 · O/U 51.5')
})

it('different games are never merged: other kickoff, no team in common, or only placeholder names', async () => {
  h.games.mockResolvedValue([
    g('cfbd', 'c1', 'Pittsburgh', 'Virginia Tech'),
    g('cfbd', 'c2', 'Pittsburgh', 'Virginia Tech', new Date('2026-10-02T23:45:00Z')),
    g('cfbd', 'c3', 'Liberty', 'Delaware'),
    g('cfbd', 'c4', 'TBD', 'TBD'),
    g('espn', 'e4', 'TBD', 'TBD'),
  ])
  expect(await load()).toHaveLength(5)
})
