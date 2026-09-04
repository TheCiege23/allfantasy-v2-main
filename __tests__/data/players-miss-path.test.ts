/**
 * The player-lookup miss paths, which used to run a full import on the customer's request.
 *
 * 🛑 THE MEASURED COST, FROM THE REPO'S OWN NOTES. `lib/workers/sports-data-import-coordinator.ts`
 * says it exists so "a genuine cache miss no longer forces the initiating customer request to await
 * a full per-sport import (measured 90-190s in Phase 19/20)". It was built for exactly these three
 * call sites — its trigger-source union is `get_player_miss | search_players_miss |
 * get_players_by_team_miss` — and then it was never wired. It had ZERO callers, while
 * `lib/data/players.ts` went on awaiting `runSportsDataImporter` inline.
 *
 * That is the trade console taking 30 seconds to two minutes: `runTradeConsoleAnalysis` calls
 * `getPlayer` once per asset in a sequential loop, so a deal containing two unknown players could
 * serialise two full imports behind one click.
 *
 * ⚠ THESE TESTS ASSERT THE NEGATIVE AS WELL AS THE POSITIVE. "Calls the coordinator" is not the
 * property that matters on its own — a call site could do both and still block. What matters is
 * that the importer is never awaited on a read path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  importer: vi.fn(),
  request: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsPlayerRecord: { findUnique: h.findUnique, findMany: h.findMany } },
}))
vi.mock('@/lib/workers/sports-data-importer', () => ({ runSportsDataImporter: h.importer }))
vi.mock('@/lib/workers/sports-data-import-coordinator', () => ({
  requestPlayerImportRefresh: h.request,
}))
vi.mock('@/lib/workers/injury-importer', () => ({ runInjuryImporter: vi.fn() }))
vi.mock('@/lib/workers/news-importer', () => ({ runNewsImporter: vi.fn() }))

import { getPlayer, searchPlayers, getPlayersByTeam } from '@/lib/data/players'

beforeEach(() => {
  vi.clearAllMocks()
  h.importer.mockResolvedValue({ imported: 0 })
  h.findUnique.mockResolvedValue(null)
  h.findMany.mockResolvedValue([])
})

describe('🛑 a cache miss must not run the importer on the request', () => {
  it('getPlayer: requests a background refresh and returns null', async () => {
    const out = await getPlayer('NFL:4017')

    expect(out).toBeNull()
    expect(h.request).toHaveBeenCalledWith('NFL', 'get_player_miss')
    /*
     * The assertion that actually encodes the bug. The old code awaited this, and a test that only
     * checked the coordinator was called would have passed on the slow version too.
     */
    expect(h.importer).not.toHaveBeenCalled()
  })

  it('getPlayer: does NOT re-query after the miss', async () => {
    // The old path queried, imported, then queried again. The second read cannot help now —
    // the import has not run — so making it would be latency with no possible payoff.
    await getPlayer('NFL:4017')
    expect(h.findUnique).toHaveBeenCalledTimes(1)
  })

  it('searchPlayers: requests a refresh instead of importing inline', async () => {
    /*
     * Worst of the three: Phase 20 measured up to SIX parallel `searchPlayers()` calls from one
     * unified-orchestration request, each of which would have started its own import.
     */
    const rows = await searchPlayers('nobody', 'NFL')

    expect(rows).toEqual([])
    expect(h.request).toHaveBeenCalledWith('NFL', 'search_players_miss')
    expect(h.importer).not.toHaveBeenCalled()
  })

  it('getPlayersByTeam: same', async () => {
    const rows = await getPlayersByTeam('GB', 'NFL')

    expect(rows).toEqual([])
    expect(h.request).toHaveBeenCalledWith('NFL', 'get_players_by_team_miss')
    expect(h.importer).not.toHaveBeenCalled()
  })
})

describe('the hit path is unchanged', () => {
  it('returns the row and asks for nothing when the record is fresh', async () => {
    const fresh = { id: 'NFL:4017', name: 'Perry Vance', sport: 'NFL', lastUpdated: new Date() }
    h.findUnique.mockResolvedValue(fresh)

    const out = await getPlayer('NFL:4017')

    expect(out).toBe(fresh)
    expect(h.request).not.toHaveBeenCalled()
    expect(h.importer).not.toHaveBeenCalled()
  })
})

describe('🛑 the inline import must not come back', () => {
  const SRC = readFileSync(join(process.cwd(), 'lib/data/players.ts'), 'utf8')

  it('the source scan is reading the right file', () => {
    // Positive control: a scan matching nothing would pass the assertion below vacuously.
    expect(SRC).toContain('requestPlayerImportRefresh')
    expect(SRC).toContain('getPlayersByTeam')
  })

  it('no read path awaits runSportsDataImporter', () => {
    /*
     * Comments are stripped because the historical call is quoted in one, deliberately, so the
     * documentation of the bug does not trip the guard against it.
     *
     * `triggerBackgroundRefresh(..., () => runSportsDataImporter(...))` stays legal and is not
     * matched: it passes a closure to a scheduler rather than awaiting the importer.
     */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/await\s+runSportsDataImporter/)
  })
})
