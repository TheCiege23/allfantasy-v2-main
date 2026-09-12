import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `validateRedraftTradeCapInTransaction` must read EVERYTHING through the transaction it is given.
 *
 * ⚠ THE MODULE-LEVEL `prisma` BELOW THROWS ON EVERY READ, AND THAT IS THE WHOLE TECHNIQUE. A check
 * that took its config from `tx` but its salary totals from `prisma` — `getTeamCapSummary` used to
 * hardcode the module client — would look transactional in a review and read stale numbers in
 * production. Mocks that return data on both clients cannot tell those apart. A client that refuses
 * to be read can.
 */

const MODULE_CLIENT_READ = 'read went to the module prisma client, not the transaction'
const refuse = () => vi.fn(async () => {
  throw new Error(MODULE_CLIENT_READ)
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    iDPCapConfig: { findUnique: refuse() },
    iDPSalaryRecord: { findMany: refuse() },
    iDPDeadMoney: { findMany: refuse() },
  },
}))

const CFG = {
  season: 2026,
  totalCap: 100,
  inSeasonHoldbackEnabled: false,
  inSeasonHoldbackPct: 0,
  capFloorEnabled: false,
  capFloor: null,
}

type Row = { rosterId: string; playerId: string; salary: number }

function salaryRow(r: Row) {
  return { ...r, status: 'active', contractStartYear: 2026, contractYears: 1 }
}

/** A transaction client over a fixed set of salary rows. */
function txOver(rows: Row[]) {
  return {
    iDPCapConfig: { findUnique: vi.fn(async () => CFG) },
    iDPSalaryRecord: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: string; playerId?: { in: string[] } } }) =>
        rows
          .filter((r) => r.rosterId === where.rosterId)
          .filter((r) => !where.playerId || where.playerId.in.includes(r.playerId))
          .map(salaryRow),
      ),
    },
    iDPDeadMoney: { findMany: vi.fn(async () => []) },
  }
}

describe('validateRedraftTradeCapInTransaction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('approves a trade that fits, reading only from the transaction', async () => {
    // proposer r1 uses 30 (p1); receiver r2 uses 60. p1 moves to r2: receiver ends at 90 of 100.
    const tx = txOver([
      { rosterId: 'r1', playerId: 'p1', salary: 30 },
      { rosterId: 'r2', playerId: 'q1', salary: 60 },
    ])
    const { validateRedraftTradeCapInTransaction } = await import('@/lib/idp/capEngine')

    const v = await validateRedraftTradeCapInTransaction(tx as never, 'l1', 'r1', 'r2', [{ playerId: 'p1' }], [])

    expect(v).toEqual({ ok: true })
    // Salary totals (getTeamCapSummary) AND the traded-salary sum both came through `tx`.
    expect(tx.iDPSalaryRecord.findMany).toHaveBeenCalled()
    expect(tx.iDPDeadMoney.findMany).toHaveBeenCalled()
  })

  it('refuses a trade that would put the receiver over, on the numbers the transaction sees', async () => {
    // Receiver now at 80 — e.g. another settlement landed after the early check approved.
    const tx = txOver([
      { rosterId: 'r1', playerId: 'p1', salary: 30 },
      { rosterId: 'r2', playerId: 'q1', salary: 80 },
    ])
    const { validateRedraftTradeCapInTransaction } = await import('@/lib/idp/capEngine')

    const v = await validateRedraftTradeCapInTransaction(tx as never, 'l1', 'r1', 'r2', [{ playerId: 'p1' }], [])

    expect(v).toEqual({ ok: false, message: 'Trade would put receiver over the salary cap.' })
  })

  it('the non-transactional validateRedraftTradeCap still reads the module client', async () => {
    // The other half of the routing proof: the public three-caller API is unchanged, so it hits the
    // module client — which in this file refuses, proving which client it chose.
    const { validateRedraftTradeCap } = await import('@/lib/idp/capEngine')
    await expect(validateRedraftTradeCap('l1', 'r1', 'r2', [{ playerId: 'p1' }], [])).rejects.toThrow(MODULE_CLIENT_READ)
  })

  it('getTeamCapSummary keeps its three-argument behaviour and honours an explicit client', async () => {
    // Twelve existing callers pass three arguments. They must keep reading the module client; only a
    // caller that passes a client gets the new behaviour.
    const { getTeamCapSummary } = await import('@/lib/idp/capEngine')
    await expect(getTeamCapSummary('l1', 'r1', 2026)).rejects.toThrow(MODULE_CLIENT_READ)

    const tx = txOver([{ rosterId: 'r1', playerId: 'p1', salary: 30 }])
    const s = await getTeamCapSummary('l1', 'r1', 2026, tx as never)
    expect(s.totalCapUsed).toBe(30)
    expect(s.availableCap).toBe(70)
  })
})
