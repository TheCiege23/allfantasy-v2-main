// @vitest-environment node
/**
 * Guards lib/adp/liveAdpFallback.ts — the DB-first path that serves the players
 * data/nfl-adp-multiplatform.csv cannot see.
 *
 * That CSV is dated 2026-03-08, before the April 2026 draft, and no generator for it exists
 * in this repo. Measured against production at season week 35, the 2026 class reaches the
 * static sources essentially not at all:
 *
 *   skill-position rookies (SportsPlayer.yearsExp=0)
 *     consensus 29   ffc 24   sleeper 4   espn 1   fantrax 0   mfl 0
 *
 * So `ffc` alone prices them, and this module is what stops that from being rendered as
 * either silence or as five platforms agreeing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const findFirst = vi.fn()
const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { adpDataRecord: { findFirst: (...a: unknown[]) => findFirst(...a), findMany: (...a: unknown[]) => findMany(...a) } },
}))

import {
  getLiveAdpByName,
  findLiveAdp,
  lookupLiveAdp,
  __resetLiveAdpFallbackCache,
} from '@/lib/adp/liveAdpFallback'

const PERIOD = { season: 2026, week: 35 }

function row(over: Record<string, unknown> = {}) {
  return {
    playerName: 'Rookie Receiver',
    position: 'WR',
    team: 'CIN',
    adp: 84.5,
    providerCount: 1,
    adpSpread: 0,
    providerBreakdown: { ffc: 84.5 },
    ...over,
  }
}

beforeEach(() => {
  __resetLiveAdpFallbackCache()
  findFirst.mockReset()
  findMany.mockReset()
  findFirst.mockResolvedValue(PERIOD)
  findMany.mockResolvedValue([row()])
})

describe('getLiveAdpByName', () => {
  it('serves a player the static CSV never had', async () => {
    const map = await getLiveAdpByName()
    const entry = lookupLiveAdp(map, 'Rookie Receiver')
    expect(entry?.adp).toBe(84.5)
    expect(entry?.season).toBe(2026)
    expect(entry?.week).toBe(35)
  })

  it('names the sources so one provider is never read as a consensus of five', async () => {
    const entry = await findLiveAdp('Rookie Receiver')
    expect(entry?.providerCount).toBe(1)
    expect(entry?.providers).toEqual(['ffc'])
  })

  it('nulls the spread for a single provider — zero spread is absence, not agreement', async () => {
    const entry = await findLiveAdp('Rookie Receiver')
    expect(entry?.adpSpread).toBeNull()
  })

  it('keeps a real spread when more than one provider priced the player', async () => {
    findMany.mockResolvedValue([
      row({ playerName: 'Veteran Back', providerCount: 3, adpSpread: 12.5, providerBreakdown: { ffc: 20, espn: 26, sleeper: 32.5 } }),
    ])
    const entry = await findLiveAdp('Veteran Back')
    expect(entry?.adpSpread).toBe(12.5)
    expect(entry?.providers).toEqual(['espn', 'ffc', 'sleeper'])
  })

  it('keys on normalizePlayerName, the same function lib/multi-platform-adp.ts indexes with', async () => {
    // Apostrophes and hyphens are PRESERVED by that normalizer; only casing and
    // stray punctuation are folded. Asserting the real contract, not a hoped-for one —
    // changing normalizePlayerName is a data migration (PlayerIdentityMap.normalizedName
    // is stamped with it), so this module must match it rather than the other way round.
    findMany.mockResolvedValue([row({ playerName: "Ja'Marr Chase" })])
    expect(await findLiveAdp("Ja'Marr Chase")).not.toBeNull()
    expect(await findLiveAdp("  ja'marr   chase  ")).not.toBeNull()
  })

  it('follows the normalizer through a generational suffix', async () => {
    // "Aaron Jones Sr." is a real row in the live-only set that the static CSV lacks.
    findMany.mockResolvedValue([row({ playerName: 'Aaron Jones Sr.' })])
    expect(await findLiveAdp('Aaron Jones')).not.toBeNull()
  })

  it('prefers the better-corroborated row when a name appears twice', async () => {
    findMany.mockResolvedValue([
      row({ adp: 99, providerCount: 1, providerBreakdown: { ffc: 99 } }),
      row({ adp: 40, providerCount: 4, adpSpread: 8, providerBreakdown: { ffc: 40, espn: 44, mfl: 36, sleeper: 41 } }),
    ])
    const entry = await findLiveAdp('Rookie Receiver')
    expect(entry?.providerCount).toBe(4)
    expect(entry?.adp).toBe(40)
  })

  it('returns an empty map rather than throwing when the database is unreachable', async () => {
    findFirst.mockRejectedValue(new Error('connection refused'))
    const map = await getLiveAdpByName()
    expect(map.size).toBe(0)
    expect(await findLiveAdp('Rookie Receiver')).toBeNull()
  })

  it('returns an empty map when no period exists at all', async () => {
    findFirst.mockResolvedValue(null)
    const map = await getLiveAdpByName()
    expect(map.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('queries once per period and serves the rest from cache', async () => {
    await getLiveAdpByName()
    await getLiveAdpByName()
    await findLiveAdp('Rookie Receiver')
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('shares the in-flight load so concurrent callers do not each scan the board', async () => {
    /*
     * The TTL cache is written only AFTER both awaits resolve, so it cannot help callers that
     * miss simultaneously — and every caller here fans out: the comparison lab resolves up to
     * 6 players through Promise.all, lib/agents/anthropic-pipeline.ts over an unbounded list.
     * Without in-flight promise sharing this was N full loads of ~2,935 rows.
     */
    const [a, b, c] = await Promise.all([
      getLiveAdpByName(),
      getLiveAdpByName(),
      findLiveAdp('Rookie Receiver'),
    ])
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(a).toBe(b) // literally the same Map, not two equal ones
    expect(c?.adp).toBe(84.5)
  })

  it('reports an unstated provider count as null rather than inventing 1', async () => {
    findMany.mockResolvedValue([row({ providerCount: null, providerBreakdown: null })])
    const entry = await findLiveAdp('Rookie Receiver')
    expect(entry?.providerCount).toBeNull()
    expect(entry?.providers).toEqual([])
    // An unknown count is not corroboration, so there is still no spread to report.
    expect(entry?.adpSpread).toBeNull()
  })

  it('prefers a row that states its provenance over one that does not', async () => {
    findMany.mockResolvedValue([
      row({ adp: 10, providerCount: null, providerBreakdown: null }),
      row({ adp: 55, providerCount: 2, adpSpread: 4, providerBreakdown: { ffc: 53, espn: 57 } }),
    ])
    const entry = await findLiveAdp('Rookie Receiver')
    expect(entry?.providerCount).toBe(2)
    expect(entry?.adp).toBe(55)
  })

  it('carries the board basis, which is not the caller league scoring', async () => {
    const entry = await findLiveAdp('Rookie Receiver')
    expect(entry?.format).toBe('redraft')
    expect(entry?.scoring).toBe('standard')
  })

  it('reads the blended redraft board by default, which is a superset of the CSV', async () => {
    await getLiveAdpByName()
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'NFL', format: 'redraft', scoring: 'standard', source: 'consensus' }),
      }),
    )
  })

  it('skips rows with an unusable adp instead of emitting NaN', async () => {
    findMany.mockResolvedValue([row({ adp: Number.NaN }), row({ playerName: '' })])
    const map = await getLiveAdpByName()
    expect(map.size).toBe(0)
  })
})

describe('lookupLiveAdp', () => {
  it('is null-safe on an empty name', () => {
    expect(lookupLiveAdp(new Map(), '')).toBeNull()
    expect(lookupLiveAdp(new Map(), '   ')).toBeNull()
  })
})
