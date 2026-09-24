/** @vitest-environment node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * What `ingestRollingInsightsGameLogs` WRITES to player_game_stats.game_date (a Postgres DATE).
 *
 * It wrote the kickoff INSTANT, which Postgres truncates to its UTC date — so every US game
 * starting at 8pm Eastern or later was dated the next day (60,439 NCAAB and 16,526 MLB rows,
 * measured 2026-09-24). Driven by the committed NCAABB fixture: the national final tipped at
 * "Tue, 07 Apr 2026 00:50:00 GMT", which is Monday 04-06 in the US.
 */

const h = vi.hoisted(() => ({ upsert: vi.fn(), identities: vi.fn(), riFetchRows: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: h.identities },
    playerGameStat: { upsert: h.upsert },
  },
}))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({
  riFetchRows: (...a: unknown[]) => h.riFetchRows(...a),
}))

import { ingestRollingInsightsGameLogs } from '@/lib/sports-data/rollingInsightsGameLogs'

const FIXTURE = path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', 'live.NCAABB.json')
const games = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { data: { NCAABB: Array<Record<string, any>> } }).data.NCAABB

beforeEach(() => {
  vi.clearAllMocks()
  const ids = [...Object.keys(games[0].player_box.home_team), ...Object.keys(games[0].player_box.away_team)]
  h.identities.mockResolvedValue(ids.map((id) => ({ id: `pim-${id}`, rollingInsightsId: id })))
  h.upsert.mockResolvedValue({})
  h.riFetchRows.mockResolvedValue({ rows: games, notModified: false, unsupported: false, error: null })
})

describe('ingestRollingInsightsGameLogs — the game_date it writes', () => {
  it('REGRESSION: writes the Eastern DAY of a night game, not the next UTC day', async () => {
    const result = await ingestRollingInsightsGameLogs({ sport: 'NCAAB', dates: ['2026-04-06'], now: new Date('2026-09-24T12:00:00Z') })

    expect(result.written).toBe(14)
    const written = new Set(h.upsert.mock.calls.map(([arg]) => (arg.create.gameDate as Date).toISOString()))
    expect(written).toEqual(new Set(['2026-04-06T00:00:00.000Z']))
    // update and create agree, so a re-run repairs a row written by the old code.
    for (const [arg] of h.upsert.mock.calls) expect(arg.update.gameDate).toEqual(arg.create.gameDate)
  })

  it('falls back to the Eastern date of game_time when game_ID carries no date', async () => {
    h.riFetchRows.mockResolvedValue({ rows: [{ ...games[0], game_ID: 'undated-12-103' }], notModified: false, unsupported: false, error: null })
    await ingestRollingInsightsGameLogs({ sport: 'NCAAB', dates: ['2026-04-06'], now: new Date('2026-09-24T12:00:00Z') })
    expect((h.upsert.mock.calls[0][0].create.gameDate as Date).toISOString()).toBe('2026-04-06T00:00:00.000Z')
  })
})
