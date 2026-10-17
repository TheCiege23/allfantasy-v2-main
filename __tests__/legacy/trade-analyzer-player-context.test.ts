// @vitest-environment node
/**
 * The legacy trade analyzer's player context (`/af-legacy/trade-analyzer` → POST /api/legacy/trade/analyze).
 *
 * 🛑 It searched TheSportsDB and ESPN LIVE by name for every asset and took the first hit — `arr[0]` and
 * `items[0]` — ignoring the asset's position and team, so an IDP Josh Allen (JAX) was handed the Bills QB's
 * stat line, injury and depth chart. It now reads `sports_players` + the injury read port and binds a row
 * only when the asset's own position and team agree. Rows are production's for these names on 2026-10-11.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePlayerName } from '@/lib/team-abbrev'

type Row = { id: string; sport: string; name: string; team: string; position: string; stats: Record<string, unknown>; lastUpdated: Date }
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  people: [] as Array<{ sport: string; normalizedName: string; sleeperId: string | null; rollingInsightsId: string | null }>,
  injuries: [] as Array<Record<string, unknown>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayerRecord: {
      findMany: vi.fn(async ({ where }: { where: { sport: string; OR: Array<{ name: { contains: string } }> } }) =>
        db.rows
          .filter((r) => r.sport === where.sport && where.OR.some((o) => r.name.toLowerCase().includes(o.name.contains.toLowerCase())))
          .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime()),
      ),
    },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { sport: string; normalizedName: { in: string[] } } }) =>
        db.people.filter((p) => p.sport === where.sport && where.normalizedName.in.includes(p.normalizedName)),
      ),
    },
    sportsInjury: { findMany: vi.fn(async () => db.injuries) },
  },
}))

import { loadTradeAnalyzerPlayerContext } from '@/lib/legacy/tradeAnalyzerPlayerContext'

const NOW = new Date('2026-10-11T23:00:00Z')
const fetchSpy = vi.fn(async () => new Response('{}'))

beforeEach(() => {
  db.rows = [
    { id: 'NFL:4984', sport: 'NFL', name: 'Josh Allen', team: 'BUF', position: 'QB', stats: { passing_yards: 1450, completions: 79 }, lastUpdated: new Date('2026-10-11T22:09:07Z') },
    { id: 'NFL:sleeper:2212', sport: 'NFL', name: 'Josh Allen', team: 'FA', position: 'G', stats: { completions: 40 }, lastUpdated: new Date('2026-09-25T00:19:58Z') },
    { id: 'NFL:josh-allen:BUF', sport: 'NFL', name: 'Josh Allen', team: 'BUF', position: 'QB', stats: { completions: 319 }, lastUpdated: new Date('2026-09-07T16:51:57Z') },
  ]
  db.people = [
    { sport: 'NFL', normalizedName: normalizePlayerName('Josh Allen'), sleeperId: '4984', rollingInsightsId: '3348' },
    { sport: 'NFL', normalizedName: normalizePlayerName('Josh Allen'), sleeperId: '5840', rollingInsightsId: '2135' },
  ]
  db.injuries = [
    {
      playerName: 'Josh Allen', status: 'Questionable', type: 'Foot', description: 'Limited in practice',
      date: new Date('2026-10-10T18:00:00Z'), week: 6, source: 'rolling_insights',
      fetchedAt: new Date('2026-10-11T12:00:00Z'), team: 'Buffalo Bills', position: null,
    },
  ]
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('loadTradeAnalyzerPlayerContext', () => {
  it('IDP Josh Allen (JAX) gets NO data — not the Bills QB’s stats or injury — and nothing is fetched', async () => {
    const ctx = await loadTradeAnalyzerPlayerContext({ sport: 'nfl', assets: [{ name: 'Josh Allen', position: 'DL', team: 'JAX' }], now: NOW })
    expect(ctx.players).toEqual([])
    expect(ctx.unresolved).toEqual([{ name: 'Josh Allen', reason: 'contradicted' }])
    expect(JSON.stringify(ctx)).not.toMatch(/passing_yards|Questionable|1450/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('QB Josh Allen (BUF) gets his own current row and his injury — not a stale copy’s line', async () => {
    const ctx = await loadTradeAnalyzerPlayerContext({ sport: 'nfl', assets: [{ name: 'Josh Allen', position: 'QB', team: 'BUF' }], now: NOW })
    expect(ctx.players).toHaveLength(1)
    expect(ctx.players[0]).toMatchObject({
      name: 'Josh Allen', position: 'QB', team: 'BUF', stats: { passing_yards: 1450, completions: 79 },
      injury: { status: 'Questionable', bodyPart: 'Foot' }, source: 'sports_players',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('both Josh Allens in one trade: the QB is bound, the edge rusher is reported unresolved, neither borrows', async () => {
    const ctx = await loadTradeAnalyzerPlayerContext({
      sport: 'nfl',
      assets: [{ name: 'Josh Allen', position: 'QB', team: 'BUF' }, { name: 'Josh Allen', position: 'LB', team: 'JAX' }],
      now: NOW,
    })
    expect(ctx.players.map((p) => `${p.position}/${p.team}`)).toEqual(['QB/BUF'])
    expect(ctx.unresolved.map((u) => u.name)).toEqual(['Josh Allen'])
  })

  it('a name with no position or team, against two current namesakes, is refused rather than guessed', async () => {
    db.rows.push({ id: 'NFL:5840', sport: 'NFL', name: 'Josh Allen', team: 'JAX', position: 'DL', stats: { sacks: 4 }, lastUpdated: new Date('2026-10-11T22:09:07Z') })
    const ctx = await loadTradeAnalyzerPlayerContext({ sport: 'nfl', assets: [{ name: 'Josh Allen' }], now: NOW })
    expect(ctx.players).toEqual([])
    expect(ctx.unresolved).toEqual([{ name: 'Josh Allen', reason: 'ambiguous' }])
    // …and with his position and team, the DL is bound to HIS row.
    const dl = await loadTradeAnalyzerPlayerContext({ sport: 'nfl', assets: [{ name: 'Josh Allen', position: 'DL', team: 'JAX' }], now: NOW })
    expect(dl.players[0]).toMatchObject({ position: 'DL', team: 'JAX', stats: { sacks: 4 } })
  })
})

describe('the legacy trade analyze route', () => {
  /** Source with comments stripped, so a comment recording the removal is not read as a call. */
  const src = readFileSync(resolve(process.cwd(), 'server/api-route-modules/legacy/trade/analyze/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('makes no live TheSportsDB or ESPN player search', () => {
    expect(src).not.toMatch(/thesportsdb\.com|site\.web\.api\.espn\.com|searchplayers\.php/i)
    expect(src).not.toMatch(/lookupSportsDbPlayers|lookupEspnPlayerStats/)
  })

  it('sources player context from the DB with each asset’s own position and team', () => {
    expect(src).toMatch(/loadTradeAnalyzerPlayerContext\(\{[\s\S]{0,200}position: a\.player\.pos[\s\S]{0,40}team: a\.player\.team/)
    expect(src).toMatch(/playerStats: playerContext\?\.players/)
  })
})
