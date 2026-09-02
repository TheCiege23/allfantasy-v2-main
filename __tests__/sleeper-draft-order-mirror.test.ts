import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The Sleeper draft mirror finally reads the draft ORDER.
 *
 * 🛑 THE DEFECT. `mirrorActiveSleeperDrafts` includes `pre_draft` in its pollable statuses on
 * purpose, and its own comment says why: "that is when the draft ORDER appears, and a board
 * that only wakes up once picks start misses the thing managers check most in the days
 * before." But the order arrives in `draft_order` and `slot_to_roster_id`, `syncDraftFromSleeper`
 * declared neither on its `SleeperDraft` type, and in `pre_draft` there are ZERO picks — so the
 * board it polled every minute for was blank until the first pick landed. The data was already
 * in the response it fetches, and the display names were already fetched too.
 */

const h = vi.hoisted(() => ({
  prisma: {
    draftSession: {
      update: vi.fn(async () => ({ id: 'sess-1' })),
      /* Default: nobody has set an order here. `slotOrder` is `Json @default("[]")`, so that
         is a genuinely empty array rather than null. */
      findUnique: vi.fn(async () => ({ slotOrder: [] as unknown[] })),
    },
    draftPick: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(h.prisma)),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import { syncDraftFromSleeper } from '@/lib/draft/sleeperSync'

type Json = Record<string, unknown> | unknown[]

/** Drive the three fetches the sync makes: /draft/{id}, /draft/{id}/picks, /league/{id}/users. */
function mockSleeper(opts: { draft: Json; picks?: Json; users?: Json }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const url = String(input)
    const body = url.endsWith('/picks')
      ? (opts.picks ?? [])
      : url.includes('/league/')
        ? (opts.users ?? [])
        : opts.draft
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  })
}

const DRAFT_BASE = {
  draft_id: 'd1',
  league_id: 'L1',
  status: 'pre_draft',
  settings: { rounds: 3, teams: 2, pick_timer: 90 },
}

function updateData() {
  return h.prisma.draftSession.update.mock.calls[0]![0]!.data as Record<string, unknown>
}

beforeEach(() => {
  vi.restoreAllMocks()
  h.prisma.draftSession.findUnique.mockClear()
  h.prisma.draftSession.findUnique.mockImplementation(async () => ({ slotOrder: [] as unknown[] }))
  h.prisma.draftSession.update.mockClear()
  h.prisma.draftPick.deleteMany.mockClear()
  h.prisma.draftPick.createMany.mockClear()
})

describe('draft order in pre_draft', () => {
  /*
   * The headline: a draft with NO picks yet must still produce a board. This is the case the
   * mirror polls `pre_draft` for and could not previously satisfy.
   */
  it('builds the order from slot_to_roster_id and draft_order with zero picks', async () => {
    mockSleeper({
      draft: {
        ...DRAFT_BASE,
        draft_order: { u_alice: 2, u_bob: 1 },
        slot_to_roster_id: { '1': 7, '2': 4 },
      },
      picks: [],
      users: [
        { user_id: 'u_alice', display_name: 'Alice' },
        { user_id: 'u_bob', display_name: 'Bob' },
      ],
    })

    await syncDraftFromSleeper('d1', 'sess-1')

    expect(updateData().slotOrder).toEqual([
      { slot: 1, rosterId: '7', displayName: 'Bob' },
      { slot: 2, rosterId: '4', displayName: 'Alice' },
    ])
  })

  /*
   * `draft_order` is keyed BY USER, so answering "who is in slot N" requires inverting it.
   * Getting this backwards produces a board that is subtly wrong rather than obviously broken
   * — every manager in the wrong seat, which reads as a real order.
   */
  it('inverts draft_order rather than reading it as slot-keyed', async () => {
    mockSleeper({
      draft: { ...DRAFT_BASE, draft_order: { u_z: 1 }, slot_to_roster_id: { '1': 3 } },
      picks: [],
      users: [{ user_id: 'u_z', display_name: 'Zoe' }],
    })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().slotOrder).toEqual([{ slot: 1, rosterId: '3', displayName: 'Zoe' }])
  })

  it('sorts by slot regardless of key order', async () => {
    mockSleeper({
      draft: { ...DRAFT_BASE, draft_order: {}, slot_to_roster_id: { '3': 30, '1': 10, '2': 20 } },
      picks: [],
    })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect((updateData().slotOrder as { slot: number }[]).map((s) => s.slot)).toEqual([1, 2, 3])
  })

  /*
   * Sleeper leaves `draft_order` null until the commissioner sets it. The slots and their
   * rosters still exist, so the board should render seats with no name yet — an honest
   * absence, not a fabricated "Team 4" that is indistinguishable from a chosen name.
   */
  it('keeps the slots when no order has been set, with empty names', async () => {
    mockSleeper({
      draft: { ...DRAFT_BASE, draft_order: null, slot_to_roster_id: { '1': 5, '2': 6 } },
      picks: [],
    })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().slotOrder).toEqual([
      { slot: 1, rosterId: '5', displayName: '' },
      { slot: 2, rosterId: '6', displayName: '' },
    ])
  })
})

describe('an empty order never overwrites a good one', () => {
  /*
   * 🛑 SAME RULE THE PICKS FETCH ALREADY ENFORCES, AND FOR THE SAME REASON. That fetch fails
   * closed rather than writing `[]`, because one upstream blip would otherwise blank a live
   * board. Sleeper can answer without `slot_to_roster_id`; writing the empty result would wipe
   * the order once a minute and look like the mirror working.
   */
  it('omits slotOrder entirely when Sleeper published no order', async () => {
    mockSleeper({ draft: { ...DRAFT_BASE, slot_to_roster_id: null }, picks: [] })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData()).not.toHaveProperty('slotOrder')
  })

  it('omits it when slot_to_roster_id is absent from the payload', async () => {
    mockSleeper({ draft: { ...DRAFT_BASE }, picks: [] })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData()).not.toHaveProperty('slotOrder')
  })
})

describe('the mirror seeds the order and never fights a human for it', () => {
  /*
   * 🛑 THE REGRESSION THIS EXISTS TO STOP, FOUND BY READING THE OTHER WRITERS OF THIS COLUMN.
   * `/draft/lottery/run` (finalize) and `/draft/order` (POST) both write `slotOrder` on
   * `where: { leagueId }` — `@unique`, so the same row this mirror updates by `id` — and BOTH
   * refuse unless `status === 'pre_draft'`, which is exactly the window the mirror polls once
   * a minute. Writing unconditionally replaces a commissioner's lottery result inside 60
   * seconds with no error and no marker.
   */
  it('leaves a lottery result alone rather than replacing it with Sleeper order', async () => {
    h.prisma.draftSession.findUnique.mockImplementation(async () => ({
      slotOrder: [{ slot: 1, rosterId: 'af-team-a', displayName: 'Alice' }] as unknown[],
    }))
    mockSleeper({
      draft: { ...DRAFT_BASE, draft_order: { u_b: 1 }, slot_to_roster_id: { '1': 9 } },
      picks: [],
      users: [{ user_id: 'u_b', display_name: 'Bob' }],
    })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData()).not.toHaveProperty('slotOrder')
  })

  it('seeds when the stored order is the empty default', async () => {
    mockSleeper({
      draft: { ...DRAFT_BASE, draft_order: { u_b: 1 }, slot_to_roster_id: { '1': 9 } },
      picks: [],
      users: [{ user_id: 'u_b', display_name: 'Bob' }],
    })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().slotOrder).toEqual([{ slot: 1, rosterId: '9', displayName: 'Bob' }])
  })

  /* Reading the wrong row would make the guard pass while protecting nothing. */
  it('reads the order off the session it is about to update', async () => {
    mockSleeper({ draft: { ...DRAFT_BASE, slot_to_roster_id: { '1': 9 } }, picks: [] })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(h.prisma.draftSession.findUnique).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      select: { slotOrder: true },
    })
  })

  /*
   * ⚠ THE DELIBERATE ASYMMETRY. These two are FACTS about Sleeper's draft, not preferences
   * about it: a local `thirdRoundReversal` toggle cannot change how the real draft runs, it
   * only makes our pick-order maths disagree with the board. So they overwrite, exactly as
   * `rounds`/`teamCount`/`timerSeconds`/`status` always have — while the order does not.
   */
  it('still writes draftType and thirdRoundReversal over a session that has a local order', async () => {
    h.prisma.draftSession.findUnique.mockImplementation(async () => ({
      slotOrder: [{ slot: 1, rosterId: 'af-team-a', displayName: 'Alice' }] as unknown[],
    }))
    mockSleeper({
      draft: { ...DRAFT_BASE, type: 'linear', settings: { ...DRAFT_BASE.settings, reversal_round: 3 } },
      picks: [],
    })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().draftType).toBe('linear')
    expect(updateData().thirdRoundReversal).toBe(true)
  })
})

describe('draft type and reversal', () => {
  it.each([
    ['auction', 'auction'],
    ['linear', 'linear'],
    ['snake', 'snake'],
  ])('maps Sleeper type %s to %s', async (given, expected) => {
    mockSleeper({ draft: { ...DRAFT_BASE, type: given }, picks: [] })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().draftType).toBe(expected)
  })

  /*
   * An unrecognised type falls back rather than being written through: draftType drives board
   * rendering and pick-order maths, and an unknown string would render nothing — silently, on
   * a live draft.
   */
  it('falls back to snake for an unknown type rather than writing it through', async () => {
    mockSleeper({ draft: { ...DRAFT_BASE, type: 'something_new' }, picks: [] })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().draftType).toBe('snake')
  })

  it('reads third-round reversal only at reversal_round 3', async () => {
    mockSleeper({ draft: { ...DRAFT_BASE, settings: { ...DRAFT_BASE.settings, reversal_round: 3 } }, picks: [] })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().thirdRoundReversal).toBe(true)

    h.prisma.draftSession.update.mockClear()
    mockSleeper({ draft: { ...DRAFT_BASE, settings: { ...DRAFT_BASE.settings, reversal_round: 0 } }, picks: [] })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(updateData().thirdRoundReversal).toBe(false)
  })
})

describe('costs no extra provider call', () => {
  /*
   * The whole order was derivable from responses this function already read. If a future change
   * adds a fetch to get it, that is a per-draft-per-minute cost on a one-minute mirror.
   */
  it('still makes exactly three requests', async () => {
    mockSleeper({
      draft: { ...DRAFT_BASE, draft_order: { u: 1 }, slot_to_roster_id: { '1': 1 } },
      picks: [],
      users: [{ user_id: 'u', display_name: 'U' }],
    })
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(3)
  })
})
