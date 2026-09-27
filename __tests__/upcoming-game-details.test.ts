import { expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ games: vi.fn(), odds: vi.fn() }))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: h.games }, gameOdds: { findMany: h.odds } } }))
import { getTodayStrip } from '@/lib/core-app/todayStrip'
it('joins fresh markets by provider identity and links the ESPN game without hiding missing odds', async () => {
  h.games.mockResolvedValue([{ sport: 'NFL', source: 'espn', externalId: '123', startTime: new Date('2026-09-27T17:00:00Z'), week: 3, awayTeam: 'KC', homeTeam: 'BUF' }])
  h.odds.mockResolvedValue([{ sport: 'NFL', source: 'espn', gameExternalId: '123', spreadHome: -3.5, totalPoints: 48.5, fetchedAt: new Date('2026-09-27T12:00:00Z') }])
  const load = () => getTodayStrip('u', [{ id: 'l', sport: 'NFL' }], new Date('2026-09-27T12:15:00Z'))
  const row = (await load()).next24[0]
  expect(row.game).toMatchObject({ odds: 'BUF favored by 3.5 · O/U 48.5', href: '/core/live?sport=NFL&game=123' })
  expect(row.game?.homeLogo).toMatch(/^https:/)
  h.odds.mockResolvedValue([])
  expect((await load()).next24[0].game?.odds).toBe('Odds unavailable')
})

it('merges full-name and abbreviation fixtures and retains their provider odds', async () => {
  const startTime = new Date('2026-09-27T17:00:00Z')
  h.games.mockResolvedValue([{ sport: 'NFL', source: 'espn', externalId: 'espn-id', startTime, homeTeam: 'Indianapolis Colts', awayTeam: 'Houston Texans' }, { sport: 'NFL', source: 'api-sports', externalId: 'api-id', startTime, homeTeam: 'IND', awayTeam: 'HOU' }])
  h.odds.mockResolvedValue([{ sport: 'NFL', source: 'api-sports', gameExternalId: 'api-id', spreadHome: 2.5, totalPoints: 45, fetchedAt: new Date('2026-09-27T12:00:00Z') }])
  const rows = (await getTodayStrip('u', [{ id: 'l', sport: 'NFL' }], new Date('2026-09-27T12:15:00Z'))).next24
  expect(rows).toHaveLength(1)
  expect(rows[0].game?.homeLogo).toMatch(/ind\.png$/)
  expect(rows[0].game?.awayLogo).toMatch(/hou\.png$/)
  expect(rows[0].game?.odds).toContain('O/U 45')
})
