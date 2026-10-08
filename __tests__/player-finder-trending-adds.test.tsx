/**
 * "Most added this week": the loader (window, cache, resolution), the shared Sleeper-player resolver,
 * and the rail card.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ queryRaw: vi.fn(), players: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: db.queryRaw, sportsPlayer: { findMany: db.players } } }))

import { TRENDING_LIMIT, TRENDING_MIN_LEAGUES, TRENDING_WINDOW_DAYS, clearTrendingAddsCache, loadTrendingAdds } from '@/lib/core-app/trendingAdds'
import { resolveSleeperPlayers } from '@/lib/core-app/sleeperPlayerRefs'
import { TrendingAdds } from '@/components/core-app/player-finder/TrendingAdds'

const NOW = new Date('2026-09-29T18:00:00Z')
type P = { externalId: string; sleeperId: string; source: string; fetchedAt: Date; name: string; position: string; team: string; imageUrl: string | null }
const cat: P[] = [
  { externalId: 'E1339', sleeperId: '1339', source: 'rolling_insights', fetchedAt: new Date('2026-09-20'), name: 'Zach Ertz', position: 'TE', team: 'Philadelphia Eagles', imageUrl: null },
  { externalId: '1339', sleeperId: '1339', source: 'sleeper', fetchedAt: new Date('2026-09-28'), name: 'Zach Ertz', position: 'TE', team: 'PHI', imageUrl: 'https://img/ertz.png' },
  { externalId: 'E11435', sleeperId: '11435', source: 'rolling_insights', fetchedAt: new Date('2026-09-20'), name: 'Emanuel Wilson', position: 'RB', team: 'SEA', imageUrl: null },
  { externalId: 'E2306', sleeperId: '2306', source: 'rolling_insights', fetchedAt: new Date('2026-09-20'), name: 'Jameis Winston', position: 'QB', team: 'NYG', imageUrl: null },
]
let sharing: Array<{ externalId: string; sleeperId: string }> = []

beforeEach(() => {
  vi.clearAllMocks()
  clearTrendingAddsCache()
  sharing = [
    { externalId: 'E1339', sleeperId: '1339' },
    { externalId: 'E11435', sleeperId: '11435' },
    { externalId: 'E2306', sleeperId: '2306' },
  ]
  db.players.mockImplementation(async ({ where }: { where: { sleeperId?: { in?: string[] }; externalId?: { in: string[] } } }) =>
    where.externalId ? sharing.filter((s) => where.externalId!.in.includes(s.externalId)) : cat.filter((c) => where.sleeperId!.in!.includes(c.sleeperId)),
  )
  db.queryRaw.mockResolvedValue([
    { sid: '1339', leagues: 66, active_leagues: 189, newest: new Date('2026-09-28T14:59:00Z') },
    { sid: 'DAL', leagues: 51, active_leagues: 189, newest: new Date('2026-09-28T14:59:00Z') }, // a team defense: no catalog row
    { sid: '11435', leagues: 50, active_leagues: 189, newest: new Date('2026-09-28T14:59:00Z') },
    { sid: '2306', leagues: 46, active_leagues: 189, newest: new Date('2026-09-28T14:59:00Z') },
  ])
})

describe('loadTrendingAdds', () => {
  it('ranks by leagues, drops ids with no player, and says how fresh it is', async () => {
    const t = await loadTrendingAdds(NOW)
    expect(t!.rows.map((r) => [r.name, r.leagues, r.team])).toEqual([
      ['Zach Ertz', 66, 'PHI'],
      ['Emanuel Wilson', 50, 'SEA'],
      ['Jameis Winston', 46, 'NYG'],
    ])
    expect(t).toMatchObject({ activeLeagues: 189, through: '2026-09-28T14:59:00.000Z' })
  })

  it(`reads a ${TRENDING_WINDOW_DAYS}-day window ending now, and at most ${TRENDING_LIMIT} players`, async () => {
    db.queryRaw.mockResolvedValue(Array.from({ length: 16 }, (_, i) => ({ sid: i % 3 === 0 ? '1339' : i % 3 === 1 ? '11435' : '2306', leagues: 60 - i, active_leagues: 189, newest: NOW })))
    const t = await loadTrendingAdds(NOW)
    expect(t!.rows.length).toBeLessThanOrEqual(TRENDING_LIMIT)
    const sql = db.queryRaw.mock.calls[0][0] as { values: unknown[] }
    const dates = sql.values.filter((v) => v instanceof Date) as Date[]
    expect(dates.map((d) => d.toISOString())).toEqual([new Date(NOW.getTime() - TRENDING_WINDOW_DAYS * 86_400_000).toISOString(), NOW.toISOString()])
    expect(sql.values).toContain(TRENDING_MIN_LEAGUES)
  })

  it('the three measured traps stay handled: adds from payload.adds, time from payload.createdAt, one count per real league', async () => {
    await loadTrendingAdds(NOW)
    const text = (db.queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join('?')
    expect(text).toContain(`jsonb_array_elements_text(tx.adds)`)
    expect(text).toContain(`t.payload->'adds' AS adds`)
    expect(text).toContain(`(t.payload->>'createdAt')::timestamptz >=`)
    expect(text).not.toMatch(/t\."createdAt"\s*>=/)
    expect(text).toContain(`DISTINCT ON (lower(l.platform), l."platformLeagueId", t.payload->>'sleeperTransactionId')`)
    expect(text).toContain('count(DISTINCT league)')
  })

  it('caches for everyone; a failed read is not cached as "nobody added anyone"', async () => {
    await loadTrendingAdds(NOW)
    await loadTrendingAdds(new Date(NOW.getTime() + 60_000))
    expect(db.queryRaw).toHaveBeenCalledTimes(1)
    clearTrendingAddsCache()
    db.queryRaw.mockRejectedValueOnce(new Error('db down'))
    expect(await loadTrendingAdds(NOW)).toBeNull()
    expect((await loadTrendingAdds(NOW))!.rows).toHaveLength(3)
  })

  it('a quiet week is an empty list, not an error', async () => {
    db.queryRaw.mockResolvedValue([])
    expect(await loadTrendingAdds(NOW)).toEqual({ rows: [], activeLeagues: 0, through: null })
  })
})

describe('resolveSleeperPlayers', () => {
  it('prefers the vendor row, folds the club to its code, and takes a headshot from any row', async () => {
    const m = await resolveSleeperPlayers(['1339'])
    expect(m.get('1339')).toMatchObject({ name: 'Zach Ertz', team: 'PHI', ref: 'NFL:E1339', imageUrl: 'https://img/ertz.png' })
  })

  it('no link when another player also claims the chosen id', async () => {
    sharing.push({ externalId: 'E2306', sleeperId: '9999' })
    const m = await resolveSleeperPlayers(['2306'])
    expect(m.get('2306')).toMatchObject({ name: 'Jameis Winston', ref: null })
  })
})

describe('TrendingAdds card', () => {
  it('lists the players with how many leagues added them, linked to their cards, with the freshness', async () => {
    sharing.push({ externalId: 'E2306', sleeperId: '9999' })
    render(<TrendingAdds data={await loadTrendingAdds(NOW)} leagueParam="&league=L1" />)
    expect(screen.getByRole('heading', { name: 'Most added this week' })).toBeTruthy()
    expect(screen.getByText(/of 189 leagues adding · through Sep 28/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Zach Ertz/ }).getAttribute('href')).toBe('/core/players?q=Zach%20Ertz&player=NFL%3AE1339&league=L1')
    expect(screen.getByLabelText('added in 66 leagues').textContent).toBe('+66')
    // A player whose ref is not round-trip safe is listed but not linked.
    expect(screen.getByText('Jameis Winston').closest('a')).toBeNull()
  })

  it('renders nothing for an empty week', () => {
    const { container } = render(<TrendingAdds data={{ rows: [], activeLeagues: 0, through: null }} leagueParam="" />)
    expect(container.innerHTML).toBe('')
  })
})
