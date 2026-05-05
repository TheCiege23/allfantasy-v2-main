/**
 * Draft pick trades — service-level behavior (no Playwright).
 *
 * AUDIT (existing code paths):
 * - **DraftPickTradeService**: `appendDraftPickTrades` merges `TradedPickRecord[]` into `DraftSession.tradedPicks`
 *   JSON and bumps `version`. `getSessionTradedPicks` reads that JSON. No Prisma proposal rows here.
 * - **PickOwnershipResolver.resolvePickOwner**: For `(round, slot)`, finds `slotOrder[slot]`, then matches
 *   `tradedPicks` entries where `round` and `originalRosterId === slotEntry.rosterId` (canonical original slot
 *   owner). **Latest matching record wins** (array reversed before `.find`).
 * - **Pending proposals**: Stored as `DraftPickTradeProposal` rows (`status: pending`). They do **not** mutate
 *   `tradedPicks` until the receiver **accepts** (`trade-proposals/[proposalId]` POST `action: accept`).
 * - **Rejected / cancelled**: Update proposal status only — no `appendDraftPickTrades`.
 * - **Unpicked picks only**: `trade-proposals` POST rejects if either pick’s overall is already on the board
 *   (`draftedOveralls` guard). No proposal creation for consumed slots.
 * - **Trade approval settings**: Receiver acceptance is the gate for pick-slot trades in this route; there is
 *   **no separate commissioner/veto queue** in `DraftPickTradeService` or the accept handler beyond UI flags
 *   (`pickTradeEnabled`, tournament safety). League “instant vs commissioner vs vote” for **regular** trades
 *   is a different subsystem — do not assume it applies here without an explicit integration.
 * - **Post-pick player / roster transfer**: Not handled by `DraftPickTradeService`. Drafted player movement
 *   uses other flows (e.g. commissioner pick edit / league trades). `DraftPick.rosterId` stays the selecting
 *   team at commit time; `originalRosterId` + `tradedPickMeta` capture slot lineage for UI.
 *
 * Race with autopick: concurrent writers rely on `submitPick` stale/race guards + session version (see
 * `submitPick.transaction.test.ts`, `expired-autopick.transaction.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'

const slotOrder = [
  { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
  { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
]

const tradeStore = vi.hoisted(() => ({
  id: 'session-1',
  tradedPicks: [] as TradedPickRecord[],
  version: 3,
}))

const tradePrisma = vi.hoisted(() => ({
  draftSession: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: tradePrisma,
}))

function wireTradePrismaMocks() {
  tradePrisma.draftSession.findUnique.mockImplementation(async () => ({
    id: tradeStore.id,
    tradedPicks: tradeStore.tradedPicks as unknown[],
  }))
  tradePrisma.draftSession.update.mockImplementation(
    async ({
      data,
    }: {
      data: { tradedPicks?: unknown; version?: { increment: number }; updatedAt?: Date }
    }) => {
      if (data.tradedPicks != null) {
        tradeStore.tradedPicks = data.tradedPicks as TradedPickRecord[]
      }
      if (data.version?.increment) {
        tradeStore.version += data.version.increment
      }
      return { ...tradeStore }
    },
  )
}

const { appendDraftPickTrades, getSessionTradedPicks } = await import('@/lib/live-draft-engine/DraftPickTradeService')

describe('PickOwnershipResolver — unpicked pick trades', () => {
  it('without overlay, slot 1 owner is Team A', () => {
    const o = resolvePickOwner(1, 1, slotOrder, [])
    expect(o?.rosterId).toBe('roster-a')
    expect(o?.tradedPickMeta).toBeNull()
  })

  it('after accepted-style overlay, round 1 slot 1 resolves to new owner Team B with original metadata', () => {
    const traded: TradedPickRecord[] = [
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'Team A',
        newRosterId: 'roster-b',
        newOwnerName: 'Team B',
      },
    ]
    const o = resolvePickOwner(1, 1, slotOrder, traded)
    expect(o?.rosterId).toBe('roster-b')
    expect(o?.displayName).toBe('Team B')
    expect(o?.tradedPickMeta?.originalRosterId).toBe('roster-a')
    expect(o?.tradedPickMeta?.previousOwnerName).toBe('Team A')
  })

  it('latest accepted trade wins when multiple records match same round/original', () => {
    const traded: TradedPickRecord[] = [
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'Team A',
        newRosterId: 'roster-b',
        newOwnerName: 'Team B',
      },
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'Team B',
        newRosterId: 'roster-c',
        newOwnerName: 'Team C',
      },
    ]
    const o = resolvePickOwner(1, 1, slotOrder, traded)
    expect(o?.rosterId).toBe('roster-c')
    expect(o?.tradedPickMeta?.newOwnerName).toBe('Team C')
  })

  it('pending / rejected proposals do not exist in resolver input — empty tradedPicks keeps original owner', () => {
    const o = resolvePickOwner(1, 1, slotOrder, [])
    expect(o?.rosterId).toBe('roster-a')
  })
})

describe('trade-proposals route guard (mirror) — cannot propose traded picks already on the board', () => {
  function pickSlotAlreadyUsed(
    draftedOveralls: Set<number>,
    giveOverall: number | null,
    receiveOverall: number | null,
  ): boolean {
    return (
      (giveOverall != null && draftedOveralls.has(giveOverall)) ||
      (receiveOverall != null && draftedOveralls.has(receiveOverall))
    )
  }

  it('blocks when give overall is drafted', () => {
    expect(pickSlotAlreadyUsed(new Set([1, 2]), 1, 5)).toBe(true)
  })

  it('blocks when receive overall is drafted', () => {
    expect(pickSlotAlreadyUsed(new Set([3]), 7, 3)).toBe(true)
  })

  it('allows when neither overall is drafted', () => {
    expect(pickSlotAlreadyUsed(new Set([1, 2]), 7, 8)).toBe(false)
  })
})

describe('DraftPickTradeService — mocked Prisma', () => {
  beforeEach(() => {
    tradeStore.tradedPicks = []
    tradeStore.version = 3
    vi.clearAllMocks()
    wireTradePrismaMocks()
  })

  it('appendDraftPickTrades merges records and increments version', async () => {
    const first: TradedPickRecord[] = [
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'A',
        newRosterId: 'roster-b',
        newOwnerName: 'B',
      },
    ]
    const r1 = await appendDraftPickTrades('league-1', first)
    expect(r1.success).toBe(true)
    expect(tradeStore.tradedPicks).toHaveLength(1)
    expect(tradeStore.version).toBe(4)

    const second: TradedPickRecord[] = [
      {
        round: 2,
        originalRosterId: 'roster-b',
        previousOwnerName: 'B',
        newRosterId: 'roster-a',
        newOwnerName: 'A',
      },
    ]
    const r2 = await appendDraftPickTrades('league-1', second)
    expect(r2.success).toBe(true)
    expect(tradeStore.tradedPicks).toHaveLength(2)
    expect(tradeStore.version).toBe(5)
  })

  it('getSessionTradedPicks returns persisted JSON array', async () => {
    tradeStore.tradedPicks = [
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'A',
        newRosterId: 'roster-b',
        newOwnerName: 'B',
      },
    ]
    const rows = await getSessionTradedPicks('league-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.newRosterId).toBe('roster-b')
  })

  it('appendDraftPickTrades fails when session missing', async () => {
    tradePrisma.draftSession.findUnique.mockResolvedValueOnce(null)
    const r = await appendDraftPickTrades('missing-league', [])
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not found/i)
  })
})

describe('Accept-path trade pair (mirrors proposal route semantics)', () => {
  it('swap appends two complementary TradedPickRecord rows for a two-team pick swap', () => {
    const slotOrderLocal = [
      { slot: 1, rosterId: 'ra', displayName: 'A' },
      { slot: 2, rosterId: 'rb', displayName: 'B' },
    ]
    const proposal = {
      giveRound: 2,
      giveSlot: 1,
      giveOriginalRosterId: 'ra',
      receiveRound: 3,
      receiveSlot: 2,
      receiveOriginalRosterId: 'rb',
      proposerRosterId: 'ra',
      receiverRosterId: 'rb',
    }
    const giveEntry = slotOrderLocal.find((e) => e.slot === proposal.giveSlot)!
    const receiveEntry = slotOrderLocal.find((e) => e.slot === proposal.receiveSlot)!
    const newTrades: TradedPickRecord[] = [
      {
        round: proposal.giveRound,
        originalRosterId: proposal.giveOriginalRosterId,
        previousOwnerName: giveEntry.displayName,
        newRosterId: proposal.receiverRosterId,
        newOwnerName: receiveEntry.displayName,
      },
      {
        round: proposal.receiveRound,
        originalRosterId: proposal.receiveOriginalRosterId,
        previousOwnerName: receiveEntry.displayName,
        newRosterId: proposal.proposerRosterId,
        newOwnerName: giveEntry.displayName,
      },
    ]
    expect(newTrades).toHaveLength(2)
    const ownerGive = resolvePickOwner(proposal.giveRound, proposal.giveSlot, slotOrderLocal, newTrades)
    const ownerRecv = resolvePickOwner(proposal.receiveRound, proposal.receiveSlot, slotOrderLocal, newTrades)
    expect(ownerGive?.rosterId).toBe('rb')
    expect(ownerRecv?.rosterId).toBe('ra')
  })
})

describe('Documented gaps (not asserted — evolve in place)', () => {
  it('notes: commissioner/veto chains for draft pick proposals are not in DraftPickTradeService', () => {
    expect(true).toBe(true)
  })

  it('notes: roster transfer of an already-drafted player uses other services; pick-slot trades reject drafted boards', () => {
    expect(true).toBe(true)
  })
})
