// @vitest-environment node
/**
 * 🛑 EVERY COLLEGE GAME ON THE GAME-DAY BAND DREW TWO BROKEN-IMAGE GLYPHS (2026-10-01).
 *
 * `getTeamLogoUrl` builds an ESPN path from the team string, and ESPN keys college crests by
 * NUMERIC id, so "Western Kentucky" became a URL that 404s. The real crests were stored in
 * `SportsTeam.logo` all along. Outside the NFL the band now reads the stored crest, and a name we
 * hold no crest for gets no image — never a guessed one.
 */
import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ games: vi.fn(), odds: vi.fn(), teams: vi.fn() }))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsGame: { findMany: h.games }, gameOdds: { findMany: h.odds }, sportsTeam: { findMany: h.teams } },
}))
import { getTodayStrip } from '@/lib/core-app/todayStrip'
import { clearStoredTeamLogoCache } from '@/lib/sport-teams/storedTeamLogos'

const WKU = 'https://r2.thesportsdb.com/images/media/team/badge/o96a831564337158.png'
const NMSU = 'https://r2.thesportsdb.com/images/media/team/badge/nmsu.png'
const now = new Date('2026-10-01T22:00:00Z')

beforeEach(() => {
  clearStoredTeamLogoCache()
  h.odds.mockResolvedValue([])
  h.teams.mockReset()
  h.teams.mockResolvedValue([
    { externalId: '1', name: 'Western Kentucky', shortName: 'Western Kentucky', city: null, logo: WKU, source: 'thesportsdb' },
    { externalId: '2', name: 'New Mexico State', shortName: null, city: null, logo: NMSU, source: 'thesportsdb' },
  ])
})

const game = (away: string, home: string, sport = 'NCAAF') => ({
  sport, source: 'cfbd', externalId: `${away}-${home}`, startTime: new Date('2026-10-01T23:30:00Z'), week: 5, awayTeam: away, homeTeam: home,
})

it('a college game shows both stored crests, whatever case the feed spells the school in', async () => {
  h.games.mockResolvedValue([game('WESTERN KENTUCKY', 'NEW MEXICO STATE')])
  const row = (await getTodayStrip('u', [{ id: 'l', sport: 'NCAAF' }], now)).next24[0]
  expect(row.game?.awayLogo).toBe(WKU)
  expect(row.game?.homeLogo).toBe(NMSU)
  expect(h.teams.mock.calls[0]![0].where).toEqual({ sport: 'NCAAF' })
})

it('a school we hold no crest for gets no image, never a guessed URL that 404s', async () => {
  h.games.mockResolvedValue([game('Muhlenberg', 'Western Kentucky')])
  const row = (await getTodayStrip('u', [{ id: 'l', sport: 'NCAAF' }], now)).next24[0]
  expect(row.game?.awayLogo).toBeNull()
  expect(row.game?.homeLogo).toBe(WKU)
})

it('the NFL keeps its own logos and never reads stored crests', async () => {
  h.games.mockResolvedValue([game('PIT', 'CLE', 'NFL')])
  const row = (await getTodayStrip('u', [{ id: 'l', sport: 'NFL' }], now)).next24[0]
  expect(row.game?.homeLogo).toMatch(/cle\.png$/)
  expect(h.teams).not.toHaveBeenCalled()
})
