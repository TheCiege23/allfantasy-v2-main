/**
 * A snake salary-cap pick signs a rookie contract (`submitPick` → `assignRookieContract`).
 *
 * Since #1928 (2026-10-03) the write spread `draftPickOverall`, `draftRound` and `contractSource`
 * into `prisma.playerContract.create`, behind `typeof prisma.playerContract.create === 'function'`
 * — always true, so always sent. `PlayerContract` has none of those fields, Prisma rejects unknown
 * arguments, and `submitPick` catches the error and only logs `salary_cap_contract_failed`. Every
 * snake salary-cap pick left its league without a contract, and nothing went red.
 *
 * Mocked prisma accepts anything, which is how this hid; so the test holds the write to the
 * GENERATED client's own model, read from its DMMF.
 */
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  startupDraftType: 'snake' as string | null,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ leagueSize: 10 })) },
    $queryRaw: vi.fn(async () => []),
    playerContract: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data)
        return { id: 'c-1' }
      }),
    },
  },
}))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({
  getSalaryCapConfig: vi.fn(async () =>
    h.startupDraftType === null
      ? null
      : {
          leagueId: 'L', configId: 'cfg-1', sport: 'NFL', startupCap: 300, minimumSalary: 1, rookieContractYears: 0,
          startupDraftType: h.startupDraftType,
        },
  ),
}))

import { assignRookieContract, rookieContractPlayerId, signRookieContractForPick } from '@/lib/salary-cap/RookieContractService'

const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'PlayerContract')
const writable = new Set((model?.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name))

beforeEach(() => {
  h.created = []
  h.startupDraftType = 'snake'
})

describe('the rookie contract write', () => {
  it('the generated model is what this test thinks it is', () => {
    // Positive control: if the DMMF read silently returned nothing, every check below would pass.
    expect(writable.has('salary')).toBe(true)
    expect(writable.has('yearsTotal')).toBe(true)
    expect(writable.size).toBeGreaterThan(15)
  })

  it('sends only fields PlayerContract has', async () => {
    const res = await assignRookieContract('L', 'r1', 'p1', 'Atlas Runner', 'RB', 23, 2026)
    expect(res.ok).toBe(true)
    expect(h.created).toHaveLength(1)
    const unknown = Object.keys(h.created[0]).filter((k) => !writable.has(k))
    expect(unknown).toEqual([])
  })

  it('keeps the pick it came from, in the contract metadata', async () => {
    await assignRookieContract('L', 'r1', 'p1', 'Atlas Runner', 'RB', 23, 2026)
    expect(h.created[0]).toMatchObject({ source: 'rookie_draft', configId: 'cfg-1', rosterId: 'r1', playerId: 'p1' })
    // Slot 23 in a 10-team league is round 3.
    expect(h.created[0].metadata).toEqual({ draftPickOverall: 23, draftRound: 3 })
  })
})

describe('which picks sign a contract', () => {
  const pick = { leagueId: 'L', rosterId: 'r1', playerId: 'p1', playerName: ' Atlas Runner ', position: 'RB', overall: 4 }

  it('a snake cap league signs, as submitPick always gated it', async () => {
    expect((await signRookieContractForPick(pick))?.ok).toBe(true)
    expect(h.created[0]).toMatchObject({ rosterId: 'r1', playerId: 'p1', playerName: 'Atlas Runner', metadata: { draftPickOverall: 4, draftRound: 1 } })
  })

  it('an auction startup, a league with no cap, or a pick with no team signs nothing', async () => {
    h.startupDraftType = 'auction'
    expect(await signRookieContractForPick(pick)).toBeNull()
    h.startupDraftType = null
    expect(await signRookieContractForPick(pick)).toBeNull()
    h.startupDraftType = 'snake'
    expect(await signRookieContractForPick({ ...pick, rosterId: null })).toBeNull()
    expect(h.created).toHaveLength(0)
  })

  it('a pick with no player id signs under its slot, the key undo and the editor look for', () => {
    expect(rookieContractPlayerId(null, 7)).toBe('draft-7')
    expect(rookieContractPlayerId('  ', 7)).toBe('draft-7')
    expect(rookieContractPlayerId('p9', 7)).toBe('p9')
  })
})
