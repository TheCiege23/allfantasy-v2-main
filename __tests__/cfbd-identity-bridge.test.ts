import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The CFBD → PlayerIdentityMap bridge, which is the only thing that lets a college
 * projection reach a college roster.
 *
 * 🛑 WHAT THESE GUARD IS THE REFUSAL, NOT THE MATCH. The bridge resolves by NAME,
 * because no table anywhere links a CFBD athlete id to a Rolling-Insights one —
 * that absence is the whole reason the `cfbdId` column had to exist. Name matching
 * on college rosters is the most dangerous join in this product: a wrong link does
 * not error, it puts a stranger's projection on somebody's starter and prices him
 * with it.
 *
 * So the interesting behaviour is everything the bridge DECLINES to link, and that
 * is what most of these assert. A test suite that only proved the happy path would
 * pass just as well against a bridge that resolved every ambiguity to whichever row
 * Postgres returned first.
 */

const statFindFirst = vi.fn()
const statFindMany = vi.fn()
const pimFindMany = vi.fn()
const pimUpdate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyStatLine: {
      findFirst: (...a: unknown[]) => statFindFirst(...a),
      findMany: (...a: unknown[]) => statFindMany(...a),
    },
    playerIdentityMap: {
      findMany: (...a: unknown[]) => pimFindMany(...a),
      update: (...a: unknown[]) => pimUpdate(...a),
    },
  },
}))

/** A CFBD stat line in the shape `cfbdPlayerStats` writes. */
function statLine(cfbdId: string, name: string, team: string | null) {
  return { playerId: cfbdId, team, stats: { name, riPlayerName: name, position: 'QB' } }
}

/** A PlayerIdentityMap row as the bridge selects it. */
function pim(id: string, normalizedName: string, currentTeam: string | null, cfbdId: string | null = null) {
  return { id, normalizedName, currentTeam, cfbdId }
}

beforeEach(() => {
  vi.resetModules()
  statFindFirst.mockReset().mockResolvedValue({ season: '2026' })
  statFindMany.mockReset().mockResolvedValue([])
  pimFindMany.mockReset().mockResolvedValue([])
  pimUpdate.mockReset().mockResolvedValue({})
})

describe('what the bridge refuses', () => {
  it('drops a CFBD id whose name matches TWO identity rows', async () => {
    /*
     * The ordinary college case: two athletes of the same name, no team to separate
     * them. Linking either one is a coin flip that nothing downstream can detect.
     */
    statFindMany.mockResolvedValue([statLine('111', 'John Smith', null)])
    pimFindMany.mockResolvedValue([pim('a', 'john smith', null), pim('b', 'john smith', null)])

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf()

    expect(pimUpdate, 'an ambiguous name was linked anyway').not.toHaveBeenCalled()
    expect(r.linked).toBe(0)
    expect(r.ambiguous).toBe(1)
  })

  it('drops TWO CFBD players claiming ONE identity row — the inverse a from→to guard misses', async () => {
    /*
     * ⚠ THE CASE A NAIVE CROSSWALK CANNOT SEE. Reducing only `cfbdId → identityId`
     * finds no conflict here: each CFBD id maps to exactly one row. The collision is
     * on the OTHER side — one identity row claimed twice — and without the inverse
     * reduction whichever CFBD id was written last would silently own it.
     */
    statFindMany.mockResolvedValue([
      statLine('111', 'John Smith', 'GEORGIA'),
      statLine('222', 'John Smith', 'GEORGIA'),
    ])
    pimFindMany.mockResolvedValue([pim('a', 'john smith', 'GEORGIA')])

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf()

    expect(pimUpdate, 'one identity row was claimed by two different athletes').not.toHaveBeenCalled()
    expect(r.linked).toBe(0)
  })

  it('counts a name no identity row carries as unmatched, not as an error', async () => {
    statFindMany.mockResolvedValue([statLine('111', 'Nobody Here', 'GEORGIA')])
    pimFindMany.mockResolvedValue([pim('a', 'someone else', 'GEORGIA')])

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf()

    expect(r.unmatched).toBe(1)
    expect(r.linked).toBe(0)
    expect(r.errors).toEqual([])
  })

  it('says so when no CFBD stat lines exist rather than reporting a clean zero', async () => {
    /*
     * "0 linked, 0 errors" is the same output for a healthy no-op and for a pipeline
     * whose upstream never ran. Only the stated reason separates them — the same rule
     * the injury coverage flag and the devy intel sweep both follow.
     */
    statFindFirst.mockResolvedValue(null)

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf()

    expect(r.season).toBeNull()
    expect(r.errors.join(' ')).toMatch(/import-stat-lines/i)
  })
})

describe('what the bridge links', () => {
  it('links a clean one-to-one name', async () => {
    statFindMany.mockResolvedValue([statLine('111', 'Gunner Stockton', 'GEORGIA')])
    pimFindMany.mockResolvedValue([pim('a', 'gunner stockton', 'GEORGIA')])

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf()

    expect(r.linked).toBe(1)
    expect(pimUpdate).toHaveBeenCalledWith({ where: { id: 'a' }, data: { cfbdId: '111' } })
  })

  it('uses TEAM to separate two same-named athletes at different schools', async () => {
    statFindMany.mockResolvedValue([
      statLine('111', 'John Smith', 'GEORGIA'),
      statLine('222', 'John Smith', 'ALABAMA'),
    ])
    pimFindMany.mockResolvedValue([
      pim('a', 'john smith', 'GEORGIA'),
      pim('b', 'john smith', 'ALABAMA'),
    ])

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf()

    expect(r.linked).toBe(2)
    const written = pimUpdate.mock.calls.map((c) => [c[0].where.id, c[0].data.cfbdId]).sort()
    expect(written).toEqual([
      ['a', '111'],
      ['b', '222'],
    ])
  })

  it('does not rewrite a row that already carries the same id', async () => {
    statFindMany.mockResolvedValue([statLine('111', 'Gunner Stockton', 'GEORGIA')])
    pimFindMany.mockResolvedValue([pim('a', 'gunner stockton', 'GEORGIA', '111')])

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf()

    expect(pimUpdate).not.toHaveBeenCalled()
    expect(r.alreadyLinked).toBe(1)
    expect(r.linked).toBe(0)
  })

  it('writes nothing on a dry run but still reports what it would link', async () => {
    statFindMany.mockResolvedValue([statLine('111', 'Gunner Stockton', 'GEORGIA')])
    pimFindMany.mockResolvedValue([pim('a', 'gunner stockton', 'GEORGIA')])

    const { backfillCfbdIdsForNcaaf } = await import('@/lib/sports-data/cfbdIdentityBridge')
    const r = await backfillCfbdIdsForNcaaf({ dryRun: true })

    expect(pimUpdate).not.toHaveBeenCalled()
    expect(r.linked).toBe(1)
  })
})
