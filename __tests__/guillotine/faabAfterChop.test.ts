import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    rosters: [] as Array<{ id: string; faabRemaining: number | null }>,
    chopped: [] as string[],
    events: [] as Array<{ key: string; metadata: Record<string, unknown> }>,
  }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: { findUnique: vi.fn(async () => ({ settings: state.settings })) },
    guillotineEventLog: {
      findFirst: vi.fn(async ({ where }: { where: { metadata: { equals: string } } }) => state.events.find((e) => e.key === where.metadata.equals) ?? null),
      create: vi.fn(async ({ data }: { data: { metadata: Record<string, unknown> } }) => { state.events.push({ key: String(data.metadata.key), metadata: data.metadata }); return {} }),
    },
    roster: {
      findMany: vi.fn(async () => state.rosters.map((r) => ({ ...r }))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { faabRemaining: number } }) => {
        const r = state.rosters.find((x) => x.id === where.id)!
        r.faabRemaining = data.faabRemaining
        return r
      }),
    },
    guillotineRosterState: { findMany: vi.fn(async () => state.chopped.map((rosterId) => ({ rosterId }))) },
  }
  return { state, tx }
})
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (fn: (t: unknown) => unknown) => fn(db.tx) } }))

import { applyFaabAfterChop } from '@/lib/guillotine/faabAfterChop'

const balances = () => Object.fromEntries(db.state.rosters.map((r) => [r.id, r.faabRemaining]))

describe('FAAB after a chop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.state.settings = { guillotine_advanced: { steps: [], overrides: {}, immunity: 'off', faab: { mode: 'add', amount: 25 } } }
    db.state.rosters = [{ id: 'a', faabRemaining: 40 }, { id: 'b', faabRemaining: null }, { id: 'out', faabRemaining: 90 }]
    db.state.chopped = ['out']
    db.state.events = []
  })

  it('tops up every survivor once, leaves the chopped team alone, and records what changed', async () => {
    expect(await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's1', weekOrPeriod: 4 })).toEqual({ applied: true, rosters: 2 })
    expect(balances()).toEqual({ a: 65, b: 25, out: 90 })
    expect(db.state.events[0].metadata).toMatchObject({ key: 's1:4', changes: [{ rosterId: 'a', before: 40, after: 65 }, { rosterId: 'b', before: null, after: 25 }] })
    expect(db.tx.$queryRaw).toHaveBeenCalled()
  })

  it('a retry of the same week changes nothing; the next week applies again', async () => {
    await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's1', weekOrPeriod: 4 })
    expect(await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's1', weekOrPeriod: 4 })).toEqual({ applied: false, reason: 'already_applied' })
    expect(balances()).toEqual({ a: 65, b: 25, out: 90 })
    await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's1', weekOrPeriod: 5 })
    expect(balances()).toEqual({ a: 90, b: 50, out: 90 })
  })

  it('the same week of a new season is its own chop', async () => {
    await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's1', weekOrPeriod: 4 })
    expect(await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's2', weekOrPeriod: 4 })).toMatchObject({ applied: true })
  })

  it('a reset sets every survivor to the amount', async () => {
    db.state.settings = { guillotine_advanced: { faab: { mode: 'set', amount: 100 } } }
    await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's1', weekOrPeriod: 4 })
    expect(balances()).toEqual({ a: 100, b: 100, out: 90 })
  })

  it('does nothing, and writes no marker, when the rule is unchanged', async () => {
    db.state.settings = {}
    expect(await applyFaabAfterChop({ leagueId: 'l', seasonKey: 's1', weekOrPeriod: 4 })).toEqual({ applied: false, reason: 'rule_unchanged' })
    expect(db.tx.roster.update).not.toHaveBeenCalled()
    expect(db.state.events).toEqual([])
  })
})
