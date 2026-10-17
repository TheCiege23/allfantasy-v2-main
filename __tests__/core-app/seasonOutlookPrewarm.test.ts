// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findFirst: vi.fn(),
  load: vi.fn(),
  read: vi.fn(),
  stamps: vi.fn(),
  write: vi.fn(),
  marker: vi.fn(),
  check: vi.fn(),
  compute: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { weeklyMatchup: { groupBy: h.groupBy }, league: { findFirst: h.findFirst } },
}))
vi.mock('@/lib/core-app/seasonOutlook', () => ({ ITERATIONS: 10_000, loadOutlookInputs: h.load }))
vi.mock('@/lib/core-app/seasonOutlookSims', () => ({
  readLeagueSims: h.read,
  readLeagueSimStamps: h.stamps,
  writeLeagueSimMarker: h.marker,
  writeLeagueSimCheck: h.check,
  writeLeagueSims: h.write,
  computeLeagueSim: h.compute,
  leagueSimHash: (sim: { tag: string }) => `hash-${sim.tag}`,
}))

import { rerunLiveOutlooks, runOutlookPrewarm } from '@/lib/core-app/seasonOutlookPrewarm'

const NOW = new Date('2026-09-17T15:00:00Z')
const at = (iso: string) => new Date(iso)

function stored(hash: string, checkedAt: string, iterations = 10_000) {
  return { hash, iterations, computedAt: '2026-09-17T10:00:00Z', checkedAt }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CORE_OUTLOOK_PREWARM_DISABLED
  delete process.env.CORE_OUTLOOK_LIVE_RERUN_DISABLED
  h.findFirst.mockImplementation(async ({ where }: { where: { platformLeagueId: string } }) => ({
    id: `af-${where.platformLeagueId}`,
    name: 'L',
    platform: 'sleeper',
    platformLeagueId: where.platformLeagueId,
    settings: {},
  }))
  h.load.mockImplementation(async (_u: string, leagues: Array<{ platformLeagueId: string }>) => ({
    prepared: [{ pid: leagues[0].platformLeagueId, seed: 1, sim: { tag: leagues[0].platformLeagueId === 'same' ? 'same' : 'new' } }],
  }))
  h.write.mockResolvedValue(1)
  h.marker.mockResolvedValue(true)
  /* Stamps follow whatever `read` returns, as the real module's do; markers are added per test. */
  h.stamps.mockImplementation(async () => {
    const held = (await h.read()) as Map<string, { checkedAt?: string; computedAt: string }>
    return new Map([...held].map(([k, v]) => [k, { at: Date.parse(v.checkedAt ?? v.computedAt), marker: false }]))
  })
  h.compute.mockReturnValue({ hash: 'hash-new', iterations: 10_000, computedAt: NOW.toISOString() })
})

describe('runOutlookPrewarm', () => {
  it('writes provider-scoped simulations and a separate source queue checkpoint', async () => {
    h.groupBy.mockResolvedValue([{ leagueId:'new', _max:{updatedAt:at('2026-09-17T14:00:00Z')} }])
    h.read.mockResolvedValue(new Map())
    h.load.mockResolvedValue({prepared:[{pid:'sleeper:new',seed:1,sim:{tag:'new'}}]})
    const out=await runOutlookPrewarm(NOW)
    expect(out.computed).toBe(1)
    expect(h.write.mock.calls[0][0][0][0]).toBe('sleeper:new')
    expect(h.check).toHaveBeenCalledWith('new',NOW)
  })
  it('🛑 a rewritten-but-unchanged league is stamped checked, not re-run', async () => {
    h.groupBy.mockResolvedValue([{ leagueId: 'same', _max: { updatedAt: at('2026-09-17T14:00:00Z') } }])
    h.read.mockResolvedValue(new Map([['same', stored('hash-same', '2026-09-17T12:00:00Z')]]))
    const out = await runOutlookPrewarm(NOW)
    expect(out).toMatchObject({ candidates: 1, due: 1, computed: 0, unchanged: 1 })
    expect(h.compute).not.toHaveBeenCalled()
    expect(h.write.mock.calls[0][0][0][1].checkedAt).toBeTruthy()
  })

  it('re-runs a league whose inputs changed, at the full count', async () => {
    h.groupBy.mockResolvedValue([{ leagueId: 'moved', _max: { updatedAt: at('2026-09-17T14:00:00Z') } }])
    h.read.mockResolvedValue(new Map([['moved', stored('hash-old', '2026-09-17T12:00:00Z')]]))
    const out = await runOutlookPrewarm(NOW)
    expect(out).toMatchObject({ computed: 1, unchanged: 0 })
    expect(h.compute.mock.calls[0][2]).toBe(10_000)
  })

  it('tops up a run the page had to cut short, even when nothing changed', async () => {
    h.groupBy.mockResolvedValue([{ leagueId: 'same', _max: { updatedAt: at('2026-09-17T14:00:00Z') } }])
    h.read.mockResolvedValue(new Map([['same', stored('hash-same', '2026-09-17T12:00:00Z', 1_516)]]))
    expect((await runOutlookPrewarm(NOW)).computed).toBe(1)
  })

  it('skips leagues already checked since their newest row', async () => {
    h.groupBy.mockResolvedValue([{ leagueId: 'same', _max: { updatedAt: at('2026-09-17T11:00:00Z') } }])
    h.read.mockResolvedValue(new Map([['same', stored('hash-same', '2026-09-17T12:00:00Z')]]))
    const out = await runOutlookPrewarm(NOW)
    expect(out).toMatchObject({ candidates: 1, due: 0 })
    expect(h.load).not.toHaveBeenCalled()
  })

  it('stops at the per-fire cap and the shared budget, and reports the rest as deferred', async () => {
    h.groupBy.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ leagueId: `l${i}`, _max: { updatedAt: at('2026-09-17T14:00:00Z') } })),
    )
    h.read.mockResolvedValue(new Map())
    expect(await runOutlookPrewarm(NOW, { maxLeagues: 2 })).toMatchObject({ due: 5, computed: 2, deferred: 3 })
    expect(await runOutlookPrewarm(NOW, { budget: { exhausted: () => true } })).toMatchObject({ computed: 0, deferred: 5 })
  })

  it('never throws, and a failing league does not stop the rest', async () => {
    h.groupBy.mockResolvedValue([
      { leagueId: 'bad', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
      { leagueId: 'good', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
    ])
    h.read.mockResolvedValue(new Map())
    h.load.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const out = await runOutlookPrewarm(NOW)
    expect(out).toMatchObject({ failed: 1, computed: 1 })
    expect(out.errors[0]).toMatch(/boom/)

    h.groupBy.mockRejectedValue(new Error('db down'))
    expect((await runOutlookPrewarm(NOW)).failed).toBe(1)
  })

  it('🛑 a league it cannot run is marked checked, so it cannot hog every fire', async () => {
    // Production, first two fires: skipped leagues wrote nothing, sorted first, and came back each time.
    h.groupBy.mockResolvedValue([
      { leagueId: 'nothing', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
      { leagueId: 'orphan', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
    ])
    h.read.mockResolvedValue(new Map())
    h.findFirst.mockImplementation(async ({ where }: { where: { platformLeagueId: string } }) =>
      where.platformLeagueId === 'orphan' ? null : { id: 'x', name: 'L', platform: 'sleeper', platformLeagueId: 'nothing', settings: {} },
    )
    h.load.mockResolvedValue({ prepared: [] })
    const out = await runOutlookPrewarm(NOW)
    expect(out).toMatchObject({ skipped: 2, computed: 0 })
    expect(h.marker.mock.calls.map((c) => [c[0], c[1]]).sort()).toEqual([
      ['nothing', 'unsimulated'],
      ['orphan', 'unsimulated'],
    ])
  })

  it('🛑 a marked league waits behind unchecked ones until its rows change again', async () => {
    h.groupBy.mockResolvedValue([
      { leagueId: 'marked', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
      { leagueId: 'fresh', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
    ])
    h.read.mockResolvedValue(new Map())
    h.stamps.mockResolvedValue(new Map([['marked', { at: Date.parse('2026-09-17T14:30:00Z'), marker: true }]]))
    const out = await runOutlookPrewarm(NOW)
    expect(out).toMatchObject({ candidates: 2, due: 1, computed: 1 })
    expect(h.load.mock.calls[0][1][0].platformLeagueId).toBe('fresh')
  })

  it('🛑 a marked league is left alone for the cooldown, however often its rows are rewritten', async () => {
    /*
     * Production 19:00Z: 5 of 12 slots went to leagues already marked, because a sync had rewritten
     * their matchup rows since the marker was written. A check time alone cannot survive that.
     */
    h.groupBy.mockResolvedValue([{ leagueId: 'marked', _max: { updatedAt: at('2026-09-17T14:59:00Z') } }])
    h.read.mockResolvedValue(new Map())
    h.stamps.mockResolvedValue(new Map([['marked', { at: Date.parse('2026-09-17T09:00:00Z'), marker: true }]]))
    const out = await runOutlookPrewarm(NOW)
    expect(out).toMatchObject({ candidates: 1, due: 0, cooling: 1, computed: 0 })
    expect(h.load).not.toHaveBeenCalled()
  })

  it('takes a marked league back once the cooldown has passed, and never holds back a real run', async () => {
    h.groupBy.mockResolvedValue([{ leagueId: 'marked', _max: { updatedAt: at('2026-09-17T14:59:00Z') } }])
    h.read.mockResolvedValue(new Map())
    h.stamps.mockResolvedValue(new Map([['marked', { at: Date.parse('2026-09-16T10:00:00Z'), marker: true }]]))
    expect(await runOutlookPrewarm(NOW)).toMatchObject({ due: 1, cooling: 0, computed: 1 })

    /* Same age, but a stored run rather than a marker: the cooldown must not touch it. */
    h.stamps.mockResolvedValue(new Map([['marked', { at: Date.parse('2026-09-17T09:00:00Z'), marker: false }]]))
    expect(await runOutlookPrewarm(NOW)).toMatchObject({ due: 1, cooling: 0, computed: 1 })
  })

  it('a failure keeps a good stored run and only stamps it; with none, it leaves a marker', async () => {
    h.groupBy.mockResolvedValue([
      { leagueId: 'kept', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
      { leagueId: 'bare', _max: { updatedAt: at('2026-09-17T14:00:00Z') } },
    ])
    h.read.mockResolvedValue(new Map([['kept', stored('hash-old', '2026-09-17T12:00:00Z')]]))
    h.load.mockRejectedValue(new Error('db blip'))
    const out = await runOutlookPrewarm(NOW)
    expect(out.failed).toBe(2)
    const rewritten = h.write.mock.calls.map((c) => c[0][0])
    expect(rewritten).toHaveLength(1)
    expect(rewritten[0][0]).toBe('kept')
    expect(rewritten[0][1]).toMatchObject({ hash: 'hash-old' })
    expect(rewritten[0][1].checkedAt).not.toBe('2026-09-17T12:00:00Z')
    expect(h.marker.mock.calls.map((c) => [c[0], c[1]])).toEqual([['bare', 'failed']])
  })

  it('does nothing when switched off', async () => {
    process.env.CORE_OUTLOOK_PREWARM_DISABLED = 'true'
    expect(await runOutlookPrewarm(NOW)).toMatchObject({ candidates: 0, computed: 0 })
    expect(h.groupBy).not.toHaveBeenCalled()
  })
})

/*
 * Production 2026-10-11: every scheduled fire saw ~400 leagues due and ran 12, so HailShiva's odds
 * were from 17:13 while its board moved at 17:25 and 17:41. The live points pass now hands over the
 * leagues it just rewrote.
 */
describe('rerunLiveOutlooks', () => {
  it('re-runs a league whose board moved, and stamps one whose inputs did not', async () => {
    h.read.mockResolvedValue(new Map([['same', stored('hash-same', '2026-09-17T12:00:00Z')], ['moved', stored('hash-old', '2026-09-17T12:00:00Z')]]))
    const out = await rerunLiveOutlooks(['moved', 'same'], NOW)
    expect(out).toMatchObject({ considered: 2, computed: 1, unchanged: 1, deferred: 0, failed: 0 })
    expect(h.compute).toHaveBeenCalledTimes(1)
    expect(h.compute.mock.calls[0][2]).toBe(10_000)
    expect(h.groupBy).not.toHaveBeenCalled()
  })

  it('takes the stalest stored run first, and stops at its cap and its clock', async () => {
    h.read.mockResolvedValue(new Map([
      ['fresh', stored('hash-old', '2026-09-17T14:30:00Z')],
      ['stale', stored('hash-old', '2026-09-17T09:00:00Z')],
    ]))
    const out = await rerunLiveOutlooks(['fresh', 'never', 'stale'], NOW, { maxLeagues: 2 })
    expect(out).toMatchObject({ computed: 2, deferred: 1 })
    expect(h.findFirst.mock.calls.map((c) => c[0].where.platformLeagueId)).toEqual(['never', 'stale'])

    vi.clearAllMocks()
    let t = 0
    const timed = await rerunLiveOutlooks(['a', 'b', 'c'], NOW, { budgetMs: 10, clock: () => (t += 6) })
    expect(timed).toMatchObject({ computed: 1, deferred: 2 })
  })

  it('never throws, keeps a failed league\'s stored run, and can be switched off', async () => {
    h.read.mockResolvedValue(new Map())
    h.load.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    expect(await rerunLiveOutlooks(['bad', 'good'], NOW)).toMatchObject({ failed: 1, computed: 1 })
    expect(h.write.mock.calls.every((c) => c[0][0][0] !== 'bad')).toBe(true)

    expect(await rerunLiveOutlooks([], NOW)).toMatchObject({ considered: 0, computed: 0 })
    process.env.CORE_OUTLOOK_LIVE_RERUN_DISABLED = 'true'
    expect(await rerunLiveOutlooks(['moved'], NOW)).toMatchObject({ considered: 0, computed: 0 })
    expect(h.load).toHaveBeenCalledTimes(2)
  })
})
