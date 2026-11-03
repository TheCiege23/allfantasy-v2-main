/**
 * The Survivor reward API (lib/survivor/survivorRewardEngine.ts) against an in-memory database:
 * every reward type has a real effect, a key never pays twice, a blocker cancels a steal and is
 * consumed, FAAB never drops below 0, choices belong to the holder, deferred rewards wait for their
 * week, and the commissioner's undo puts everything back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const store = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, seq: 0 }))

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as Row
      if ('in' in c) return (c.in as unknown[]).includes(row[key])
      if ('not' in c) return row[key] !== c.not
      // Compound unique key (leagueId_userId_week).
      return Object.entries(c).every(([k, v]) => row[k] === v)
    }
    return row[key] === cond
  })
}

vi.mock('@/lib/prisma', () => {
  const table = (name: string) => {
    const rows = () => (store.tables[name] ??= [])
    const unique = (where: Row) => {
      const compound = where.leagueId_userId_week as Row | undefined
      return rows().find((r) => (compound ? matches(r, compound) : matches(r, where)))
    }
    return {
      findMany: vi.fn(async (args: { where?: Row } = {}) => rows().filter((r) => matches(r, args.where)).map((r) => ({ ...r }))),
      findFirst: vi.fn(async (args: { where?: Row } = {}) => { const r = rows().find((x) => matches(x, args.where)); return r ? { ...r } : null }),
      findUnique: vi.fn(async (args: { where: Row }) => { const r = unique(args.where); return r ? { ...r } : null }),
      create: vi.fn(async (args: { data: Row }) => { const r = { id: `${name}-${++store.seq}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, store.seq)), ...args.data }; rows().push(r); return { ...r } }),
      update: vi.fn(async (args: { where: Row; data: Row }) => { const r = unique(args.where); if (!r) throw new Error(`${name} missing`); Object.assign(r, args.data); return { ...r } }),
      updateMany: vi.fn(async (args: { where: Row; data: Row }) => { const hit = rows().filter((r) => matches(r, args.where)); hit.forEach((r) => Object.assign(r, args.data)); return { count: hit.length } }),
      upsert: vi.fn(async (args: { where: Row; create: Row; update: Row }) => {
        const r = unique(args.where)
        if (r) { Object.assign(r, args.update); return { ...r } }
        const created = { id: `${name}-${++store.seq}`, ...args.create }
        rows().push(created)
        return { ...created }
      }),
    }
  }
  const db: Record<string, unknown> = {
    survivorAuditEntry: table('survivorAuditEntry'),
    survivorPlayer: table('survivorPlayer'),
    roster: table('roster'),
    redraftRoster: table('redraftRoster'),
    survivorWeeklyScore: table('survivorWeeklyScore'),
    survivorLeagueConfig: table('survivorLeagueConfig'),
    survivorIdol: table('survivorIdol'),
    survivorIdolLedgerEntry: table('survivorIdolLedgerEntry'),
    league: table('league'),
    $queryRaw: vi.fn(async () => []),
  }
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db))
  return { prisma: db }
})

import {
  applyDueDeferredSurvivorRewards,
  applySurvivorReward,
  chooseSurvivorRewardTarget,
  getSurvivorTradeTokens,
  listSurvivorRewards,
  redeemSurvivorTradeToken,
  reverseSurvivorReward,
} from '@/lib/survivor/survivorRewardEngine'

const L = 'L1'
const castaway = (rosterId: string, tribeId: string | null, faab: number, playerState = 'active') => {
  store.tables.survivorPlayer.push({ leagueId: L, userId: `u-${rosterId}`, redraftRosterId: rosterId, tribeId, playerState })
  store.tables.roster.push({ id: rosterId, leagueId: L, redraftRosterId: `rr-${rosterId}`, faabRemaining: faab })
  store.tables.redraftRoster.push({ id: `rr-${rosterId}`, leagueId: L, faabBalance: faab })
}
const faab = (rosterId: string) => (store.tables.redraftRoster.find((r) => r.id === `rr-${rosterId}`)!.faabBalance as number)
const mirror = (rosterId: string) => (store.tables.roster.find((r) => r.id === rosterId)!.faabRemaining as number)
const score = (rosterId: string, week: number) => store.tables.survivorWeeklyScore.find((s) => s.userId === `u-${rosterId}` && s.week === week)
const input = (key: string, reward: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ leagueId: L, idempotencyKey: key, source: { kind: 'challenge' as const, id: 'ch1' }, week: 5, reward, ...extra }) as never

beforeEach(() => {
  store.tables = { survivorAuditEntry: [], survivorPlayer: [], roster: [], redraftRoster: [], survivorWeeklyScore: [], survivorLeagueConfig: [{ id: 'cfg1', leagueId: L }], survivorIdol: [], survivorIdolLedgerEntry: [] }
  store.seq = 0
  castaway('a1', 'A', 100); castaway('a2', 'A', 30)
  castaway('b1', 'B', 0); castaway('b2', 'B', 0)
  store.tables.survivorWeeklyScore.push({ leagueId: L, userId: 'u-a1', week: 5, fantasyScore: 80, pointBoostApplied: 0, pointPenaltyApplied: 0, finalScore: 80 })
})

describe('applySurvivorReward', () => {
  it('takes real points off (score_penalty) and the same key never applies twice', async () => {
    const first = await applySurvivorReward(input('k1', { type: 'score_penalty', rosterId: 'a1', points: 20 }))
    expect(first).toMatchObject({ ok: true, status: 'applied', duplicate: false })
    expect(score('a1', 5)).toMatchObject({ pointPenaltyApplied: 20, finalScore: 60 })
    const again = await applySurvivorReward(input('k1', { type: 'score_penalty', rosterId: 'a1', points: 20 }))
    expect(again).toMatchObject({ ok: true, duplicate: true })
    expect(score('a1', 5)).toMatchObject({ pointPenaltyApplied: 20, finalScore: 60 })
    // One ledger row: audited, commissioner-visible, never public.
    expect(store.tables.survivorAuditEntry).toHaveLength(1)
    expect(store.tables.survivorAuditEntry[0]).toMatchObject({ category: 'reward', action: 'reward_granted', relatedEntityId: 'k1', isVisibleToPublic: false, isVisibleToCommissioner: true })
  })

  it('moves FAAB from one tribe to the other, split per member, never below 0', async () => {
    const res = await applySurvivorReward(input('t1', { type: 'faab_transfer', fromTribeId: 'A', toTribeId: 'B', amount: 50 }))
    expect(res).toMatchObject({ ok: true, status: 'applied' })
    expect(faab('a1')).toBe(50)
    expect(faab('a2')).toBe(0)
    expect(faab('b1') + faab('b2')).toBe(80)
    expect(faab('b1')).toBe(40)
    expect(mirror('a2')).toBe(0)
  })

  it('waits for the winner to place tribemate points, then only the holder may choose, on their own tribe', async () => {
    const res = await applySurvivorReward(input('tp', { type: 'tribemate_points', chooserRosterId: 'a1', points: 100 }))
    expect(res).toMatchObject({ ok: true, status: 'awaiting_choice' })
    expect(await chooseSurvivorRewardTarget({ leagueId: L, rewardId: 'tp', actorRosterId: 'a2', targetRosterId: 'a2' })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await chooseSurvivorRewardTarget({ leagueId: L, rewardId: 'tp', actorRosterId: 'a1', targetRosterId: 'b1' })).toMatchObject({ ok: false, code: 'invalid' })
    const chosen = await chooseSurvivorRewardTarget({ leagueId: L, rewardId: 'tp', actorRosterId: 'a1', targetRosterId: 'a2' })
    expect(chosen).toMatchObject({ ok: true, status: 'applied' })
    expect(score('a2', 5)).toMatchObject({ pointBoostApplied: 100, finalScore: 100 })
    expect(await chooseSurvivorRewardTarget({ leagueId: L, rewardId: 'tp', actorRosterId: 'a1', targetRosterId: 'a2' })).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('a blocker cancels a steal and is consumed; the next steal goes through', async () => {
    await applySurvivorReward(input('blk', { type: 'steal_blocker', rosterId: 'a1' }))
    const blocked = await applySurvivorReward(input('s1', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'faab', amount: 25 }))
    expect(blocked).toMatchObject({ ok: true, status: 'blocked' })
    expect(faab('a1')).toBe(100)
    const records = await listSurvivorRewards(L)
    expect(records.find((r) => r.rewardId === 'blk')?.status).toBe('consumed')
    const stolen = await applySurvivorReward(input('s2', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'faab', amount: 25 }))
    expect(stolen).toMatchObject({ ok: true, status: 'applied' })
    expect(faab('a1')).toBe(75)
    expect(faab('b1')).toBe(25)
  })

  it('records a free trade token, lists it for the holder, and redeems it once per trade', async () => {
    await applySurvivorReward(input('ft', { type: 'free_trade_token', rosterId: 'a1' }))
    expect((await getSurvivorTradeTokens(L, 'a1', 5)).map((t) => t.rewardId)).toEqual(['ft'])
    expect((await getSurvivorTradeTokens(L, 'a2', 5))).toEqual([])
    expect(await redeemSurvivorTradeToken({ leagueId: L, rosterId: 'a1', tradeRef: 'trade-9', week: 5 })).toMatchObject({ ok: true, status: 'consumed', duplicate: false })
    expect(await redeemSurvivorTradeToken({ leagueId: L, rosterId: 'a1', tradeRef: 'trade-9', week: 5 })).toMatchObject({ ok: true, duplicate: true })
    expect(await redeemSurvivorTradeToken({ leagueId: L, rosterId: 'a1', tradeRef: 'trade-10', week: 5 })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('defers any reward to a later week and applies it when that week comes', async () => {
    const res = await applySurvivorReward(input('d1', { type: 'score_bonus', rosterId: 'a1', points: 50 }, { deferToWeek: 6 }))
    expect(res).toMatchObject({ ok: true, status: 'deferred' })
    expect(score('a1', 6)).toBeUndefined()
    expect(await applyDueDeferredSurvivorRewards(L, 5)).toEqual([])
    expect(await applyDueDeferredSurvivorRewards(L, 6)).toEqual(['d1'])
    expect(score('a1', 6)).toMatchObject({ pointBoostApplied: 50 })
    expect(await applyDueDeferredSurvivorRewards(L, 7)).toEqual([])
  })

  it('refuses a reward for someone who is not an active castaway, writing nothing', async () => {
    castaway('gone', 'A', 10, 'eliminated')
    expect(await applySurvivorReward(input('x', { type: 'faab_grant', rosterId: 'gone', amount: 10 }))).toMatchObject({ ok: false, code: 'not_found' })
    expect(await applySurvivorReward(input('y', { type: 'faab_grant', rosterId: 'a1', amount: -1 }))).toMatchObject({ ok: false, code: 'invalid' })
    expect(store.tables.survivorAuditEntry).toHaveLength(0)
  })

  it('hands out an advantage on the idol table', async () => {
    const res = await applySurvivorReward(input('adv', { type: 'advantage', rosterId: 'a2', powerType: 'vote_shield' }))
    expect(res).toMatchObject({ ok: true, status: 'applied' })
    expect(store.tables.survivorIdol[0]).toMatchObject({ rosterId: 'a2', powerType: 'vote_shield', status: 'revealed', configId: 'cfg1' })
  })
})

describe('reverseSurvivorReward (commissioner undo)', () => {
  it('takes back points and FAAB exactly, and is idempotent', async () => {
    await applySurvivorReward(input('p', { type: 'score_penalty', rosterId: 'a1', points: 20 }))
    await applySurvivorReward(input('g', { type: 'faab_grant', rosterId: 'b1', amount: 40 }))
    expect((await reverseSurvivorReward({ leagueId: L, rewardId: 'p', actorUserId: 'commish' }))).toMatchObject({ ok: true, status: 'reversed' })
    expect(score('a1', 5)).toMatchObject({ pointPenaltyApplied: 0, finalScore: 80 })
    expect(await reverseSurvivorReward({ leagueId: L, rewardId: 'g', actorUserId: 'commish' })).toMatchObject({ ok: true })
    expect(faab('b1')).toBe(0)
    expect(await reverseSurvivorReward({ leagueId: L, rewardId: 'g', actorUserId: 'commish' })).toMatchObject({ ok: true, duplicate: true })
    expect(faab('b1')).toBe(0)
  })

  it('reversing a blocked steal hands the blocker back', async () => {
    await applySurvivorReward(input('blk', { type: 'steal_blocker', rosterId: 'a1' }))
    await applySurvivorReward(input('s1', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'points', amount: 10 }))
    await reverseSurvivorReward({ leagueId: L, rewardId: 's1', actorUserId: 'commish' })
    const blocker = (await listSurvivorRewards(L)).find((r) => r.rewardId === 'blk')
    expect(blocker?.status).toBe('available')
  })
})

describe('listSurvivorRewards (a manager sees only their own)', () => {
  it('shows what they hold and gifts that landed on them, never a steal against them', async () => {
    await applySurvivorReward(input('blk', { type: 'steal_blocker', rosterId: 'b2' }))
    await applySurvivorReward(input('s', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'faab', amount: 5 }))
    await applySurvivorReward(input('t', { type: 'faab_transfer', fromTribeId: 'A', toTribeId: 'B', amount: 5 }))
    expect((await listSurvivorRewards(L, { rosterId: 'a1' })).map((r) => r.rewardId)).toEqual([])
    expect((await listSurvivorRewards(L, { rosterId: 'b1' })).map((r) => r.rewardId).sort()).toEqual(['s', 't'])
    expect((await listSurvivorRewards(L, { rosterId: 'b1' })).some((r) => r.rewardId === 'blk')).toBe(false)
  })
})

describe('"Thieves cannot steal from each other" (optional rule, off by default)', () => {
  it('off: a manager holding a steal can still be robbed (today’s behaviour)', async () => {
    await applySurvivorReward(input('a-steal', { type: 'steal', thiefRosterId: 'a1', what: 'faab', amount: 5 }))
    const r = await applySurvivorReward(input('b-steal', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'faab', amount: 10 }))
    expect(r).toMatchObject({ ok: true, status: 'applied' })
    expect(faab('a1')).toBe(90)
  })

  it('on: refuses a steal aimed at a manager who holds (or used) a steal that week, with a clear reason', async () => {
    store.tables.league = [{ id: L, settings: { survivorThievesCannotStealFromEachOther: true }, language: 'en' }]
    await applySurvivorReward(input('a-steal', { type: 'steal', thiefRosterId: 'a1', what: 'faab', amount: 5 }))
    const refused = await applySurvivorReward(input('b-steal', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'faab', amount: 10 }))
    expect(refused).toMatchObject({ ok: false, code: 'conflict' })
    expect(refused.ok ? '' : refused.error).toMatch(/thieves cannot steal from each other/)
    expect(faab('a1')).toBe(100)
    // A non-thief is still fair game.
    const ok = await applySurvivorReward(input('b-steal-2', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a2', what: 'faab', amount: 10 }))
    expect(ok).toMatchObject({ ok: true, status: 'applied' })
  })

  it('on: a pending choice cannot pick a thief either (Spanish league gets a Spanish reason); another week is fine', async () => {
    store.tables.league = [{ id: L, settings: { survivorThievesCannotStealFromEachOther: true }, language: 'es' }]
    await applySurvivorReward(input('a-steal', { type: 'steal', thiefRosterId: 'a1', targetRosterId: 'b2', what: 'points', amount: 5 }))
    await applySurvivorReward(input('b-steal', { type: 'steal', thiefRosterId: 'b1', what: 'faab', amount: 10 }))
    const refused = await chooseSurvivorRewardTarget({ leagueId: L, rewardId: 'b-steal', actorRosterId: 'b1', targetRosterId: 'a1' })
    expect(refused).toMatchObject({ ok: false, code: 'conflict' })
    expect(refused.ok ? '' : refused.error).toMatch(/ladrones no se roban/)
    const nextWeek = await applySurvivorReward(input('b-steal-w6', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'faab', amount: 10 }, { week: 6 }))
    expect(nextWeek).toMatchObject({ ok: true, status: 'applied' })
  })

  it('on: a reversed steal no longer makes its holder a thief', async () => {
    store.tables.league = [{ id: L, settings: { survivorThievesCannotStealFromEachOther: true }, language: 'en' }]
    await applySurvivorReward(input('a-steal', { type: 'steal', thiefRosterId: 'a1', what: 'faab', amount: 5 }))
    await reverseSurvivorReward({ leagueId: L, rewardId: 'a-steal', actorUserId: 'commish' })
    const r = await applySurvivorReward(input('b-steal', { type: 'steal', thiefRosterId: 'b1', targetRosterId: 'a1', what: 'faab', amount: 10 }))
    expect(r).toMatchObject({ ok: true, status: 'applied' })
  })
})
