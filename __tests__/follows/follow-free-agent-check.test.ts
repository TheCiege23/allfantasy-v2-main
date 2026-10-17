import { describe, expect, it, vi } from 'vitest'

import {
  currentNflSeason,
  freeAlertCopy,
  freeAlertDedupeKey,
  heldLeagues,
  newlyFree,
  runFollowFreeAgentCheck,
  snapshotKey,
  type FollowFreeAgentDeps,
  type FreeLeague,
} from '@/lib/follows/followFreeAgentCheck'

/*
 * "He's free in your league" (2026-10-08): a TRANSITION from on-a-roster to on-none, in a league
 * read on both sides — never the standing fact, never a league that merely became readable.
 */

const L = (id: string, name = id): FreeLeague => ({ leagueId: id, leagueName: name, href: `/core/waivers?league=${id}` })
const NOW = new Date('2026-10-08T16:00:00.000Z')

describe('the transition rule', () => {
  it('held = read and not free', () => {
    expect(heldLeagues(['A', 'B', 'C'], [L('B')])).toEqual(['A', 'C'])
  })

  it('alerts only where he was held last time and is free now', () => {
    expect(newlyFree(['A', 'C'], [L('A'), L('B')]).map((l) => l.leagueId)).toEqual(['A'])
  })

  it('🛑 no baseline yet: says nothing — the first run only seeds', () => {
    expect(newlyFree(null, [L('A')])).toEqual([])
  })

  it('🛑 a league that was unreadable last time and free now is NOT a drop', () => {
    // Last run read only A (B was a partial import); B is readable and free now.
    expect(newlyFree(heldLeagues(['A'], []), [L('B')])).toEqual([])
  })
})

describe('copy and keys', () => {
  it('one league names it; several count and list them', () => {
    expect(freeAlertCopy('Tank Dell', [L('A', 'KBFL')])).toEqual({
      title: 'Tank Dell is free in KBFL',
      body: 'Nobody in KBFL has him any more — claim him before someone else does.',
    })
    expect(freeAlertCopy('Tank Dell', [L('A', 'KBFL'), L('B', 'Maye 26'), L('C', 'Dynasty')]).body).toBe(
      'Now unclaimed in KBFL, Maye 26 and Dynasty. Claim him before someone else does.',
    )
    expect(freeAlertCopy('Tank Dell', [L('A', 'KBFL'), L('B', 'Maye 26')]).title).toBe('Tank Dell is free in 2 of your leagues')
  })

  it('the dedupe key is per player, per league set, per Eastern day', () => {
    expect(freeAlertDedupeKey('123', [L('B'), L('A')], NOW)).toBe('follow-free:123:A,B:2026-10-08')
    expect(freeAlertDedupeKey('123', [L('A')], new Date('2026-10-09T02:00:00.000Z'))).toBe('follow-free:123:A:2026-10-08')
    expect(snapshotKey('u1', '123')).toBe('follow-free:v1:u1:123')
  })

  it('January belongs to last season', () => {
    expect(currentNflSeason(new Date('2027-01-15T00:00:00Z'))).toBe(2026)
    expect(currentNflSeason(NOW)).toBe(2026)
  })
})

function deps(over: Partial<FollowFreeAgentDeps> & { snapshots?: Map<string, string[]> } = {}) {
  const snapshots = over.snapshots ?? new Map<string, string[]>()
  const d: FollowFreeAgentDeps & { dispatch: ReturnType<typeof vi.fn>; writeSnapshot: ReturnType<typeof vi.fn> } = {
    listUsers: async () => ['u1'],
    listFollows: async () => [{ sleeperId: '123', externalId: 'ri-9', name: 'Tank Dell' }],
    loadLeagues: async () => [
      { id: 'A', name: 'KBFL', platform: 'sleeper', sport: 'NFL' },
      { id: 'B', name: 'Maye 26', platform: 'sleeper', sport: 'NFL' },
    ],
    scan: async () => ({ free: new Map([['123', [L('A', 'KBFL')]]]), checked: ['A', 'B'] }),
    readSnapshot: async (k) => snapshots.get(k) ?? null,
    alreadySent: async () => false,
    ...over,
    writeSnapshot: vi.fn(async (k: string, held: string[]) => void snapshots.set(k, held)),
    dispatch: vi.fn(async () => {}),
  }
  return d
}

describe('runFollowFreeAgentCheck', () => {
  it('first run seeds silently; a later drop in a held league alerts once, to his waivers', async () => {
    const snapshots = new Map<string, string[]>()
    // Run 1: he is on rosters in A and B.
    const d1 = deps({ snapshots, scan: async () => ({ free: new Map(), checked: ['A', 'B'] }) })
    const r1 = await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 60_000, now: NOW }, d1)
    expect(r1).toMatchObject({ ran: true, seeded: 1, alerts: 0 })
    expect(d1.dispatch).not.toHaveBeenCalled()
    expect(snapshots.get('follow-free:v1:u1:123')).toEqual(['A', 'B'])

    // Run 2: dropped in A.
    const d2 = deps({ snapshots })
    const r2 = await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 60_000, now: NOW }, d2)
    expect(r2).toMatchObject({ ran: true, seeded: 0, alerts: 1 })
    expect(d2.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', title: 'Tank Dell is free in KBFL', href: '/core/waivers?league=A', leagueId: 'A' }),
    )
    expect(snapshots.get('follow-free:v1:u1:123')).toEqual(['B'])

    // Run 3: still free in A — the same fact again is not news.
    const d3 = deps({ snapshots })
    const r3 = await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 60_000, now: NOW }, d3)
    expect(r3).toMatchObject({ alerts: 0 })
    expect(d3.dispatch).not.toHaveBeenCalled()
  })

  it('several leagues at once: one alert, to his card', async () => {
    const snapshots = new Map([['follow-free:v1:u1:123', ['A', 'B']]])
    const d = deps({ snapshots, scan: async () => ({ free: new Map([['123', [L('A', 'KBFL'), L('B', 'Maye 26')]]]), checked: ['A', 'B'] }) })
    await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 60_000, now: NOW }, d)
    expect(d.dispatch).toHaveBeenCalledTimes(1)
    expect(d.dispatch.mock.calls[0]![0]).toMatchObject({ title: 'Tank Dell is free in 2 of your leagues', leagueId: null, href: expect.stringContaining('player=NFL%3Ari-9') })
  })

  it('an alert already sent by an overlapping sweep is not sent again', async () => {
    const d = deps({ snapshots: new Map([['follow-free:v1:u1:123', ['A', 'B']]]), alreadySent: async () => true })
    const r = await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 60_000, now: NOW }, d)
    expect(r).toMatchObject({ alerts: 0, deduped: 1 })
    expect(d.dispatch).not.toHaveBeenCalled()
  })

  it('a dry run counts but neither writes nor sends', async () => {
    const d = deps({ snapshots: new Map([['follow-free:v1:u1:123', ['A', 'B']]]) })
    const r = await runFollowFreeAgentCheck({ dryRun: true, userId: null, budgetMs: 60_000, now: NOW }, d)
    expect(r).toMatchObject({ dryRun: true, alerts: 1 })
    expect(d.dispatch).not.toHaveBeenCalled()
    expect(d.writeSnapshot).not.toHaveBeenCalled()
  })

  it('reads leagues in chunks the scan can take, and unions what each read', async () => {
    const leagues = Array.from({ length: 30 }, (_, i) => ({ id: `L${i}`, name: `L${i}`, platform: 'sleeper', sport: 'NFL' }))
    const scan = vi.fn(async (_u: string, part: readonly { id: string }[]) => ({ free: new Map(), checked: part.map((l) => l.id) }))
    const snapshots = new Map<string, string[]>()
    const d = deps({ snapshots, loadLeagues: async () => leagues, scan })
    await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 60_000, now: NOW }, d)
    expect(scan.mock.calls.map((c) => c[1].length)).toEqual([12, 12, 6])
    expect(snapshots.get('follow-free:v1:u1:123')).toHaveLength(30)
  })

  it('follows unavailable reads as unavailable, nobody following as no_follows', async () => {
    expect(await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 1, now: NOW }, deps({ listUsers: async () => null }))).toEqual({ ran: false, reason: 'unavailable' })
    expect(await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 1, now: NOW }, deps({ listUsers: async () => [] }))).toEqual({ ran: false, reason: 'no_follows' })
  })

  it('one user failing is recorded and the next is still checked', async () => {
    const d = deps({
      listUsers: async () => ['bad', 'u1'],
      listFollows: async (userId) => {
        if (userId === 'bad') throw new Error('read failed')
        return [{ sleeperId: '123', externalId: null, name: 'Tank Dell' }]
      },
    })
    const r = await runFollowFreeAgentCheck({ dryRun: false, userId: null, budgetMs: 60_000, now: NOW }, d)
    expect(r).toMatchObject({ users: 2, followsChecked: 1, errors: [{ userId: 'bad', error: 'read failed' }] })
  })
})
