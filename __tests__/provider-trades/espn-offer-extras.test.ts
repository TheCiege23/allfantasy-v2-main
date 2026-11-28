/**
 * ESPN offer extras (owner ask 2026-11-28), against the owner's committed capture
 * `contracts/espn/fixtures/fantasy-pending.NFL.2026.json`. No network: every read is a dep.
 *
 *   (a) accept / decline / counter — plumbing only, REFUSED: no ESPN write is captured (GAPS.md T-03e).
 *   (b) the offer email + notice, once per manager it waits on; the DM card only between two claimed teams.
 *   (c) lineup impact through the canonical evaluator, ESPN ids → Sleeper ids; unresolved = not computed.
 *
 * The real offer: team 7 gives Michael Wilson to team 2, gets Puka Nacua, drops Marvin Harrison Jr.;
 * team 7 has accepted, so it waits on team 2.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-import/espn/EspnLeagueFetchService', () => ({ fetchEspnPendingTradeOffersForSync: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { getServerSession } from 'next-auth'
import { parseEspnPendingOffersForTeam } from '@/lib/provider-trades/espnTradeOffers'
import { buildEspnOfferViews, type EspnLedgerRow } from '@/lib/provider-trades/espnOfferView'
import { syncEspnTradeOffersForLeague, type EspnOfferSyncDeps } from '@/lib/provider-trades/syncEspnTradeOffers'
import {
  notifyNewEspnOffers,
  partyUsersFromRows,
  postEspnOfferDms,
  type EspnNotifyDeps,
  type EspnPartyUser,
} from '@/lib/provider-trades/notifyEspnOffers'
import { espnOfferLineupImpacts, ESPN_UNRESOLVED_LINEUP_REASON } from '@/lib/provider-trades/espnOfferLineupImpact'
import {
  ESPN_OFFER_ACTION_UNAVAILABLE_MESSAGE,
  espnOfferActionsAvailable,
  espnOfferActionsFor,
  espnOfferStatusAfter,
  performEspnOfferAction,
} from '@/lib/provider-trades/espnOfferActions'
import { lineupImpactLine, type LineupImpactSummary } from '@/lib/decision-os/trade/rosterImpactSummary'
import { buildPendingTradeOfferEmail } from '@/lib/trade-intel/tradeGradeEmail'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { ResolvedTradePlayer } from '@/lib/decision-os/trade/tradePlayers'
import type { NormalizedOffer } from '@/lib/provider-trades/providerTradeOfferLedger'
import { POST as actionRoute } from '@/app/api/league/espn-trade-offers/action/route'

const FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../contracts/espn/fixtures/fantasy-pending.NFL.2026.json'), 'utf8'),
) as { requests: Array<{ resource: string; body: Record<string, unknown> }> }
const PENDING_BODY = FIXTURE.requests.find((r) => r.resource === 'pending_transactions_candidate')!.body

const OFFER_ID = '54a04003-243c-4a89-a969-e89ef55dffad'
const WILSON = '4360761'
const NACUA = '4426515'
const MHJ = '4432708'
const NOW = new Date('2026-11-27T20:00:00.000Z')
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const found = new Map<string, ResolvedTradePlayer>([
  [WILSON, { ok: true, name: 'Michael Wilson', position: 'WR', sleeperId: '9997' }],
  [NACUA, { ok: true, name: 'Puka Nacua', position: 'WR', sleeperId: '9493' }],
  [MHJ, { ok: true, name: 'Marvin Harrison Jr.', position: 'WR', sleeperId: '11632' }],
])

const realOffer = () => parseEspnPendingOffersForTeam(PENDING_BODY, '7').offers[0]!

/** A synthetic offer between two OTHER teams (3 ↔ 5). */
function thirdPartyOffer(): NormalizedOffer {
  const o = realOffer()
  return {
    ...o,
    providerTradeId: '00000000-0000-4000-8000-000000000035',
    proposedByRosterId: '3',
    rosterIds: ['3', '5'],
    consentedRosterIds: ['3'],
    assets: [
      { ...o.assets[0]!, playerId: '111', fromRosterId: '3', toRosterId: '5' },
      { ...o.assets[0]!, playerId: '222', fromRosterId: '5', toRosterId: '3' },
    ],
  }
}

const row = (o: NormalizedOffer): EspnLedgerRow => ({
  providerTradeId: o.providerTradeId,
  status: o.status,
  proposedByRosterId: o.proposedByRosterId,
  rosterIds: o.rosterIds,
  consentedRosterIds: o.consentedRosterIds,
  proposedAt: o.proposedAt,
  firstSeenAt: NOW,
  expiresAt: o.expiresAt ?? null,
  assets: o.assets,
})

const fakeGrader = {
  grade: async () => ({ graded: true, letter: 'B', giveValue: 3000, getValue: 3600, label: 'Good', lines: [], percentDiff: 20, recommendation: 'Take it.' }),
} as unknown as LeagueTradeGrader

/** Two AllFantasy users: user-2 imported the league and claimed team 2; user-7 imported it again and claimed team 7. */
const ROW_2 = { id: 'row-2', userId: 'user-2', platformLeagueId: '123456', season: 2026, name: 'Fixture League' }
const ROW_7 = { id: 'row-7', userId: 'user-7', platformLeagueId: '123456', season: 2026, name: 'Fixture League (7)' }
const BOTH_CLAIMED: EspnPartyUser[] = [
  { userId: 'user-2', teamId: '2', rowId: 'row-2', rowName: 'Fixture League', teamName: 'Fixture Team 2' },
  { userId: 'user-7', teamId: '7', rowId: 'row-7', rowName: 'Fixture League (7)', teamName: 'Fixture Team 7' },
]

function notifyDeps(over: Partial<EspnNotifyDeps> & { party?: EspnPartyUser[]; emailsOff?: string[] } = {}) {
  const claims = new Set<string>()
  const d: EspnNotifyDeps = {
    partyUsers: vi.fn(async (_lid: string, teamIds: string[]) => (over.party ?? BOTH_CLAIMED).filter((p) => teamIds.includes(p.teamId))),
    views: vi.fn(async ({ rows, viewerTeamId }) => buildEspnOfferViews({ rows, viewerTeamId, found, teamNameOf: (t) => `Fixture Team ${t}` })),
    grader: vi.fn(async () => fakeGrader),
    claim: vi.fn(async (key: string) => {
      if (claims.has(key)) return false
      claims.add(key)
      return true
    }),
    emailContext: vi.fn(async (userId: string) => ({ email: `${userId}@example.test`, tradeEmailsOff: (over.emailsOff ?? []).includes(userId) })),
    dispatch: vi.fn(async () => ({})),
    postDm: vi.fn(async () => ({ posted: true, threadId: 't', messageId: 'm' })),
    baseUrl: () => 'https://app.test',
    unsubscribeUrl: (email: string) => `https://app.test/unsub?e=${encodeURIComponent(email)}`,
    ...over,
  }
  return d
}

type DispatchCall = { userIds: string[]; category: string; actionHref: string; skipChannels?: { email?: boolean }; emailOverride?: { subject: string; html: string } }
const dispatched = (d: EspnNotifyDeps) => (d.dispatch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as DispatchCall)

// ── (b) Email + notice ──────────────────────────────────────────────────────────────────────────

describe('(b) the offer email — once, to the manager it waits on, never the proposer', () => {
  beforeEach(() => vi.clearAllMocks())

  it("team 2's sweep emails user-2 once, with the designed ESPN offer email, linked to their own row", async () => {
    const d = notifyDeps()
    const n = await notifyNewEspnOffers({ league: ROW_2, viewerTeamId: '2', offers: [realOffer()], now: NOW }, d)
    expect(n).toBe(1)
    const [call] = dispatched(d)
    expect(call!.userIds).toEqual(['user-2'])
    expect(call!.category).toBe('trade_proposals')
    expect(call!.actionHref).toBe('/league/row-2?view=trades')
    expect(call!.skipChannels?.email).toBeUndefined()
    expect(call!.emailOverride!.subject).toContain('Trade offer in Fixture League')
    expect(call!.emailOverride!.html).toContain('Answer it in ESPN')
    expect(call!.emailOverride!.html).toContain('fantasy.espn.com/football/league?leagueId=123456')
    expect(call!.emailOverride!.html).toContain('Marvin Harrison Jr.')
    expect(call!.emailOverride!.html).not.toContain('Sleeper')

    // Second sweep of the same offer: the claim is taken, nothing more is sent.
    expect(await notifyNewEspnOffers({ league: ROW_2, viewerTeamId: '2', offers: [realOffer()], now: NOW }, d)).toBe(0)
    expect(dispatched(d)).toHaveLength(1)
  })

  it("the PROPOSER's sweep (team 7) tells user-2 — on user-2's own row — and never user-7; both sweeps together send exactly one", async () => {
    const d = notifyDeps()
    await notifyNewEspnOffers({ league: ROW_7, viewerTeamId: '7', offers: [realOffer()], now: NOW }, d)
    await notifyNewEspnOffers({ league: ROW_2, viewerTeamId: '2', offers: [realOffer()], now: NOW }, d)
    const calls = dispatched(d)
    expect(calls.map((c) => c.userIds)).toEqual([['user-2']])
    expect(calls[0]!.actionHref).toBe('/league/row-2?view=trades')
  })

  it('a user who turned trade emails off still gets the bell/push, but no email', async () => {
    const d = notifyDeps({ emailsOff: ['user-2'] })
    await notifyNewEspnOffers({ league: ROW_2, viewerTeamId: '2', offers: [realOffer()], now: NOW }, d)
    const [call] = dispatched(d)
    expect(call!.skipChannels?.email).toBe(true)
    expect(call!.emailOverride).toBeUndefined()
  })

  it('🛑 an offer between two OTHER teams is announced to nobody', async () => {
    const d = notifyDeps({ party: [...BOTH_CLAIMED, { userId: 'user-3', teamId: '3', rowId: 'row-3', rowName: 'x' }, { userId: 'user-5', teamId: '5', rowId: 'row-5', rowName: 'y' }] })
    expect(await notifyNewEspnOffers({ league: ROW_2, viewerTeamId: '2', offers: [thirdPartyOffer()], now: NOW }, d)).toBe(0)
    expect(await postEspnOfferDms({ league: ROW_2, viewerTeamId: '2', offers: [thirdPartyOffer()], now: NOW }, d)).toBe(0)
    expect(d.dispatch).not.toHaveBeenCalled()
    expect(d.postDm).not.toHaveBeenCalled()
  })

  it('the full sweep hands only the viewer-team offer to the notifier and the DM, never the third-party one', async () => {
    const body = clone(PENDING_BODY)
    const list = body.pendingTransactions as Array<Record<string, unknown>>
    list.push({ ...clone(list[0]!), id: '00000000-0000-4000-8000-000000000035', teamId: 3, teamActions: { '3': 'ACCEPTED' },
      items: [{ type: 'TRADE', playerId: 111, fromTeamId: 3, toTeamId: 5 }, { type: 'TRADE', playerId: 222, fromTeamId: 5, toTeamId: 3 }] })
    const seen: string[][] = []
    const sync: Partial<EspnOfferSyncDeps> = {
      fetchPending: vi.fn(async () => ({ ok: true as const, raw: body, swid: null })),
      persist: vi.fn(async (a) => ({ offersWritten: a.offers.length, assetsWritten: 0, vanished: 0, vanishSkipped: false })),
      viewerTeam: vi.fn(async () => '2'),
      storedPending: vi.fn(async () => []),
      expire: vi.fn(async () => 0),
      notify: vi.fn(async (a) => { seen.push(a.offers.map((o) => o.providerTradeId)); return 1 }),
      dm: vi.fn(async (a) => { seen.push(a.offers.map((o) => o.providerTradeId)); return 1 }),
    }
    const r = await syncEspnTradeOffersForLeague(ROW_2, { now: NOW, deps: sync })
    expect(r).toMatchObject({ excluded: 1, notified: 1, dmPosted: 1 })
    expect(seen).toEqual([[OFFER_ID], [OFFER_ID]])
  })
})

// ── (b) DM card ─────────────────────────────────────────────────────────────────────────────────

describe('(b) the two-manager DM card', () => {
  beforeEach(() => vi.clearAllMocks())

  it('both teams claimed: one card, proposer → receiver, the drop on the dropping side, each link to their own row', async () => {
    const d = notifyDeps()
    expect(await postEspnOfferDms({ league: ROW_2, viewerTeamId: '2', offers: [realOffer()], now: NOW }, d)).toBe(1)
    const input = (d.postDm as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(input).toMatchObject({
      provider: 'espn',
      providerLeagueId: '123456',
      transactionId: OFFER_ID,
      directionKnown: true,
      proposer: { userId: 'user-7', manager: 'Fixture Team 7', href: '/league/row-7?view=trades' },
      receiver: { userId: 'user-2', manager: 'Fixture Team 2', href: '/league/row-2?view=trades' },
    })
    expect(input.proposer.gives.map((g: { label: string }) => g.label)).toEqual(['Michael Wilson', 'Marvin Harrison Jr.'])
    expect(input.proposer.gives[1].detail).toBe('dropped if it goes through')
    expect(input.receiver.gives.map((g: { label: string }) => g.label)).toEqual(['Puka Nacua'])
  })

  it('the same offer from the other copy posts with the SAME key (provider league + offer id), so the DM claim dedupes it', async () => {
    const d = notifyDeps()
    await postEspnOfferDms({ league: ROW_2, viewerTeamId: '2', offers: [realOffer()], now: NOW }, d)
    await postEspnOfferDms({ league: ROW_7, viewerTeamId: '7', offers: [realOffer()], now: NOW }, d)
    const keys = (d.postDm as ReturnType<typeof vi.fn>).mock.calls.map((c) => `${c[0].provider}:${c[0].providerLeagueId}:${c[0].transactionId}`)
    expect(new Set(keys)).toEqual(new Set([`espn:123456:${OFFER_ID}`]))
  })

  it('only one team claimed on AllFantasy: no DM', async () => {
    const d = notifyDeps({ party: [BOTH_CLAIMED[0]!] })
    expect(await postEspnOfferDms({ league: ROW_2, viewerTeamId: '2', offers: [realOffer()], now: NOW }, d)).toBe(0)
    expect(d.postDm).not.toHaveBeenCalled()
  })

  it('partyUsersFromRows: own row wins, and a user who claimed two teams identifies no side', () => {
    const rows = [
      { id: 'row-2', name: 'A', userId: 'user-2', teams: [{ externalId: '2', claimedByUserId: 'user-2', teamName: 'T2' }, { externalId: '7', claimedByUserId: 'user-7' }] },
      { id: 'row-7', name: 'B', userId: 'user-7', teams: [{ externalId: '7', claimedByUserId: 'user-7', teamName: 'T7' }] },
      { id: 'row-x', name: 'C', userId: 'user-x', teams: [{ externalId: '3', claimedByUserId: 'user-x' }, { externalId: '2', claimedByUserId: 'user-x' }] },
    ]
    expect(partyUsersFromRows(rows, ['7', '2'])).toEqual([
      { userId: 'user-2', teamId: '2', rowId: 'row-2', rowName: 'A', teamName: 'T2' },
      { userId: 'user-7', teamId: '7', rowId: 'row-7', rowName: 'B', teamName: 'T7' },
    ])
  })
})

// ── (c) Lineup impact ───────────────────────────────────────────────────────────────────────────

const IMPACT: LineupImpactSummary = {
  unit: 'league_points_week', week: 12, startingPointsBefore: 100, startingPointsAfter: 104.5, startingPointsDelta: 4.5,
  blockedReason: null, unpricedExcluded: 0, depthChanges: [],
}

describe('(c) lineup impact', () => {
  it('resolvable: the evaluator gets SLEEPER ids, the viewer’s own drop as a release, and the impact comes back', async () => {
    const [view] = buildEspnOfferViews({ rows: [row(realOffer())], viewerTeamId: '7', found })
    const evaluate = vi.fn(async (args: { trades: Array<{ transactionId: string }> }) => new Map(args.trades.map((t) => [t.transactionId, { rosterImpact: IMPACT }])))
    const out = await espnOfferLineupImpacts('row-7', [view!], { evaluate: evaluate as never })
    expect(out.get(OFFER_ID)).toEqual(IMPACT)
    const call = evaluate.mock.calls[0]![0] as unknown as {
      trades: Array<{ assetsGiven: Array<{ playerId: string }>; assetsReceived: Array<{ playerId: string }> }>
      releasedByViewer: Map<string, string[]>
      includeRosterImpact: boolean
      recordProposal: boolean
    }
    expect(call.includeRosterImpact).toBe(true)
    expect(call.recordProposal).toBe(false)
    expect(call.trades[0]!.assetsGiven.map((a) => a.playerId)).toEqual(['9997'])
    expect(call.trades[0]!.assetsReceived.map((a) => a.playerId)).toEqual(['9493'])
    expect(call.releasedByViewer.get(OFFER_ID)).toEqual(['11632'])
    // 🛑 No ESPN id reaches the evaluator.
    expect(JSON.stringify(call.trades)).not.toMatch(new RegExp(`${WILSON}|${NACUA}|${MHJ}`))
  })

  it("the receiver's side carries no release: the partner's drop is not on their roster", async () => {
    const [view] = buildEspnOfferViews({ rows: [row(realOffer())], viewerTeamId: '2', found })
    expect(view!.impactIds).toEqual({ give: ['9493'], get: ['9997'], releases: [] })
  })

  it('unresolved player: no number — a blocked "not computed" line, and the evaluator is never asked', async () => {
    const partial = new Map(found)
    partial.set(NACUA, { ok: true, name: 'Puka Nacua', position: 'WR' }) // named, but no Sleeper id
    const [view] = buildEspnOfferViews({ rows: [row(realOffer())], viewerTeamId: '2', found: partial })
    expect(view!.impactIds).toBeNull()
    const evaluate = vi.fn()
    const out = await espnOfferLineupImpacts('row-2', [view!], { evaluate: evaluate as never })
    expect(evaluate).not.toHaveBeenCalled()
    const s = out.get(OFFER_ID)!
    expect(s.startingPointsDelta).toBeNull()
    expect(s.blockedReason).toBe(ESPN_UNRESOLVED_LINEUP_REASON)
    expect(lineupImpactLine(s)).toMatch(/^Lineup effect not computed: /)
  })

  it('evaluator produced nothing (roster unmapped): null, which renders "unavailable", never a number', async () => {
    const [view] = buildEspnOfferViews({ rows: [row(realOffer())], viewerTeamId: '2', found })
    const out = await espnOfferLineupImpacts('row-2', [view!], { evaluate: (async () => new Map()) as never })
    expect(out.get(OFFER_ID)).toBeNull()
  })
})

// ── (a) Actions ─────────────────────────────────────────────────────────────────────────────────

const req = (body: unknown) => ({ json: async () => body }) as never

describe('(a) accept / decline / counter — refused until an ESPN write is captured', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-2' } } as never)
    delete process.env.ESPN_TRADE_OFFER_ACTIONS
  })

  it('the route refuses with a clear "act on ESPN" message while the flag is off', async () => {
    const res = await actionRoute(req({ leagueId: 'row-2', offerId: OFFER_ID, action: 'accept' }))
    expect(res.status).toBe(501)
    const json = await res.json()
    expect(json).toMatchObject({ ok: false, code: 'not_available', actOn: 'espn' })
    expect(json.error).toBe(ESPN_OFFER_ACTION_UNAVAILABLE_MESSAGE)
    expect(json.error).toMatch(/act on it in ESPN/)
  })

  it('🛑 still refuses with the flag ON: no write contract, no request to send', async () => {
    process.env.ESPN_TRADE_OFFER_ACTIONS = 'on'
    expect(espnOfferActionsAvailable()).toBe(false)
    const res = await actionRoute(req({ leagueId: 'row-2', offerId: OFFER_ID, action: 'decline' }))
    expect(res.status).toBe(501)
    expect(await performEspnOfferAction({ action: 'counter', env: { ESPN_TRADE_OFFER_ACTIONS: 'on' } })).toMatchObject({ ok: false, code: 'not_available' })
  })

  it('401 without a session, 400 on an unknown action', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never)
    expect((await actionRoute(req({ leagueId: 'row-2', offerId: OFFER_ID, action: 'accept' }))).status).toBe(401)
    expect((await actionRoute(req({ leagueId: 'row-2', offerId: OFFER_ID, action: 'veto' }))).status).toBe(400)
  })

  it('the panel gets no actions, so no button renders', () => {
    expect(espnOfferActionsFor({ status: 'pending', viewerConsented: false, proposedByViewer: false })).toEqual([])
    expect(espnOfferActionsFor({ status: 'pending', viewerConsented: false, proposedByViewer: false }, { ESPN_TRADE_OFFER_ACTIONS: 'on' })).toEqual([])
  })

  it('ledger transitions, applied only after ESPN confirms', () => {
    expect(espnOfferStatusAfter('pending', 'decline')).toBe('rejected')
    expect(espnOfferStatusAfter('pending', 'counter')).toBe('rejected')
    expect(espnOfferStatusAfter('pending', 'accept')).toBeNull()
    expect(espnOfferStatusAfter('pending', 'accept', { allOtherTeamsAccepted: true })).toBe('accepted')
    expect(espnOfferStatusAfter('expired', 'decline')).toBeNull()
  })
})

describe('the email builder keeps Sleeper as the default', () => {
  it('a Sleeper call is unchanged in wording', () => {
    const e = buildPendingTradeOfferEmail({ leagueName: 'L', proposerName: 'P', youGet: [], youGive: [], reviewUrl: 'https://app.test/x', baseUrl: 'https://app.test' })
    expect(e.html).toContain('AllFantasy can’t accept or decline a Sleeper trade.')
    expect(e.html).toContain('sent you an offer on Sleeper')
  })
})
