/**
 * ESPN pending trade offers, end to end against the owner's committed capture
 * (`contracts/espn/fixtures/fantasy-pending.NFL.2026.json`). No network: the fetch is a dep.
 *
 * The real offer: team 7 gives ESPN 4360761 (Michael Wilson) to team 2, gets 4426515 (Puka Nacua),
 * and drops 4432708 (Marvin Harrison Jr.). Team 7 has accepted. Expires 2026-11-28 22:43:50 UTC.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-import/espn/EspnLeagueFetchService', () => ({ fetchEspnPendingTradeOffersForSync: vi.fn() }))

import {
  normalizeEspnTradeOffer,
  parseEspnPendingOffersForTeam,
  readEspnPendingTransactions,
} from '@/lib/provider-trades/espnTradeOffers'
import { buildEspnOfferViews, gradeEspnOfferViews, type EspnLedgerRow } from '@/lib/provider-trades/espnOfferView'
import {
  espnOfferNotice,
  expiredOfferIds,
  offerNeedsViewer,
  syncEspnTradeOffersForLeague,
  type EspnOfferSyncDeps,
} from '@/lib/provider-trades/syncEspnTradeOffers'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { ResolvedTradePlayer } from '@/lib/decision-os/trade/tradePlayers'
import { twoSides } from '@/lib/decision-os/trade/tradeRecord'
import type { NormalizedOffer } from '@/lib/provider-trades/providerTradeOfferLedger'

const FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../contracts/espn/fixtures/fantasy-pending.NFL.2026.json'), 'utf8'),
) as { requests: Array<{ resource: string; body: Record<string, unknown> }> }
const LEAGUE_BODY = FIXTURE.requests.find((r) => r.resource === 'league_teams_transactions')!.body
const PENDING_BODY = FIXTURE.requests.find((r) => r.resource === 'pending_transactions_candidate')!.body

const OFFER_ID = '54a04003-243c-4a89-a969-e89ef55dffad'
const WILSON = '4360761'
const NACUA = '4426515'
const MHJ = '4432708'
const EXPIRES = new Date('2026-11-28T22:43:50.000Z')
const BEFORE_EXPIRY = new Date('2026-11-27T20:00:00.000Z')
const AFTER_EXPIRY = new Date('2026-11-28T23:00:00.000Z')

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** A synthetic offer between two OTHER teams (3 ↔ 5), which must never be kept for team 7 or 2. */
function withThirdPartyOffer(body: Record<string, unknown>) {
  const b = clone(body)
  const list = b.pendingTransactions as Array<Record<string, unknown>>
  list.push({
    ...clone(list[0]!),
    id: '00000000-0000-4000-8000-000000000035',
    teamId: 3,
    teamActions: { '3': 'ACCEPTED' },
    items: [
      { type: 'TRADE', playerId: 111, fromTeamId: 3, toTeamId: 5 },
      { type: 'TRADE', playerId: 222, fromTeamId: 5, toTeamId: 3 },
    ],
  })
  return b
}

describe('parse — the committed capture', () => {
  it('reads the one real offer exactly, from Request 2 (mPendingTransactions)', () => {
    const { listed, transactions } = readEspnPendingTransactions(PENDING_BODY)
    expect(listed).toBe(true)
    expect(transactions).toHaveLength(1)
    const offer = normalizeEspnTradeOffer(transactions[0]!)!
    expect(offer).toMatchObject({
      provider: 'espn',
      providerTradeId: OFFER_ID,
      status: 'pending',
      providerStatus: 'PENDING',
      proposedByRosterId: '7',
      consentedRosterIds: ['7'],
      weekOrPeriod: 12,
    })
    expect(offer.rosterIds.sort()).toEqual(['2', '7'])
    expect(offer.expiresAt?.toISOString()).toBe(EXPIRES.toISOString())
    expect(offer.proposedAt?.toISOString()).toBe(new Date(1795733030093).toISOString())
    expect(offer.assets).toEqual([
      expect.objectContaining({ assetType: 'player', playerId: WILSON, fromRosterId: '7', toRosterId: '2' }),
      expect.objectContaining({ assetType: 'player', playerId: NACUA, fromRosterId: '2', toRosterId: '7' }),
      // The conditional DROP: released by team 7, received by nobody (ESPN's toTeamId 0).
      expect.objectContaining({ assetType: 'drop', playerId: MHJ, fromRosterId: '7', toRosterId: null }),
    ])
  })

  it('finds the same offer once in Request 1, though ESPN lists it three times there', () => {
    const { listed, transactions } = readEspnPendingTransactions(LEAGUE_BODY)
    // Request 1 has no top-level pendingTransactions array, so it is never proof of absence.
    expect(listed).toBe(false)
    expect(transactions.map((t) => t.id)).toEqual([OFFER_ID])
  })

  it('keeps only offers the viewer team sent or received; a third-party offer is excluded (GAPS T-03)', () => {
    const body = withThirdPartyOffer(PENDING_BODY)
    for (const team of ['7', '2']) {
      const r = parseEspnPendingOffersForTeam(body, team)
      expect(r.offers.map((o) => o.providerTradeId)).toEqual([OFFER_ID])
      expect(r.excluded).toBe(1)
    }
    expect(parseEspnPendingOffersForTeam(body, '5').offers.map((o) => o.providerTradeId)).toEqual([
      '00000000-0000-4000-8000-000000000035',
    ])
    expect(parseEspnPendingOffersForTeam(body, '9').offers).toEqual([])
    expect(parseEspnPendingOffersForTeam(body, null).offers).toEqual([])
  })
})

// ── Grade ─────────────────────────────────────────────────────────────────────────────────────

const VALUE: Record<string, number> = { 'Michael Wilson': 3000, 'Puka Nacua': 8000, 'Marvin Harrison Jr.': 6000 }
const found = new Map<string, ResolvedTradePlayer>([
  [WILSON, { ok: true, name: 'Michael Wilson', position: 'WR', sleeperId: '9997' }],
  [NACUA, { ok: true, name: 'Puka Nacua', position: 'WR', sleeperId: '9493' }],
  [MHJ, { ok: true, name: 'Marvin Harrison Jr.', position: 'WR', sleeperId: '11632' }],
])

/** A grader whose letter is the received/given value ratio — enough to show direction. */
const fakeGrader = {
  grade: async ({ give, get }: { give: Array<{ name?: string }>; get: Array<{ name?: string }> }) => {
    const sum = (a: Array<{ name?: string }>) => a.reduce((t, x) => t + (VALUE[x.name ?? ''] ?? 0), 0)
    const giveValue = sum(give)
    const getValue = sum(get)
    const r = getValue / giveValue
    const letter = r >= 1.5 ? 'A' : r >= 1.1 ? 'B' : r >= 0.9 ? 'C' : r >= 0.7 ? 'D' : 'F'
    return { graded: true, letter, giveValue, getValue, label: letter }
  },
} as unknown as LeagueTradeGrader

function ledgerRow(offer: NormalizedOffer, opts: { withoutDrop?: boolean } = {}): EspnLedgerRow {
  return {
    providerTradeId: offer.providerTradeId,
    status: offer.status,
    proposedByRosterId: offer.proposedByRosterId,
    rosterIds: offer.rosterIds,
    consentedRosterIds: offer.consentedRosterIds,
    proposedAt: offer.proposedAt,
    firstSeenAt: BEFORE_EXPIRY,
    expiresAt: offer.expiresAt ?? null,
    assets: offer.assets.filter((a) => !(opts.withoutDrop && a.assetType === 'drop')),
  }
}

const realOffer = () => parseEspnPendingOffersForTeam(PENDING_BODY, '7').offers[0]!

describe('grade — the conditional DROP counts, on the side that drops', () => {
  it('the proposer (team 7) loses the dropped player: graded lower WITH the drop', async () => {
    const [withDrop] = buildEspnOfferViews({ rows: [ledgerRow(realOffer())], viewerTeamId: '7', found })
    const [noDrop] = buildEspnOfferViews({ rows: [ledgerRow(realOffer(), { withoutDrop: true })], viewerTeamId: '7', found })
    expect(withDrop!.dropLine).toBe('and you drop Marvin Harrison Jr.')
    expect(withDrop!.trade.proposedByViewer).toBe(true)

    const g1 = (await gradeEspnOfferViews([withDrop!], fakeGrader)).get(OFFER_ID)!
    const g0 = (await gradeEspnOfferViews([noDrop!], fakeGrader)).get(OFFER_ID)!
    expect(g0).toMatchObject({ graded: true, giveValue: 3000, getValue: 8000, letter: 'A' })
    expect(g1).toMatchObject({ graded: true, giveValue: 9000, getValue: 8000, letter: 'D' })
    // Right direction: the drop is a cost, so more is given and the letter falls.
    expect((g1 as { giveValue: number }).giveValue).toBeGreaterThan((g0 as { giveValue: number }).giveValue)
  })

  it('the recipient (team 2) is shown the drop but is not credited with a player nobody sends them', async () => {
    const [view] = buildEspnOfferViews({ rows: [ledgerRow(realOffer())], viewerTeamId: '2', found })
    expect(view!.dropLine).toBe('and they drop Marvin Harrison Jr.')
    expect(view!.trade.assetsGiven.map((a) => a.playerName)).toEqual(['Puka Nacua'])
    expect(view!.trade.assetsReceived.map((a) => a.playerName)).toEqual(['Michael Wilson'])
    const g = (await gradeEspnOfferViews([view!], fakeGrader)).get(OFFER_ID)!
    expect(g).toMatchObject({ graded: true, giveValue: 8000, getValue: 3000 })
  })

  it('an ESPN id with no identity withholds the grade instead of pricing a stranger', async () => {
    const partial = new Map(found)
    partial.delete(MHJ)
    const [view] = buildEspnOfferViews({ rows: [ledgerRow(realOffer())], viewerTeamId: '7', found: partial })
    const g = (await gradeEspnOfferViews([view!], fakeGrader)).get(OFFER_ID)!
    expect(g.graded).toBe(false)
  })

  it('never builds a view for a team not in the offer', () => {
    expect(buildEspnOfferViews({ rows: [ledgerRow(realOffer())], viewerTeamId: '5', found })).toEqual([])
  })

  it('the stored-trade path files the drop under the dropping side, not as a third team', () => {
    const r = twoSides(
      [
        { fromTeamId: '7', toTeamId: '2', asset: { kind: 'player', playerId: WILSON } },
        { fromTeamId: '2', toTeamId: '7', asset: { kind: 'player', playerId: NACUA } },
        { fromTeamId: '7', toTeamId: null, drop: true, asset: { kind: 'player', playerId: MHJ } },
      ],
      { sideAId: '7', declaredTeamIds: ['7', '2'] },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.trade.sideA).toEqual({ teamId: '7', gives: [{ kind: 'player', playerId: WILSON }], drops: [{ kind: 'player', playerId: MHJ }] })
    expect(r.trade.sideB).toEqual({ teamId: '2', gives: [{ kind: 'player', playerId: NACUA }] })
  })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────

const LEAGUE = { id: 'af-league-1', userId: 'user-1', platformLeagueId: '123456', season: 2026, name: 'Fixture League' }

function deps(over: Partial<EspnOfferSyncDeps> & { stored?: Array<{ providerTradeId: string; expiresAt: Date | null }>; team?: string } = {}) {
  const calls = { persisted: [] as Array<{ offers: NormalizedOffer[]; feedComplete: boolean }>, expired: [] as string[][], notified: [] as NormalizedOffer[][] }
  const d: EspnOfferSyncDeps = {
    fetchPending: vi.fn(async () => ({ ok: true as const, raw: clone(PENDING_BODY), swid: null })),
    persist: vi.fn(async (a) => {
      calls.persisted.push({ offers: a.offers, feedComplete: a.feedComplete })
      return { offersWritten: a.offers.length, assetsWritten: 0, vanished: 0, vanishSkipped: !a.feedComplete }
    }),
    viewerTeam: vi.fn(async () => over.team ?? '2'),
    storedPending: vi.fn(async () => over.stored ?? []),
    expire: vi.fn(async (_l, ids) => {
      calls.expired.push(ids)
      return ids.length
    }),
    notify: vi.fn(async (a) => {
      calls.notified.push(a.offers)
      return a.offers.length
    }),
    ...over,
  }
  return { d, calls }
}

describe('lifecycle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('first sweep: stores the offer with its expiry, as a complete feed, and notifies the recipient once', async () => {
    const { d, calls } = deps({ team: '2' })
    const r = await syncEspnTradeOffersForLeague(LEAGUE, { now: BEFORE_EXPIRY, deps: d })
    expect(r).toMatchObject({ offersSeen: 1, excluded: 0, feedComplete: true, notified: 1, expired: 0 })
    expect(calls.persisted[0]!.feedComplete).toBe(true)
    expect(calls.persisted[0]!.offers[0]!).toMatchObject({ providerTradeId: OFFER_ID, status: 'pending' })
    expect(calls.persisted[0]!.offers[0]!.expiresAt?.toISOString()).toBe(EXPIRES.toISOString())
    expect(d.fetchPending).toHaveBeenCalledWith('user-1', '123456', 2026)
  })

  it('a known offer is not notified again, and the proposer is never notified of their own offer', async () => {
    const known = deps({ team: '2', stored: [{ providerTradeId: OFFER_ID, expiresAt: EXPIRES }] })
    expect((await syncEspnTradeOffersForLeague(LEAGUE, { now: BEFORE_EXPIRY, deps: known.d })).notified).toBe(0)
    const own = deps({ team: '7' })
    expect((await syncEspnTradeOffersForLeague(LEAGUE, { now: BEFORE_EXPIRY, deps: own.d })).notified).toBe(0)
    expect(offerNeedsViewer(realOffer(), '7', BEFORE_EXPIRY)).toBe(false)
    expect(offerNeedsViewer(realOffer(), '2', BEFORE_EXPIRY)).toBe(true)
    expect(offerNeedsViewer(realOffer(), '2', AFTER_EXPIRY)).toBe(false)
  })

  it('a third-party offer in the body is never persisted', async () => {
    const { d, calls } = deps({ team: '7', fetchPending: vi.fn(async () => ({ ok: true as const, raw: withThirdPartyOffer(PENDING_BODY), swid: null })) })
    const r = await syncEspnTradeOffersForLeague(LEAGUE, { now: BEFORE_EXPIRY, deps: d })
    expect(r.excluded).toBe(1)
    expect(calls.persisted[0]!.offers.map((o) => o.providerTradeId)).toEqual([OFFER_ID])
  })

  it('gone from ESPN on the next sweep: an empty, provably complete list lets the ledger retire it', async () => {
    const empty = clone(PENDING_BODY)
    empty.pendingTransactions = []
    const { d, calls } = deps({ stored: [{ providerTradeId: OFFER_ID, expiresAt: EXPIRES }], fetchPending: vi.fn(async () => ({ ok: true as const, raw: empty, swid: null })) })
    await syncEspnTradeOffersForLeague(LEAGUE, { now: BEFORE_EXPIRY, deps: d })
    // feedComplete with no offers is exactly what makes persistProviderTradeOffers mark the stored row `vanished`.
    expect(calls.persisted[0]).toEqual({ offers: [], feedComplete: true })
  })

  it('a failed read retires nothing — but an offer past ESPN’s stated expiry is still expired', async () => {
    const { d, calls } = deps({
      stored: [{ providerTradeId: OFFER_ID, expiresAt: EXPIRES }],
      fetchPending: vi.fn(async () => ({ ok: false as const, reason: 'ESPN refused the stored cookies' })),
    })
    const before = await syncEspnTradeOffersForLeague(LEAGUE, { now: BEFORE_EXPIRY, deps: d })
    expect(before).toMatchObject({ skipped: 'ESPN refused the stored cookies', expired: 0, feedComplete: false })
    expect(calls.persisted).toEqual([])
    const after = await syncEspnTradeOffersForLeague(LEAGUE, { now: AFTER_EXPIRY, deps: d })
    expect(after.expired).toBe(1)
    expect(calls.expired.at(-1)).toEqual([OFFER_ID])
    expect(calls.persisted).toEqual([])
  })

  it('ESPN still listing it past expiry records it expired, not re-opened', async () => {
    const { d, calls } = deps({ stored: [{ providerTradeId: OFFER_ID, expiresAt: EXPIRES }] })
    await syncEspnTradeOffersForLeague(LEAGUE, { now: AFTER_EXPIRY, deps: d })
    expect(calls.persisted[0]!.offers[0]!.status).toBe('expired')
    expect(calls.notified).toEqual([])
  })

  it('a Request-1-shaped body (no pendingTransactions array) never counts as a complete read', async () => {
    const { d, calls } = deps({ fetchPending: vi.fn(async () => ({ ok: true as const, raw: clone(LEAGUE_BODY), swid: null })) })
    await syncEspnTradeOffersForLeague(LEAGUE, { now: BEFORE_EXPIRY, deps: d })
    expect(calls.persisted[0]!.feedComplete).toBe(false)
  })

  it('expiredOfferIds is strict about the stated time', () => {
    const stored = [{ providerTradeId: 'a', expiresAt: EXPIRES }, { providerTradeId: 'b', expiresAt: null }]
    expect(expiredOfferIds(stored, BEFORE_EXPIRY)).toEqual([])
    expect(expiredOfferIds(stored, EXPIRES)).toEqual(['a'])
  })
})

describe('notice', () => {
  it('names both sides, the drop and the letter', () => {
    const [view] = buildEspnOfferViews({ rows: [ledgerRow(realOffer())], viewerTeamId: '2', found, teamNameOf: () => 'Fixture Team 7' })
    const n = espnOfferNotice({ leagueName: 'Fixture League', view: view!, grade: { graded: true, letter: 'F' } as never })
    expect(n.title).toBe('Trade offer in Fixture League — F for you')
    expect(n.body).toBe(
      'Fixture Team 7 offers Michael Wilson for your Puka Nacua and they drop Marvin Harrison Jr. AllFantasy grades it F for you. Answer it on ESPN.',
    )
  })
})
