// @vitest-environment node
/**
 * Disadvantage rewards on the reward API (survivorRewardEngine.ts): a point penalty waits for the
 * winner's choice of opponent and then really comes off that opponent's week; a "vote taken" waits
 * for the choice, is held, and is placed on the target's next open Tribal Council as a taken vote
 * (the tally's existing vote-steal shape, no extra ballot), once; the commissioner's undo takes it
 * back off a council that has not closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const s = vi.hoisted(() => ({ audit: [] as Row[], players: [] as Row[], scores: [] as Row[], councils: [] as Row[], seq: 0 }))

vi.mock('@/lib/prisma', () => {
  const db: Record<string, unknown> = {
    $queryRaw: vi.fn(async () => []),
    survivorAuditEntry: {
      findMany: vi.fn(async ({ where }: { where: Row }) => s.audit.filter((r) => r.leagueId === where.leagueId && r.relatedEntityType === where.relatedEntityType)),
      create: vi.fn(async ({ data }: { data: Row }) => { const r = { id: `a${++s.seq}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, s.seq)), ...data }; s.audit.push(r); return r }),
    },
    survivorPlayer: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => s.players.find((p) => p.redraftRosterId === where.redraftRosterId) ?? null),
    },
    roster: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => (where.id === 'r2' ? { playerData: { lineup_sections: { starters: [{ id: 'qb2', name: 'QB Two' }, { id: 'rb2' }], bench: [{ id: 'wr2' }] } } } : null)),
    },
    survivorWeeklyScore: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId_week: Row } }) => s.scores.find((x) => x.userId === where.leagueId_userId_week.userId && x.week === where.leagueId_userId_week.week) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { leagueId_userId_week: Row }; create: Row; update: Row }) => {
        const hit = s.scores.find((x) => x.userId === where.leagueId_userId_week.userId && x.week === where.leagueId_userId_week.week)
        if (hit) Object.assign(hit, update)
        else s.scores.push({ ...create })
      }),
      update: vi.fn(async ({ where, data }: { where: { leagueId_userId_week: Row }; data: Row }) => {
        Object.assign(s.scores.find((x) => x.userId === where.leagueId_userId_week.userId && x.week === where.leagueId_userId_week.week)!, data)
      }),
    },
    survivorTribalCouncil: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        if (where.id) return s.councils.find((c) => c.id === where.id && (where.closedAt !== null || c.closedAt == null)) ?? null
        const tribes = (where.OR as Row[]).map((o) => o.attendingTribeId)
        return s.councils.find((c) => c.status === where.status && tribes.includes(c.attendingTribeId as string | null)) ?? null
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { Object.assign(s.councils.find((c) => c.id === where.id)!, data) }),
    },
  }
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db))
  return { prisma: db }
})

import { applyPendingVoteTakenRewards, applySurvivorReward, chooseSurvivorRewardTarget, listSurvivorRewards, reverseSurvivorReward, voteTakenPlayId } from '@/lib/survivor/survivorRewardEngine'
import { activeForcedBench, firstStarterId, forcedBenchConflicts, forcedBenchMessage, forcedBenchStarterPoints } from '@/lib/survivor/survivorForcedBench'

beforeEach(() => {
  s.audit = []
  s.scores = []
  s.councils = []
  s.players = [
    { leagueId: 'L1', userId: 'u1', redraftRosterId: 'r1', tribeId: 't1', playerState: 'active' },
    { leagueId: 'L1', userId: 'u2', redraftRosterId: 'r2', tribeId: 't2', playerState: 'active' },
  ]
})

const source = { kind: 'auction' as const, id: 'a1', label: 'Auction' }

describe('opponent point penalty', () => {
  it('waits for the winner, then takes the points off the chosen opponent', async () => {
    const r = await applySurvivorReward({ leagueId: 'L1', idempotencyKey: 'auction:a1:item1', source, week: 6, reward: { type: 'opponent_penalty', chooserRosterId: 'r1', points: 12, targetWeek: 6 } })
    expect(r).toMatchObject({ ok: true, status: 'awaiting_choice' })
    expect(await chooseSurvivorRewardTarget({ leagueId: 'L1', rewardId: 'auction:a1:item1', actorRosterId: 'r2', targetRosterId: 'r1' })).toMatchObject({ ok: false, code: 'forbidden' })
    const chosen = await chooseSurvivorRewardTarget({ leagueId: 'L1', rewardId: 'auction:a1:item1', actorRosterId: 'r1', targetRosterId: 'r2' })
    expect(chosen).toMatchObject({ ok: true, status: 'applied' })
    expect(s.scores.find((x) => x.userId === 'u2')).toMatchObject({ week: 6, pointPenaltyApplied: 12 })
    expect(s.scores.find((x) => x.userId === 'u1')).toBeUndefined() // nothing credited to the winner
  })
})

describe('forced bench', () => {
  it('waits for the choice, then benches the opponent’s first starter (written onto the spec)', async () => {
    await applySurvivorReward({ leagueId: 'L1', idempotencyKey: 'fb1', source, week: 6, reward: { type: 'forced_bench', chooserRosterId: 'r1', targetWeek: 7 } })
    const chosen = await chooseSurvivorRewardTarget({ leagueId: 'L1', rewardId: 'fb1', actorRosterId: 'r1', targetRosterId: 'r2' })
    expect(chosen).toMatchObject({ ok: true, status: 'applied', note: 'forced_bench:qb2:week:7' })
    const rec = (await listSurvivorRewards('L1')).find((r) => r.rewardId === 'fb1')!
    expect(rec.spec).toMatchObject({ type: 'forced_bench', targetRosterId: 'r2', playerId: 'qb2' })
    expect(activeForcedBench([rec], 'r2', 7)).toEqual(new Set(['qb2']))
    expect(activeForcedBench([rec], 'r2', 6).size).toBe(0)
  })

  it('the winner may name the player — but only one on that opponent’s roster', async () => {
    await applySurvivorReward({ leagueId: 'L1', idempotencyKey: 'fb2', source, week: 6, reward: { type: 'forced_bench', chooserRosterId: 'r1' } })
    expect(await chooseSurvivorRewardTarget({ leagueId: 'L1', rewardId: 'fb2', actorRosterId: 'r1', targetRosterId: 'r2', targetPlayerId: 'nobody' })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await chooseSurvivorRewardTarget({ leagueId: 'L1', rewardId: 'fb2', actorRosterId: 'r1', targetRosterId: 'r2', targetPlayerId: 'rb2' })).toMatchObject({ ok: true, note: 'forced_bench:rb2:week:6' })
  })

  it('a reversed forced bench no longer binds', async () => {
    await applySurvivorReward({ leagueId: 'L1', idempotencyKey: 'fb3', source, week: 6, reward: { type: 'forced_bench', chooserRosterId: 'r1', targetRosterId: 'r2' } })
    await reverseSurvivorReward({ leagueId: 'L1', rewardId: 'fb3', actorUserId: 'host' })
    expect(activeForcedBench(await listSurvivorRewards('L1'), 'r2', 6).size).toBe(0)
  })
})

describe('forced bench, pure', () => {
  it('conflicts, EN/ES messages, the scored points it takes away, and the first starter', () => {
    expect(forcedBenchConflicts(['a', 'b', 'a'], new Set(['a']))).toEqual(['a'])
    expect(forcedBenchMessage(['Ana'], 4, 'en')).toBe('Ana is forced to the bench by a Survivor disadvantage and cannot start in week 4.')
    expect(forcedBenchMessage(['Ana', 'Ben'], 4, 'es')).toContain('están en la banca obligatoria')
    expect(forcedBenchStarterPoints([{ playerId: 'a', points: 21.5, isStarter: true }, { playerId: 'a', points: 3, isStarter: false }, { playerId: 'b', points: 9, isStarter: true }], new Set(['a']))).toBe(21.5)
    expect(firstStarterId({ starters: ['x', 'y'] })).toBe('x')
    expect(firstStarterId({})).toBeNull()
  })
})

describe('vote taken', () => {
  it('is held after the choice, then placed on the target’s next open council once', async () => {
    await applySurvivorReward({ leagueId: 'L1', idempotencyKey: 'shop:u1:req1', source, week: 6, reward: { type: 'vote_taken', chooserRosterId: 'r1' } })
    const chosen = await chooseSurvivorRewardTarget({ leagueId: 'L1', rewardId: 'shop:u1:req1', actorRosterId: 'r1', targetRosterId: 'r2' })
    expect(chosen).toMatchObject({ ok: true, status: 'available' })
    // No council open yet: it waits.
    expect(await applyPendingVoteTakenRewards('L1')).toEqual([])
    s.councils.push({ id: 'c1', leagueId: 'L1', week: 7, councilNumber: 1, status: 'voting_open', attendingTribeId: 't2', idolsPlayed: [], closedAt: null })
    expect(await applyPendingVoteTakenRewards('L1')).toEqual(['shop:u1:req1'])
    expect(s.councils[0].idolsPlayed).toEqual([expect.objectContaining({ idolId: voteTakenPlayId('shop:u1:req1'), powerType: 'vote_steal', stolenVoterRosterId: 'r2', stolenVoterUserId: 'u2' })])
    expect((s.councils[0].idolsPlayed as Row[])[0].extraTargetUserId).toBeUndefined()
    expect(await applyPendingVoteTakenRewards('L1')).toEqual([])
    expect((s.councils[0].idolsPlayed as Row[]).length).toBe(1)
    expect((await listSurvivorRewards('L1')).find((r) => r.rewardId === 'shop:u1:req1')?.status).toBe('consumed')
  })

  it('the commissioner’s undo takes the taken vote back off a council still open', async () => {
    await applySurvivorReward({ leagueId: 'L1', idempotencyKey: 'k2', source, week: 6, reward: { type: 'vote_taken', chooserRosterId: 'r1', targetRosterId: 'r2' } })
    s.councils.push({ id: 'c2', leagueId: 'L1', week: 6, councilNumber: 1, status: 'voting_open', attendingTribeId: null, idolsPlayed: [], closedAt: null })
    await applyPendingVoteTakenRewards('L1')
    expect((s.councils[0].idolsPlayed as Row[]).length).toBe(1)
    expect(await reverseSurvivorReward({ leagueId: 'L1', rewardId: 'k2', actorUserId: 'host' })).toMatchObject({ ok: true, status: 'reversed' })
    expect(s.councils[0].idolsPlayed).toEqual([])
  })

  it('lapses when the target has left the island', async () => {
    await applySurvivorReward({ leagueId: 'L1', idempotencyKey: 'k3', source, week: 6, reward: { type: 'vote_taken', chooserRosterId: 'r1', targetRosterId: 'r2' } })
    s.players[1].playerState = 'eliminated'
    expect(await applyPendingVoteTakenRewards('L1')).toEqual(['k3'])
    expect((await listSurvivorRewards('L1')).find((r) => r.rewardId === 'k3')?.status).toBe('expired')
  })
})
