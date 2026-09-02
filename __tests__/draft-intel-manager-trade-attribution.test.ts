import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Manager trade counts in the live draft intel were read out of the wrong id space.
 *
 * 🛑 THE DEFECT. `acquired` / `shipped` are built from `/draft/{id}/traded_picks`, whose
 * `owner_id` and `previous_owner_id` are ROSTER ids — verified against real leagues by this
 * repo's own fidelity audit and written down in `lib/league-import/adapters/sleeper/types.ts`:
 * "all Sleeper integer roster IDs (1..total_rosters), NOT user IDs." The service looked them
 * up with a DRAFT SLOT, justified by a comment claiming "roster_id ↔ user mapping isn't in the
 * draft object". It is — `slot_to_roster_id` rides on the same `/draft/{id}` response the
 * function already fetches; it was simply never declared on the wire type.
 *
 * ⚠ AND IT NEVER FAILED LOUDLY. Slots and roster ids are BOTH integers in 1..N, so the lookup
 * always returned a number — just some other manager's. The bug only disappears in leagues
 * that happen to have drafted in roster order, which is why it survived.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league-context/leagueContextService', () => ({ getLeagueContext: vi.fn(async () => null) }))
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({
  getSeasonBoard: vi.fn(async () => null),
  adpFor: vi.fn(() => null),
  isIdp: vi.fn(() => false),
  isRookie: vi.fn(() => false),
}))
vi.mock('@/lib/trade-intel/marketValueService', () => ({
  getMarketValues: vi.fn(async () => null),
  playerValue: vi.fn(() => null),
}))

import { getDraftIntel } from '@/lib/draft-intel/sleeperDraftIntelService'

type Json = Record<string, unknown> | unknown[]

function mockSleeper(opts: { draft: Json; picks: Json; tradedPicks: Json; users: Json }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const url = String(input)
    const body = url.includes('/traded_picks')
      ? opts.tradedPicks
      : url.includes('/picks')
        ? opts.picks
        : url.includes('/league/')
          ? opts.users
          : opts.draft
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  })
}

/*
 * The whole point of the fixture: SLOT AND ROSTER ID DELIBERATELY DISAGREE.
 *
 *   alice  slot 1  roster 7
 *   bob    slot 2  roster 4
 *
 * The traded pick was acquired by roster 7 (Alice). Read with the slot instead, roster 7 is
 * nobody's slot, and roster 4 would be read for Alice's slot-1 lookup only if a pick existed
 * there — so the old code reports 0 for Alice and can report Alice's pick against Bob.
 */
const DRAFT = {
  draft_id: 'd1',
  league_id: 'L1',
  status: 'drafting',
  type: 'snake',
  season: '2026',
  settings: { teams: 2, rounds: 2 },
  draft_order: { u_alice: 1, u_bob: 2 },
  slot_to_roster_id: { '1': 7, '2': 4 },
}
const USERS = [
  { user_id: 'u_alice', display_name: 'Alice' },
  { user_id: 'u_bob', display_name: 'Bob' },
]
const PICKS = [
  { round: 1, pick_no: 1, draft_slot: 1, picked_by: 'u_alice', player_id: 'p1', metadata: { position: 'RB' } },
  { round: 1, pick_no: 2, draft_slot: 2, picked_by: 'u_bob', player_id: 'p2', metadata: { position: 'WR' } },
]
/** Roster 7 (Alice) acquired a pick from roster 4 (Bob). */
const TRADED = [{ round: 2, season: '2026', roster_id: 4, owner_id: 7, previous_owner_id: 4 }]

function managerNamed(payload: { managers: { name: string }[] } | null, name: string) {
  return payload?.managers.find((m) => m.name === name)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('manager trade counts are read in the roster id space', () => {
  it('credits the acquired pick to the manager who actually holds it', async () => {
    mockSleeper({ draft: DRAFT, picks: PICKS, tradedPicks: TRADED, users: USERS })
    const payload = await getDraftIntel('d1', null)

    /* Roster 7 is Alice, via slot 1. Reading the map with her SLOT (1) finds nothing. */
    expect(managerNamed(payload as never, 'Alice')?.extraPicksAcquired).toBe(1)
    expect(managerNamed(payload as never, 'Alice')?.picksTradedAway).toBe(0)
  })

  it('charges the shipped pick to the manager who actually gave it up', async () => {
    mockSleeper({ draft: DRAFT, picks: PICKS, tradedPicks: TRADED, users: USERS })
    const payload = await getDraftIntel('d1', null)

    /* Roster 4 is Bob, via slot 2. The old slot-keyed read would have charged this to
       whoever sat in slot 4 — in a 2-team fixture, nobody. */
    expect(managerNamed(payload as never, 'Bob')?.picksTradedAway).toBe(1)
    expect(managerNamed(payload as never, 'Bob')?.extraPicksAcquired).toBe(0)
  })

  /*
   * ⚠ THE CASE THAT HID THE BUG. When every team's slot equals its roster id the two id spaces
   * coincide and the old code was right by accident. Pinned so a future "simplification" back
   * to the slot lookup cannot pass on this fixture alone.
   */
  it('still agrees when slot and roster id happen to coincide', async () => {
    mockSleeper({
      draft: { ...DRAFT, slot_to_roster_id: { '1': 1, '2': 2 } },
      picks: PICKS,
      tradedPicks: [{ round: 2, season: '2026', roster_id: 2, owner_id: 1, previous_owner_id: 2 }],
      users: USERS,
    })
    const payload = await getDraftIntel('d1', null)
    expect(managerNamed(payload as never, 'Alice')?.extraPicksAcquired).toBe(1)
    expect(managerNamed(payload as never, 'Bob')?.picksTradedAway).toBe(1)
  })

  /*
   * Sleeper leaves `draft_order` null until the commissioner sets it, and an older draft object
   * may carry no `slot_to_roster_id`. Reporting 0 is what the code did before and is still
   * right: an unknown count is better than a guessed one.
   */
  it('reports zero rather than guessing when no mapping is published', async () => {
    mockSleeper({
      draft: { ...DRAFT, draft_order: null, slot_to_roster_id: null },
      picks: PICKS,
      tradedPicks: TRADED,
      users: USERS,
    })
    const payload = await getDraftIntel('d1', null)
    for (const name of ['Alice', 'Bob']) {
      expect(managerNamed(payload as never, name)?.extraPicksAcquired).toBe(0)
      expect(managerNamed(payload as never, name)?.picksTradedAway).toBe(0)
    }
  })

  it('reports zero when the order is published but the roster map is not', async () => {
    mockSleeper({
      draft: { ...DRAFT, slot_to_roster_id: null },
      picks: PICKS,
      tradedPicks: TRADED,
      users: USERS,
    })
    const payload = await getDraftIntel('d1', null)
    expect(managerNamed(payload as never, 'Alice')?.extraPicksAcquired).toBe(0)
  })
})
