// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Releasing a zombie week held for review (lib/zombie/settlementHoldRelease.ts) and saying why it was held
 * (lib/zombie/settlementHoldReasons.ts). Before this, a held week could never be released and the season stalled.
 */

const m = vi.hoisted(() => ({
  league: { correctionHoldFromWeek: null as number | null } as { correctionHoldFromWeek: number | null } | null,
  row: null as { id: string; status: string; resolvedAt: Date | null; matchupResults: unknown } | null,
  releaseCount: 1,
  updates: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
  audits: [] as Array<Record<string, unknown>>,
  heldCode: 'ZOMBIE_WINNINGS_STATUS_REQUIRED' as string | null,
  runResult: { resolution: { status: 'complete' } } as { resolution: { status: string } | null; reason?: string },
  runs: 0,
}))

vi.mock('@prisma/client', () => ({ Prisma: { DbNull: 'DbNull' } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: vi.fn(async () => m.league) },
    zombieWeeklyResolution: {
      findUnique: vi.fn(async () => m.row),
      findFirst: vi.fn(async () => (m.row?.status === 'review_required' ? { week: 6 } : null)),
      updateMany: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => { m.updates.push(args); return { count: m.releaseCount } }),
    },
    zombieAuditEntry: {
      findFirst: vi.fn(async () => (m.heldCode ? { newState: { code: m.heldCode }, createdAt: new Date('2026-11-17T12:00:00Z') } : null)),
    },
  },
}))
vi.mock('@/lib/zombie/auditService', () => ({ logAuditEntry: vi.fn(async (_id: string, e: Record<string, unknown>) => { m.audits.push(e) }) }))
vi.mock('@/lib/zombie/weeklyResolutionEngine', () => ({
  runWeeklyResolution: vi.fn(async () => { m.runs += 1; return m.runResult }),
}))

import { readSettlementHold, releaseSettlementHold } from '@/lib/zombie/settlementHoldRelease'
import { describeHoldReason } from '@/lib/zombie/settlementHoldReasons'

const release = () => releaseSettlementHold({ zombieLeagueId: 'z1', week: 6, actorUserId: 'u-comm' })

beforeEach(() => {
  m.league = { correctionHoldFromWeek: null }
  m.row = { id: 'r6', status: 'review_required', resolvedAt: null, matchupResults: [] }
  m.releaseCount = 1
  m.updates.length = 0
  m.audits.length = 0
  m.heldCode = 'ZOMBIE_WINNINGS_STATUS_REQUIRED'
  m.runResult = { resolution: { status: 'complete' } }
  m.runs = 0
})

describe('describeHoldReason', () => {
  it('sorts each code into who can act on it, and an unknown code is support, never a guess', () => {
    expect(describeHoldReason('ZOMBIE_WINNINGS_STATUS_REQUIRED')).toMatchObject({ kind: 'commissioner', text: expect.stringContaining('Override status') })
    expect(describeHoldReason('ZOMBIE_ITEMS_MISSING_SCORE_RECEIPT')).toMatchObject({ kind: 'scores' })
    expect(describeHoldReason('ZOMBIE_WINNINGS_OPENING_BALANCE_REQUIRED')).toMatchObject({ kind: 'support' })
    expect(describeHoldReason('SOMETHING_NEW')).toMatchObject({ code: 'SOMETHING_NEW', kind: 'support' })
    expect(describeHoldReason(null)).toMatchObject({ code: 'UNKNOWN', kind: 'support' })
  })
})

describe('readSettlementHold', () => {
  it('names the held week and its recorded reason', async () => {
    expect(await readSettlementHold('z1')).toMatchObject({ week: 6, reason: { code: 'ZOMBIE_WINNINGS_STATUS_REQUIRED', kind: 'commissioner' } })
  })
  it('a week held before reasons were recorded reads as unknown (support)', async () => {
    m.heldCode = null
    expect(await readSettlementHold('z1')).toMatchObject({ week: 6, reason: { code: 'UNKNOWN', kind: 'support' }, heldAt: null })
  })
  it('nothing held, nothing shown', async () => {
    m.row = { id: 'r6', status: 'complete', resolvedAt: new Date(), matchupResults: [] }
    expect(await readSettlementHold('z1')).toBeNull()
  })
})

describe('releaseSettlementHold', () => {
  it('puts the week back to pending, drops the stale snapshot, logs who and why, and runs the settlement', async () => {
    const r = await release()
    expect(r).toMatchObject({ ok: true, outcome: 'settled' })
    expect(m.updates).toEqual([{
      where: { id: 'r6', status: 'review_required', resolvedAt: null },
      data: { status: 'pending', settlementSnapshot: 'DbNull', requiresStatCorrection: false },
    }])
    expect(m.audits).toEqual([expect.objectContaining({
      action: 'COMMISSIONER_RELEASED_SETTLEMENT_HOLD', week: 6, actorUserId: 'u-comm',
      previousState: { status: 'review_required', reason: 'ZOMBIE_WINNINGS_STATUS_REQUIRED' },
    })])
    expect(m.runs).toBe(1)
  })

  it('a cause still there holds it again, with the reason — a retry never forces anything through', async () => {
    m.runResult = { resolution: { status: 'review_required' } }
    expect(await release()).toMatchObject({ ok: true, outcome: 'held_again', detail: expect.stringContaining('Override status') })
  })

  it('a week still waiting on scores is released and left for the next run', async () => {
    m.runResult = { resolution: null, reason: 'matchups_incomplete' }
    expect(await release()).toMatchObject({ ok: true, outcome: 'waiting', detail: expect.stringContaining('matchups_incomplete') })
  })

  it('refuses a week that is not held, writing nothing and running nothing', async () => {
    for (const status of ['pending', 'resolving', 'complete']) {
      m.row = { id: 'r6', status, resolvedAt: null, matchupResults: [] }
      expect(await release()).toMatchObject({ ok: false, status: 409 })
    }
    m.row = null
    expect(await release()).toMatchObject({ ok: false, status: 409 })
    expect(m.updates).toEqual([])
    expect(m.runs).toBe(0)
  })

  it('refuses a held week that already has results — never replays applied effects from here', async () => {
    m.row = { id: 'r6', status: 'review_required', resolvedAt: new Date(), matchupResults: [] }
    expect(await release()).toMatchObject({ ok: false, status: 409 })
    m.row = { id: 'r6', status: 'review_required', resolvedAt: null, matchupResults: [{ homeUserId: 'a' }] }
    expect(await release()).toMatchObject({ ok: false, status: 409 })
    expect(m.updates).toEqual([])
    expect(m.runs).toBe(0)
  })

  it('refuses while a reviewed stat correction is in progress', async () => {
    m.league = { correctionHoldFromWeek: 5 }
    expect(await release()).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('correction') })
    expect(m.updates).toEqual([])
  })

  it('two commissioners pressing at once release it once: the loser of the race runs nothing', async () => {
    m.releaseCount = 0
    expect(await release()).toMatchObject({ ok: false, status: 409 })
    expect(m.audits).toEqual([])
    expect(m.runs).toBe(0)
  })
})
