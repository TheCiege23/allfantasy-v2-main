// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

/*
 * Competitive Edge for a draft (lib/competitive-edge/draftEdge.ts) and the owner it depends on:
 * who owned the drafting team that season, recorded by the Sleeper sync
 * (lib/league-import/sleeper/sleeperDraftPickIdentity.ts) and back-filled for seasons imported before
 * it existed (lib/league-import/sleeper/draftOwnerBackfill.ts).
 */

import { buildDraftEdge, DRAFT_FLOOR, type EdgeDraftPick } from '@/lib/competitive-edge/draftEdge'
import { normalizePickNumber, sleeperOwnerByRosterId, sleeperPickOwnerId } from '@/lib/league-import/sleeper/sleeperDraftPickIdentity'
import {
  backfillLeagueDraftOwners,
  planDraftOwnerBackfill,
  type DraftOwnerBackfillDeps,
  type ExistingDraftFact,
} from '@/lib/league-import/sleeper/draftOwnerBackfill'

const pick = (ownerSleeperId: string, season: number, round: number, position: string | null): EdgeDraftPick => ({
  ownerSleeperId,
  season,
  round,
  position,
})

const MANAGERS = [
  { ownerSleeperId: 'sl-you', name: 'You', teamExternalId: '1' },
  { ownerSleeperId: 'sl-tasha', name: 'Tasha', teamExternalId: '2' },
  { ownerSleeperId: 'sl-mike', name: 'Mike', teamExternalId: '3' },
  { ownerSleeperId: 'sl-new', name: 'Newbie', teamExternalId: '4' },
]

const PICKS: EdgeDraftPick[] = [
  // Tasha: three drafts.
  pick('sl-tasha', 2023, 1, 'RB'), pick('sl-tasha', 2023, 2, 'WR'), pick('sl-tasha', 2023, 3, 'RB'),
  pick('sl-tasha', 2024, 1, 'RB'), pick('sl-tasha', 2024, 2, 'QB'), pick('sl-tasha', 2024, 3, 'WR'),
  pick('sl-tasha', 2025, 1, 'WR'), pick('sl-tasha', 2025, 2, 'RB'), pick('sl-tasha', 2025, 3, 'TE'),
  // Mike: one draft — below the floor.
  pick('sl-mike', 2025, 1, 'QB'), pick('sl-mike', 2025, 2, 'RB'), pick('sl-mike', 2025, 3, 'RB'),
  // You: never a rival.
  pick('sl-you', 2024, 1, 'RB'), pick('sl-you', 2025, 1, 'RB'),
  // A manager who has since LEFT, and whose slot Mike now holds. Must never be credited to Mike.
  pick('sl-gone', 2023, 1, 'QB'), pick('sl-gone', 2023, 2, 'QB'), pick('sl-gone', 2024, 1, 'QB'),
]

const build = (picks = PICKS, unattributedSeasons: number[] = []) =>
  buildDraftEdge({ picks, managers: MANAGERS, viewerOwnerSleeperId: 'sl-you', unattributedSeasons })

const factsOf = (name: string, edge = build()) => edge.rivals.find((r) => r.manager.name === name)!.facts.map((f) => f.text)

describe('buildDraftEdge', () => {
  it('counts a rival’s drafts, first-round position, early rounds and QB timing', () => {
    expect(factsOf('Tasha')).toEqual([
      'Tasha drafted in 3 of the 3 drafts on file (2023–2025), 9 picks in all.',
      'Their first-round pick was at RB in 2 of their 3 drafts.',
      'In rounds 1–3, 4 of their 9 picks were RBs.',
      'They took a QB in rounds 1–3 in 1 of their 3 drafts.',
    ])
  })

  it(`🛑 below ${DRAFT_FLOOR} drafts it states the record and NO pattern — one draft is an anecdote`, () => {
    const mike = build().rivals.find((r) => r.manager.name === 'Mike')!
    expect(mike.sufficient).toBe(false)
    expect(mike.facts.map((f) => f.text)).toEqual(['Mike drafted in 1 of the 3 drafts on file (2025), 3 picks in all.'])
  })

  it('🛑 credits a pick to the PERSON who made it: a departed manager’s picks go to nobody, not to the slot’s new holder', () => {
    const mike = build().rivals.find((r) => r.manager.name === 'Mike')!
    expect(mike.picks).toBe(3)
    expect(mike.drafts).toBe(1)
    expect(build().rivals.map((r) => r.manager.name)).not.toContain('sl-gone')
  })

  it('leaves you out, and puts the longest records first', () => {
    expect(build().rivals.map((r) => r.manager.name)).toEqual(['Tasha', 'Mike', 'Newbie'])
  })

  it('a manager with no picks on file says so, rather than reading as a quiet drafter', () => {
    expect(factsOf('Newbie')).toEqual(["Newbie has no picks on file in this league's drafts."])
  })

  it('says a QB was never taken early only when they took one at all', () => {
    const late = [
      pick('sl-tasha', 2024, 1, 'RB'), pick('sl-tasha', 2024, 9, 'QB'),
      pick('sl-tasha', 2025, 1, 'WR'), pick('sl-tasha', 2025, 2, 'RB'), pick('sl-tasha', 2025, 3, 'WR'),
    ]
    expect(factsOf('Tasha', build(late))).toContain("They haven't taken a QB in rounds 1–3 in any of their 2 drafts.")
    const none = late.filter((p) => p.position !== 'QB')
    expect(factsOf('Tasha', build(none)).some((t) => t.includes('QB'))).toBe(false)
  })

  it('a pick with no known position counts toward the record and no position fact', () => {
    const blind = [pick('sl-tasha', 2024, 1, null), pick('sl-tasha', 2025, 1, 'PICK')]
    expect(factsOf('Tasha', build(blind))).toEqual(['Tasha drafted in 2 of the 2 drafts on file (2024–2025), 2 picks in all.'])
  })

  it('🛑 facts, never labels or predictions', () => {
    const all = build().rivals.flatMap((r) => r.facts.map((f) => f.text)).join(' ')
    expect(all).not.toMatch(/\b(heavy|zero[- ]rb|will|likely|expect|tends?|always|never|probably)\b/i)
    expect(build().rivals.flatMap((r) => r.facts).every((f) => f.bearsOnDeal === false)).toBe(true)
  })

  it('names the drafts it read and the ones it could not attribute', () => {
    expect(build(PICKS, [2022, 2025, 2022]).coverage).toEqual({
      source: 'sleeper_draft_history',
      seasons: [2023, 2024, 2025],
      unattributedSeasons: [2022, 2025],
    })
  })
})

describe('🛑 the pick’s owner — who owned the team THAT season', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'sl-a' },
    { roster_id: 2, owner_id: 'sl-b' },
    { roster_id: 3, owner_id: null }, // an orphaned team that season
  ]

  it('reads it from that season’s rosters', () => {
    const owners = sleeperOwnerByRosterId(rosters)
    expect(sleeperPickOwnerId({ roster_id: 2, picked_by: 'sl-commish' }, owners)).toBe('sl-b')
    expect(sleeperPickOwnerId({ roster_id: '1' }, owners)).toBe('sl-a')
  })

  it('🛑 never falls back to `picked_by` — in a commissioner-entered draft that is one person on every pick', () => {
    const owners = sleeperOwnerByRosterId(rosters)
    expect(sleeperPickOwnerId({ roster_id: 3, picked_by: 'sl-commish' }, owners)).toBeNull()
    expect(sleeperPickOwnerId({ roster_id: 1, picked_by: 'sl-commish' }, sleeperOwnerByRosterId(null))).toBeNull()
  })
})

describe('planDraftOwnerBackfill', () => {
  const source = {
    season: 2024,
    rosters: [
      { roster_id: 1, owner_id: 'sl-a' },
      { roster_id: 2, owner_id: 'sl-b' },
    ],
    drafts: [
      {
        draftId: 'd-2024',
        picks: [
          { player_id: 'p1', round: 1, pick_no: 1, roster_id: 1 },
          { player_id: 'p2', round: 1, pick_no: 2, roster_id: 2 },
          // No pick_no: derived exactly as the sync derives it.
          { player_id: 'p3', round: 2, draft_slot: 1, draft_slot_count: 2, roster_id: 2 },
        ],
      },
    ],
  }
  const row = (draftId: string, round: number, pickNumber: number, playerId: string, metadata: unknown = null, season = 2024): ExistingDraftFact => ({
    draftId,
    season,
    round,
    pickNumber,
    playerId,
    metadata,
  })

  it('matches each ownerless row to its Sleeper pick on season, round, pick number and player', () => {
    expect(normalizePickNumber(source.drafts[0]!.picks[2], 99)).toBe(3)
    const plan = planDraftOwnerBackfill([row('r1', 1, 1, 'p1'), row('r2', 1, 2, 'p2'), row('r3', 2, 3, 'p3')], [source])
    expect(plan.updates).toEqual([
      { draftId: 'r1', ownerSleeperId: 'sl-a' },
      { draftId: 'r2', ownerSleeperId: 'sl-b' },
      { draftId: 'r3', ownerSleeperId: 'sl-b' },
    ])
    expect(plan).toMatchObject({ alreadyOwned: 0, unmatched: 0, ownerUnknown: 0 })
  })

  it('🛑 leaves a row that already has an owner alone, and never guesses at one it cannot match', () => {
    const plan = planDraftOwnerBackfill(
      [row('r1', 1, 1, 'p1', { ownerSleeperId: 'sl-kept' }), row('r9', 1, 2, 'p-other'), row('r8', 1, 1, 'p1', null, 2023)],
      [source],
    )
    expect(plan.updates).toEqual([])
    expect(plan).toMatchObject({ alreadyOwned: 1, unmatched: 2 })
  })

  it('🛑 two drafts in one season that share a pick and player but not an owner: neither is filled', () => {
    const twin = { ...source, drafts: [...source.drafts, { draftId: 'd-2024b', picks: [{ player_id: 'p1', round: 1, pick_no: 1, roster_id: 2 }] }] }
    const plan = planDraftOwnerBackfill([row('r1', 1, 1, 'p1')], [twin])
    expect(plan.updates).toEqual([])
    expect(plan.unmatched).toBe(1)
  })

  it('a pick whose roster has no owner that season is counted, not filled', () => {
    const orphan = { ...source, rosters: [{ roster_id: 1, owner_id: 'sl-a' }] }
    const plan = planDraftOwnerBackfill([row('r2', 1, 2, 'p2')], [orphan])
    expect(plan.updates).toEqual([])
    expect(plan.ownerUnknown).toBe(2)
  })
})

describe('backfillLeagueDraftOwners', () => {
  const deps = (existing: ExistingDraftFact[]): DraftOwnerBackfillDeps & Record<string, ReturnType<typeof vi.fn>> => ({
    chain: vi.fn(async () => [
      { externalLeagueId: 'sl-2025', season: 2025 },
      { externalLeagueId: 'sl-2024', season: 2024 },
    ]),
    rosters: vi.fn(async (id: string) => [{ roster_id: 1, owner_id: id === 'sl-2024' ? 'sl-a' : 'sl-z' }]),
    drafts: vi.fn(async (id: string) => [{ draft_id: `d-${id}` }]),
    picks: vi.fn(async () => [{ player_id: 'p1', round: 1, pick_no: 1, roster_id: 1 }]),
    existing: vi.fn(async () => existing),
    write: vi.fn(async (u: unknown[]) => u.length),
  })
  const league = { id: 'lg-1', platformLeagueId: 'sl-2025' }
  const ownerless = { draftId: 'r1', season: 2024, round: 1, pickNumber: 1, playerId: 'p1', metadata: null }
  const owned = { draftId: 'r2', season: 2025, round: 1, pickNumber: 1, playerId: 'p1', metadata: { ownerSleeperId: 'sl-z' } }

  it('🛑 reads Sleeper ONLY for seasons that still have a pick without an owner', async () => {
    const d = deps([ownerless, owned])
    const res = await backfillLeagueDraftOwners(d, league, { apply: false })
    expect(res.seasonsRead).toEqual([2024])
    expect(d.rosters).toHaveBeenCalledTimes(1)
    expect(d.rosters).toHaveBeenCalledWith('sl-2024')
    expect(res.updates).toEqual([{ draftId: 'r1', ownerSleeperId: 'sl-a' }])
  })

  it('🛑 a dry run writes nothing', async () => {
    const d = deps([ownerless])
    const res = await backfillLeagueDraftOwners(d, league, { apply: false })
    expect(d.write).not.toHaveBeenCalled()
    expect(res.written).toBe(0)
  })

  it('--apply writes the planned owners', async () => {
    const d = deps([ownerless])
    const res = await backfillLeagueDraftOwners(d, league, { apply: true })
    expect(d.write).toHaveBeenCalledWith([{ draftId: 'r1', ownerSleeperId: 'sl-a' }])
    expect(res.written).toBe(1)
  })

  it('a league already filled costs one database read and no provider calls', async () => {
    const d = deps([owned])
    const res = await backfillLeagueDraftOwners(d, league, { apply: true })
    expect(d.chain).not.toHaveBeenCalled()
    expect(d.write).not.toHaveBeenCalled()
    expect(res).toMatchObject({ seasonsRead: [], alreadyOwned: 1, written: 0 })
  })
})
