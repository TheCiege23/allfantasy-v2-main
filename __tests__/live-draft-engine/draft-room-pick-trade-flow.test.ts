/**
 * Draft room — trading picks during a live draft, end to end through the two routes the trade panel
 * calls (`POST trade-proposals` to propose; `POST trade-proposals/[id]/respond` to accept, decline or
 * counter), against an in-memory draft session.
 *
 * What a manager sees is pinned at each step: which roster owns the pick, who is on the clock (the
 * same `resolveCurrentOnTheClock` + `applyTradedOwnerToCurrentPick` pair `buildSessionSnapshot` uses),
 * and that a pick already made cannot be traded — neither proposed nor accepted after the fact.
 *
 * 🛑 It found one product bug (2026-10-26): accepting a trade named each pick's new owner after the
 * ORIGINAL owner of the slot it was swapped for. Fine for a first trade; wrong for a pick that had
 * already been traded once — the board and the on-the-clock banner then showed a third team's name
 * against the right roster. Names now come from the proposer's and receiver's own slot entries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

import type { TradedPickRecord } from '@/lib/live-draft-engine/types'

type Slot = { slot: number; rosterId: string; displayName: string }

const db = vi.hoisted(() => ({
  session: null as null | {
    id: string; leagueId: string; status: string; draftType: string; rounds: number; teamCount: number
    thirdRoundReversal: boolean; slotOrder: Slot[]; tradedPicks: TradedPickRecord[]; version: number
    picks: { overall: number; rosterId: string; playerName: string; position: string }[]
  },
  proposals: [] as Array<Record<string, any>>,
  viewer: 'user-a',
  rosterByUser: { 'user-a': 'ra', 'user-b': 'rb', 'user-c': 'rc' } as Record<string, string>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: db.viewer } })) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async (_l: string, userId: string) => db.rosterByUser[userId] ?? null),
}))
vi.mock('@/lib/tournament-mode/safety', () => ({ isDraftPickTradingAllowedForLeague: vi.fn(async () => true) }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => ({ pickTradeEnabled: true })) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => false) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/live-draft-engine/DraftTradeAiReviewService', () => ({ buildDraftTradeAiReview: vi.fn() }))
vi.mock('@/lib/trade-ai-dm/TradeAIDMService', () => ({ sendPrivateTradeAIDM: vi.fn() }))
vi.mock('@/lib/commentary-engine', () => ({ onTradeReaction: vi.fn(async () => undefined) }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: vi.fn(), postTradeOfferToDm: vi.fn() }))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({ loadDraftPickTradeOffer: vi.fn() }))
vi.mock('@/lib/draft-notifications', () => ({
  createDraftNotification: vi.fn(),
  getAppUserIdForRoster: vi.fn(async () => null),
  notifyDraftAiTradeReviewAvailable: vi.fn(),
}))
vi.mock('@/lib/commissioner-ai-draft-manager', () => ({
  canAiProposeTrade: vi.fn(() => ({ allowed: true })),
  checkAiProposalRoundCap: vi.fn(() => ({ ok: true })),
  isRosterAiControlled: vi.fn(() => false),
  maybeAutoRespondToTradeProposal: vi.fn(),
  parseCommissionerAiManagers: vi.fn(() => ({})),
  withUpdatedProposalThrottle: vi.fn(),
  saveCommissionerAiManagers: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ name: 'L', sport: 'NFL' })) },
    draftSession: { findFirst: vi.fn(async () => (db.session ? { ...db.session, tradedPicks: [...db.session.tradedPicks] } : null)) },
    draftPickTradeProposal: {
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const row = { id: `p${db.proposals.length + 1}`, createdAt: new Date(), ...data }
        db.proposals.push(row)
        return row
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = db.proposals.find((p) => p.id === where.id)
        return row ? { ...row, session: { leagueId: db.session!.leagueId, slotOrder: db.session!.slotOrder } } : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = db.proposals.find((p) => p.id === where.id)!
        Object.assign(row, data)
        return row
      }),
    },
  },
}))
// The conditional write the real helper makes: refused (P2025) when the version moved.
vi.mock('@/lib/draft-archive/events', () => ({
  updateSessionWithArchive: vi.fn(async (_s: unknown, data: { tradedPicks: TradedPickRecord[] }, _e: unknown, _d: unknown, expected?: number) => {
    if (expected != null && expected !== db.session!.version) throw Object.assign(new Error('moved'), { code: 'P2025' })
    db.session!.tradedPicks = data.tradedPicks
    db.session!.version += 1
  }),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', async () => {
  const { resolveCurrentOnTheClock } = await import('@/lib/live-draft-engine/CurrentOnTheClockResolver')
  const { applyTradedOwnerToCurrentPick } = await import('@/lib/live-draft-engine/PickOwnershipResolver')
  const snapshot = () => {
    const s = db.session!
    const clock = resolveCurrentOnTheClock({
      totalPicks: s.rounds * s.teamCount,
      picks: s.picks.map((p) => ({ overall: p.overall, playerName: p.playerName, position: p.position, pickMetadata: null })),
      teamCount: s.teamCount,
      draftType: s.draftType as 'snake',
      thirdRoundReversal: s.thirdRoundReversal,
      slotOrder: s.slotOrder,
    })
    return { ...s, currentPick: applyTradedOwnerToCurrentPick(clock, s.slotOrder, s.tradedPicks) }
  }
  return {
    getDraftSessionByLeague: vi.fn(async () => (db.session ? { ...db.session } : null)),
    buildSessionSnapshot: vi.fn(async () => snapshot()),
  }
})

import { POST as propose } from '@/app/api/leagues/[leagueId]/draft/trade-proposals/route'
import { POST as respond } from '@/app/api/leagues/[leagueId]/draft/trade-proposals/[proposalId]/respond/route'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'

const LEAGUE = 'league-1'
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const as = (userId: string) => { db.viewer = userId }

async function offer(userId: string, body: Record<string, unknown>) {
  as(userId)
  const res = await propose(req(body), { params: Promise.resolve({ leagueId: LEAGUE }) })
  return { status: res.status, json: (await res.json()) as any }
}
async function answer(userId: string, proposalId: string, action: string) {
  as(userId)
  const res = await respond(req({ action }), { params: Promise.resolve({ leagueId: LEAGUE, proposalId }) })
  return { status: res.status, json: (await res.json()) as any }
}
const owner = (round: number, slot: number) => resolvePickOwner(round, slot, db.session!.slotOrder, db.session!.tradedPicks)
const onTheClock = async () => (await buildSessionSnapshot(LEAGUE) as any).currentPick
const makePick = (overall: number, rosterId: string) => db.session!.picks.push({ overall, rosterId, playerName: `P${overall}`, position: 'RB' })

beforeEach(() => {
  db.proposals = []
  db.session = {
    id: 'session-1', leagueId: LEAGUE, status: 'in_progress', draftType: 'snake', rounds: 3, teamCount: 3,
    thirdRoundReversal: false, version: 1, tradedPicks: [], picks: [],
    slotOrder: [
      { slot: 1, rosterId: 'ra', displayName: 'Team A' },
      { slot: 2, rosterId: 'rb', displayName: 'Team B' },
      { slot: 3, rosterId: 'rc', displayName: 'Team C' },
    ],
  }
})

describe('draft room pick trades', () => {
  it('propose: a pending offer moves nothing — A is still on the clock with its own pick', async () => {
    const { status, json } = await offer('user-a', { giveRound: 1, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rb' })
    expect(status).toBe(200)
    expect(json.proposal.status).toBe('pending')
    expect(db.session!.tradedPicks).toEqual([])
    expect((await onTheClock()).rosterId).toBe('ra')
  })

  it('accept: the picks swap rosters and the clock follows the pick to its new owner', async () => {
    const { json } = await offer('user-a', { giveRound: 1, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rb' })
    const out = await answer('user-b', json.proposal.id, 'accept')
    expect(out.status).toBe(200)
    expect(out.json.action).toBe('accepted')
    expect(db.proposals[0].status).toBe('accepted')

    expect(owner(1, 1)).toMatchObject({ rosterId: 'rb', displayName: 'Team B' })
    expect(owner(1, 2)).toMatchObject({ rosterId: 'ra', displayName: 'Team A' })
    // Pick 1.01 is now B's, so B is on the clock — the snapshot the accept returns says so too.
    expect(out.json.session.currentPick).toMatchObject({ overall: 1, rosterId: 'rb', displayName: 'Team B' })
    // ...and after it is made, 1.02 belongs to A.
    makePick(1, 'rb')
    expect(await onTheClock()).toMatchObject({ overall: 2, rosterId: 'ra', displayName: 'Team A' })
  })

  it('decline: nothing moves and the offer is closed', async () => {
    const { json } = await offer('user-a', { giveRound: 1, giveSlot: 1, receiveRound: 2, receiveSlot: 2, receiverRosterId: 'rb' })
    const out = await answer('user-b', json.proposal.id, 'reject')
    expect(out.json.action).toBe('rejected')
    expect(db.proposals[0].status).toBe('rejected')
    expect(db.session!.tradedPicks).toEqual([])
    expect((await onTheClock()).rosterId).toBe('ra')
    expect((await answer('user-b', json.proposal.id, 'accept')).status).toBe(400) // cannot accept after declining
  })

  it('counter: the original offer closes unaccepted, and the counter-offer is what moves picks', async () => {
    const { json } = await offer('user-a', { giveRound: 3, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rb' })
    const countered = await answer('user-b', json.proposal.id, 'counter')
    expect(countered.json.action).toBe('countered')
    expect(db.proposals[0].status).toBe('countered')
    expect(db.session!.tradedPicks).toEqual([])
    expect((await answer('user-b', json.proposal.id, 'accept')).status).toBe(400)

    // B's counter: its 2nd-rounder for A's 2nd-rounder instead.
    const counter = await offer('user-b', { giveRound: 2, giveSlot: 2, receiveRound: 2, receiveSlot: 1, receiverRosterId: 'ra' })
    expect(counter.status).toBe(200)
    expect((await answer('user-a', counter.json.proposal.id, 'accept')).status).toBe(200)
    expect(owner(2, 2)?.rosterId).toBe('ra')
    expect(owner(2, 1)?.rosterId).toBe('rb')
    expect(owner(1, 2)?.rosterId).toBe('rb') // the declined ask never moved
  })

  it('only the receiver can answer', async () => {
    const { json } = await offer('user-a', { giveRound: 1, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rb' })
    expect((await answer('user-a', json.proposal.id, 'accept')).status).toBe(403)
    expect((await answer('user-c', json.proposal.id, 'accept')).status).toBe(403)
    expect(db.session!.tradedPicks).toEqual([])
  })

  it('🛑 a pick already made cannot be offered', async () => {
    makePick(1, 'ra')
    const out = await offer('user-a', { giveRound: 1, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rb' })
    expect(out.status).toBe(400)
    expect(out.json.error).toMatch(/already on the board/)
    expect(db.proposals).toHaveLength(0)
  })

  it('🛑 an offer whose pick is made while it is pending is refused at accept, and nothing is written', async () => {
    const { json } = await offer('user-a', { giveRound: 1, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rb' })
    makePick(1, 'ra') // A picks before B answers
    const out = await answer('user-b', json.proposal.id, 'accept')
    expect(out.status).toBe(400)
    expect(out.json.error).toMatch(/already been made/)
    expect(db.session!.tradedPicks).toEqual([])
    expect(db.proposals[0].status).toBe('pending')
  })

  it('🛑 a re-traded pick is named after the team that now owns it, on the board and on the clock', async () => {
    // B gets A's 1st-rounder (1.01) for B's 2nd-rounder.
    const first = await offer('user-a', { giveRound: 1, giveSlot: 1, receiveRound: 2, receiveSlot: 2, receiverRosterId: 'rb' })
    await answer('user-b', first.json.proposal.id, 'accept')
    expect(owner(1, 1)).toMatchObject({ rosterId: 'rb', displayName: 'Team B' })

    // B flips that same 1.01 to C for C's 3rd-rounder.
    const second = await offer('user-b', { giveRound: 1, giveSlot: 1, receiveRound: 3, receiveSlot: 3, receiverRosterId: 'rc' })
    expect(second.status).toBe(200)
    const out = await answer('user-c', second.json.proposal.id, 'accept')
    expect(out.status).toBe(200)

    expect(owner(1, 1)).toMatchObject({ rosterId: 'rc', displayName: 'Team C' })
    expect(owner(1, 1)?.tradedPickMeta?.previousOwnerName).toBe('Team B') // B held it, not A
    // C's 3rd-rounder went to B — and must read "Team B", not "Team A" (the slot 1.01 was swapped from).
    expect(owner(3, 3)).toMatchObject({ rosterId: 'rb', displayName: 'Team B' })
    expect(out.json.session.currentPick).toMatchObject({ overall: 1, rosterId: 'rc', displayName: 'Team C' })
  })
})

describe('the client repair of a snapshot that arrived without its clock', () => {
  it('🛑 puts the traded pick on the clock for its NEW owner, as the server does', async () => {
    const { repairDraftSessionAuthority } = await import('@/lib/draft-room/mergeDraftSessionSnapshot')
    const weak = {
      ...db.session!,
      picks: [],
      currentPick: null,
      tradedPicks: [{ round: 1, originalRosterId: 'ra', previousOwnerName: 'Team A', newRosterId: 'rc', newOwnerName: 'Team C' }],
      timer: { status: 'running', remainingSeconds: 60, timerEndAt: null },
    } as any
    expect(repairDraftSessionAuthority(null, weak).currentPick).toMatchObject({ overall: 1, rosterId: 'rc', displayName: 'Team C' })
    // With no trade the slot's own owner is on the clock, exactly as before.
    expect(repairDraftSessionAuthority(null, { ...weak, tradedPicks: [] }).currentPick).toMatchObject({ rosterId: 'ra', displayName: 'Team A' })
  })
})
