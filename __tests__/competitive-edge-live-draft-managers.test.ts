import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Before your next pick" (2026-11-14): the managers on the clock ahead of you in the LIVE draft — what
 * each has taken in this draft (everyone), and their history in this league's past drafts (Competitive
 * Edge only). Facts, never labels or predictions.
 */

const db = vi.hoisted(() => ({
  draftSession: { findFirst: vi.fn() },
  draftPick: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  // The claimed team (2026-11-16): what places the viewer in a Sleeper-mirrored draft. Null by default.
  leagueTeam: { findFirst: vi.fn(async () => null) },
  userProfile: { findUnique: vi.fn(async () => null) },
}))
const viewerRoster = vi.hoisted(() => vi.fn())
const coreDepth = vi.hoisted(() => vi.fn())
const historyPicks = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: viewerRoster }))
vi.mock('@/lib/core-app/corePaywall', () => ({ resolveCoreDepth: coreDepth }))
vi.mock('@/lib/competitive-edge/draftEdgeLoader', () => ({ loadDraftHistoryPicks: historyPicks }))

import { historyLines, managersBeforeNextPick, parseSlotOrder, thisDraftFact } from '@/lib/competitive-edge/liveDraftManagersFacts'
import { loadManagersAhead } from '@/lib/competitive-edge/liveDraftManagers'

describe('the pure rules', () => {
  it('parses the slot order, keeping a platformUserId and dropping malformed entries', () => {
    expect(parseSlotOrder([{ slot: 1, rosterId: 'r1', displayName: 'Ann', platformUserId: 'su1' }, { slot: 'x' }, null, { slot: 2, rosterId: 'r2' }])).toEqual([
      { slot: 1, rosterId: 'r1', displayName: 'Ann', platformUserId: 'su1' },
      { slot: 2, rosterId: 'r2', displayName: 'r2' },
    ])
  })

  it('lists the managers before the viewer’s slot comes up again, in order, each once', () => {
    const order = [
      { slot: 5, rosterId: 'a', displayName: 'A' },
      { slot: 6, rosterId: 'b', displayName: 'B' },
      { slot: 6, rosterId: 'b', displayName: 'B' }, // the snake turn: B picks twice in a row
      { slot: 5, rosterId: 'a', displayName: 'A' },
      { slot: 3, rosterId: 'me', displayName: 'Me' },
      { slot: 2, rosterId: 'c', displayName: 'C' },
    ]
    expect(managersBeforeNextPick(order, 3).map((o) => o.displayName)).toEqual(['A', 'B'])
    expect(managersBeforeNextPick(order, 5)).toEqual([]) // on the clock now
  })

  it('states what a manager has taken — facts, and the core positions still missing', () => {
    expect(thisDraftFact(['rb', 'RB', 'WR'])).toBe('This draft: RB, RB, WR (3 picks) — no QB or TE yet.')
    expect(thisDraftFact(['QB', 'RB', 'WR', 'TE'])).toBe('This draft: QB, RB, WR, TE (4 picks).')
    expect(thisDraftFact([])).toBe("Hasn't picked yet in this draft.")
  })

  it('🛑 never labels a manager or predicts a pick', () => {
    const texts = [thisDraftFact(['RB', 'RB', 'RB']), thisDraftFact(['QB'])]
    for (const t of texts) expect(t).not.toMatch(/heavy|will|likely|expect|probably|tends|style|zero[- ]rb|aggressive|panic/i)
  })

  it('shows history patterns only with enough drafts, otherwise only the record', () => {
    const facts = [
      { key: 'draft.record', text: 'Ann drafted in 3 of the 3 drafts on file (2023–2025), 45 picks in all.' },
      { key: 'draft.first_round.RB', text: 'Their first-round pick was at RB in 2 of their 3 drafts.' },
      { key: 'draft.qb_early', text: 'They took a QB in rounds 1–3 in 1 of their 3 drafts.' },
    ]
    expect(historyLines({ facts, sufficient: true })).toEqual([facts[1]!.text, facts[2]!.text])
    expect(historyLines({ facts: [facts[0]!], sufficient: false })).toEqual([`${facts[0]!.text} Not enough drafts to show a pattern.`])
  })
})

describe('loadManagersAhead', () => {
  const SESSION = {
    id: 's1',
    status: 'in_progress',
    draftType: 'snake',
    teamCount: 4,
    rounds: 10,
    thirdRoundReversal: false,
    nextOverallPick: 6, // round 2, pick 2 of a snake: slots 3, 2, 1 then 1, 2, …
    slotOrder: [
      { slot: 1, rosterId: 'r1', displayName: 'Me' },
      { slot: 2, rosterId: 'r2', displayName: 'Bea', platformUserId: 'su2' },
      { slot: 3, rosterId: 'r3', displayName: 'Cal' },
      { slot: 4, rosterId: 'r4', displayName: 'Dee' },
    ],
  }
  const PAST = [
    { season: 2024, round: 1, position: 'RB', ownerSleeperId: 'su2' },
    { season: 2025, round: 1, position: 'RB', ownerSleeperId: 'su2' },
    { season: 2025, round: 2, position: 'QB', ownerSleeperId: 'su2' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    db.draftSession.findFirst.mockResolvedValue(SESSION)
    viewerRoster.mockResolvedValue('r1')
    db.draftPick.findMany.mockResolvedValue([
      { slot: 2, position: 'RB', overall: 2 },
      { slot: 3, position: 'WR', overall: 3 },
    ])
    db.roster.findMany.mockResolvedValue([])
    historyPicks.mockResolvedValue(PAST)
  })

  it('the managers before your next pick, with this draft’s picks — and no history without Competitive Edge', async () => {
    coreDepth.mockResolvedValue({ unlocked: false })
    const out = await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })
    // Round 2 of a 4-team snake reverses: pick 6 is slot 3, pick 7 slot 2, pick 8 slot 1 (the viewer).
    expect(out?.managers.map((m) => m.name)).toEqual(['Cal', 'Bea'])
    expect(out?.managers[0]!.thisDraft).toBe('This draft: WR (1 pick) — no QB or RB or TE yet.')
    expect(out?.history).toBe('locked')
    expect(out?.managers.every((m) => m.history.length === 0)).toBe(true)
    // 🛑 locked means the history is never even read.
    expect(historyPicks).not.toHaveBeenCalled()
  })

  it('with Competitive Edge: history for a manager the slot order names, none for one it cannot place', async () => {
    coreDepth.mockResolvedValue({ unlocked: true })
    const out = await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })
    expect(out?.history).toBe('shown')
    const bea = out!.managers.find((m) => m.name === 'Bea')!
    expect(bea.history.join(' ')).toContain('Their first-round pick was at RB in 2 of their 2 drafts.')
    // Cal's slot carries no platformUserId and no AF roster maps it: no line, never a guess.
    expect(out!.managers.find((m) => m.name === 'Cal')!.history).toEqual([])
  })

  it('falls back to the AF roster’s platformUserId to place a manager', async () => {
    coreDepth.mockResolvedValue({ unlocked: true })
    db.roster.findMany.mockResolvedValue([{ id: 'r3', platformUserId: 'su2' }])
    const out = await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })
    expect(out!.managers.find((m) => m.name === 'Cal')!.history.length).toBeGreaterThan(0)
  })

  /*
   * 🛑 THE DRAFT ROOM'S PANEL WAS EMPTY ON EVERY SLEEPER DRAFT. A mirrored slot order holds Sleeper's
   * roster NUMBER, never the AF Roster.id, and the room calls this with no slot of its own
   * (/api/leagues/[leagueId]/draft/decision). The claimed team's externalId is that number.
   */
  it('places the viewer in a Sleeper-mirrored draft by their claimed team, with no slot passed in', async () => {
    coreDepth.mockResolvedValue({ unlocked: false })
    db.draftSession.findFirst.mockResolvedValue({
      ...SESSION,
      sleeperDraftId: 'sleeper-1',
      slotOrder: SESSION.slotOrder.map((e) => ({ ...e, rosterId: String(e.slot) })),
    })
    viewerRoster.mockResolvedValue('af-roster-not-in-slot-order')
    expect(await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })).toBeNull()

    db.leagueTeam.findFirst.mockResolvedValueOnce({ externalId: '1', platformUserId: 'sleeper-me' } as never)
    const out = await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })
    expect(out?.managers.map((m) => m.name)).toEqual(['Cal', 'Bea'])
    expect(db.leagueTeam.findFirst).toHaveBeenCalledWith({ where: { leagueId: 'lg', claimedByUserId: 'u1' }, select: { externalId: true, platformUserId: true } })
  })

  it('nothing for an auction, a finished draft, or a viewer with no slot', async () => {
    db.draftSession.findFirst.mockResolvedValueOnce({ ...SESSION, draftType: 'auction' })
    expect(await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })).toBeNull()
    db.draftSession.findFirst.mockResolvedValueOnce({ ...SESSION, status: 'completed' })
    expect(await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })).toBeNull()
    viewerRoster.mockResolvedValueOnce('someone-else')
    expect(await loadManagersAhead({ leagueId: 'lg', userId: 'u1' })).toBeNull()
  })
})
