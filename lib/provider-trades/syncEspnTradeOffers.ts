import 'server-only'

import { prisma } from '@/lib/prisma'
import { fetchEspnPendingTradeOffersForSync } from '@/lib/league-import/espn/EspnLeagueFetchService'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { persistProviderTradeOffers, type NormalizedOffer } from './providerTradeOfferLedger'
import { rotationWindow } from './syncProviderTradeOffers'
import { espnTeamId, parseEspnPendingOffersForTeam } from './espnTradeOffers'
import type { EspnOfferView } from './espnOfferView'

/**
 * ESPN pending trade offers → the provider trade-offer ledger. The INGESTION half; the Trade Center,
 * the inbox and Chimmy read the rows this writes (DB-first), never ESPN.
 *
 * Scheduled from `/api/cron/trade-grade-notify` (every 5-minute tick), beside the Sleeper sweeps.
 *
 * ── WHOSE COOKIES, WHOSE OFFERS ───────────────────────────────────────────────────────────────
 * One read per AllFantasy ESPN league row, with the stored SWID/espn_s2 of THAT row's connected user
 * (`League.userId`) and nobody else's. ESPN shows a member the offers their team is in; AllFantasy
 * keeps only offers that user's team sent or received (owner rule, contracts/espn/GAPS.md T-03), even
 * if ESPN were to return more. Their team is the team they claimed, else the team whose ESPN owner id
 * is their SWID (`LeagueTeam.platformUserId`, as the importer stores it).
 *
 * ── LIFECYCLE ─────────────────────────────────────────────────────────────────────────────────
 *  - Seen and PENDING: upserted, `expiresAt` = ESPN's `expirationDate`.
 *  - Past its `expirationDate` and still pending on our side: `expired` — ESPN stated that time, so
 *    this is the provider's word, not an inference. Applied whether or not this run read the feed.
 *  - Absent from a feed we PROVABLY read in full (the body carried the `pendingTransactions` array):
 *    `vanished` (accepted, declined, withdrawn or countered — ESPN's list does not say which).
 *  - A failed read (no cookies, cookies refused, ESPN error) retires NOTHING.
 *
 * ── NOTIFY ────────────────────────────────────────────────────────────────────────────────────
 * The first time an offer is seen, each AllFantasy manager IN it who still has to answer it gets one
 * `trade_proposals` notice carrying THE grade — bell, push and the offer email, under their own
 * settings — and, when both teams are claimed on AllFantasy, the offer card lands in their DM. Once
 * each, by claim rows. See `notifyEspnOffers.ts`. Chimmy reads the same ledger rows
 * (`pendingTradeDecisionGrounding`).
 */

export type EspnLeagueOfferSyncResult = {
  leagueId: string
  offersSeen: number
  /** Offers in the body that involved only other teams — never stored. */
  excluded: number
  offersWritten: number
  expired: number
  vanished: number
  notified: number
  /** Offer cards posted into a two-manager DM this run. */
  dmPosted: number
  feedComplete: boolean
  skipped?: string
  error?: string
}

export type EspnOfferSweepResult = {
  leaguesEligible: number
  leaguesSwept: number
  offersWritten: number
  expired: number
  vanished: number
  notified: number
  feedIncomplete: number
  results: EspnLeagueOfferSyncResult[]
}

type LeagueRow = { id: string; userId: string; platformLeagueId: string; season: number | null; name: string | null }

export type EspnOfferSyncDeps = {
  fetchPending: typeof fetchEspnPendingTradeOffersForSync
  persist: typeof persistProviderTradeOffers
  /** Resolve the viewer's ESPN team id from our own tables. */
  viewerTeam: (leagueId: string, userId: string, swid: string | null) => Promise<string | null>
  /** Pending ESPN rows already stored for this league (to tell new offers from known ones). */
  storedPending: (leagueId: string) => Promise<Array<{ providerTradeId: string; expiresAt: Date | null }>>
  expire: (leagueId: string, providerTradeIds: string[]) => Promise<number>
  notify: (args: { league: LeagueRow; viewerTeamId: string; offers: NormalizedOffer[]; now: Date }) => Promise<number>
  /** The DM card between the two managers, when both teams are claimed. */
  dm: (args: { league: LeagueRow; viewerTeamId: string; offers: NormalizedOffer[]; now: Date }) => Promise<number>
}

const normSwid = (v: string | null | undefined) => String(v ?? '').replace(/[{}]/g, '').trim().toLowerCase()

const defaultDeps: EspnOfferSyncDeps = {
  fetchPending: fetchEspnPendingTradeOffersForSync,
  persist: persistProviderTradeOffers,
  viewerTeam: async (leagueId, userId, swid) => {
    const claimed = await prisma.leagueTeam
      .findFirst({ where: { leagueId, claimedByUserId: userId }, select: { externalId: true } })
      .catch(() => null)
    if (espnTeamId(claimed?.externalId)) return espnTeamId(claimed?.externalId)
    const target = normSwid(swid)
    if (!target) return null
    const teams = await prisma.leagueTeam
      .findMany({ where: { leagueId, platformUserId: { not: null } }, select: { externalId: true, platformUserId: true } })
      .catch(() => [] as Array<{ externalId: string; platformUserId: string | null }>)
    const mine = teams.filter((t) => normSwid(t.platformUserId) === target)
    // Exactly one, or none: a SWID that matches two teams identifies nobody.
    return mine.length === 1 ? espnTeamId(mine[0]!.externalId) : null
  },
  storedPending: async (leagueId) =>
    prisma.providerTradeOffer.findMany({
      where: { leagueId, provider: 'espn', status: 'pending' },
      select: { providerTradeId: true, expiresAt: true },
    }),
  expire: async (leagueId, providerTradeIds) => {
    if (providerTradeIds.length === 0) return 0
    const r = await prisma.providerTradeOffer.updateMany({
      where: { leagueId, provider: 'espn', status: 'pending', providerTradeId: { in: providerTradeIds } },
      data: { status: 'expired' },
    })
    return r.count
  },
  notify: async (args) => (await import('./notifyEspnOffers')).notifyNewEspnOffers(args),
  dm: async (args) => (await import('./notifyEspnOffers')).postEspnOfferDms(args),
}

/** PURE. Stored pending offers whose ESPN-stated expiry has passed. */
export function expiredOfferIds(stored: ReadonlyArray<{ providerTradeId: string; expiresAt: Date | null }>, now: Date): string[] {
  return stored.filter((o) => o.expiresAt && o.expiresAt.getTime() <= now.getTime()).map((o) => o.providerTradeId)
}

/** PURE. A newly seen offer the viewer must answer: pending, not sent by them, not yet accepted by them. */
export function offerNeedsViewer(offer: NormalizedOffer, viewerTeamId: string, now: Date): boolean {
  const me = espnTeamId(viewerTeamId)
  if (!me || offer.status !== 'pending') return false
  if (offer.expiresAt && offer.expiresAt.getTime() <= now.getTime()) return false
  return offer.proposedByRosterId !== me && !offer.consentedRosterIds.includes(me)
}

export async function syncEspnTradeOffersForLeague(
  league: LeagueRow,
  opts: { now?: Date; deps?: Partial<EspnOfferSyncDeps> } = {},
): Promise<EspnLeagueOfferSyncResult> {
  const d: EspnOfferSyncDeps = { ...defaultDeps, ...opts.deps }
  const now = opts.now ?? new Date()
  const result: EspnLeagueOfferSyncResult = {
    leagueId: league.id, offersSeen: 0, excluded: 0, offersWritten: 0, expired: 0, vanished: 0, notified: 0, dmPosted: 0, feedComplete: false,
  }

  // Expiry first, and regardless of whether the read below succeeds: ESPN stated these times.
  const stored = await d.storedPending(league.id).catch(() => [])
  try {
    result.expired = await d.expire(league.id, expiredOfferIds(stored, now))
  } catch (e) {
    result.error = e instanceof Error ? e.name : 'expire failed'
  }

  const season = league.season ?? now.getUTCFullYear()
  const fetched = await d.fetchPending(league.userId, league.platformLeagueId, season).catch(
    (e): { ok: false; reason: string } => ({ ok: false, reason: e instanceof Error ? e.name : 'ESPN read failed' }),
  )
  if (!fetched.ok) return { ...result, skipped: fetched.reason }

  const viewerTeamId = await d.viewerTeam(league.id, league.userId, fetched.swid).catch(() => null)
  if (!viewerTeamId) return { ...result, skipped: 'the connected user has no identified team in this league' }

  const read = parseEspnPendingOffersForTeam(fetched.raw, viewerTeamId)
  /*
   * An offer ESPN still lists past its own stated expiry is recorded as `expired`, not re-opened as
   * `pending` — otherwise each run would undo the expiry step above.
   */
  const parsed = {
    ...read,
    offers: read.offers.map((o) =>
      o.status === 'pending' && o.expiresAt && o.expiresAt.getTime() <= now.getTime() ? { ...o, status: 'expired' as const } : o,
    ),
  }
  result.offersSeen = parsed.offers.length
  result.excluded = parsed.excluded
  result.feedComplete = parsed.listed

  const known = new Set(stored.map((o) => o.providerTradeId))
  try {
    const persisted = await d.persist({
      leagueId: league.id,
      sport: 'NFL',
      season: league.season ?? null,
      provider: 'espn',
      offers: parsed.offers,
      feedComplete: parsed.listed,
      seenAt: now,
    })
    result.offersWritten = persisted.offersWritten
    result.vanished = persisted.vanished
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.name : 'persist failed' }
  }

  /*
   * New to THIS row, still open, and this row's team is in it (the parse already dropped the rest).
   * Who is told is decided per manager in `notifyNewEspnOffers` — the other team's manager may be
   * waiting on it even when this row's user sent it.
   */
  const fresh = parsed.offers.filter(
    (o) => !known.has(o.providerTradeId) && o.status === 'pending' && (!o.expiresAt || o.expiresAt.getTime() > now.getTime()),
  )
  if (fresh.length) {
    result.notified = await d.notify({ league, viewerTeamId, offers: fresh, now }).catch(() => 0)
    result.dmPosted = await d.dm({ league, viewerTeamId, offers: fresh, now }).catch(() => 0)
  }
  return result
}

/**
 * One slice of ESPN football leagues, swept. Failure-contained per league, like the Sleeper rotation:
 * one league's ESPN hiccup must not cost the rest their offers.
 */
export async function sweepEspnTradeOffers(args?: {
  maxLeagues?: number
  now?: Date
  deadlineMs?: number
  deps?: Partial<EspnOfferSyncDeps>
  leagues?: LeagueRow[]
}): Promise<EspnOfferSweepResult> {
  const now = args?.now ?? new Date()
  const startedAt = Date.now()
  const leagues =
    args?.leagues ??
    (await prisma.league
      .findMany({
        where: {
          platform: { equals: 'espn', mode: 'insensitive' },
          // Football only — the captured contract is NFL, and a non-NFL ESPN league's ids are not NFL players (#4322).
          sport: 'NFL',
          platformLeagueId: { not: '' },
        },
        select: { id: true, userId: true, platformLeagueId: true, season: true, name: true },
        // Stable ordering — see rotationWindow. Never order on a column this sweep writes.
        orderBy: { id: 'asc' },
      })
      .catch(() => [] as LeagueRow[]))

  const out: EspnOfferSweepResult = {
    leaguesEligible: leagues.length, leaguesSwept: 0, offersWritten: 0, expired: 0, vanished: 0, notified: 0, feedIncomplete: 0, results: [],
  }
  for (const league of rotationWindow(leagues, args?.maxLeagues ?? 25, now.getTime())) {
    if (args?.deadlineMs && Date.now() - startedAt > args.deadlineMs) break
    if (!league.platformLeagueId || !league.userId) continue
    const one = await syncEspnTradeOffersForLeague(league, { now, deps: args?.deps })
    out.results.push(one)
    out.leaguesSwept += 1
    out.offersWritten += one.offersWritten
    out.expired += one.expired
    out.vanished += one.vanished
    out.notified += one.notified
    if (!one.feedComplete) out.feedIncomplete += 1
  }
  return out
}

// ── Notify ────────────────────────────────────────────────────────────────────────────────────

/** PURE. The notice for one offer. Exported for tests. */
export function espnOfferNotice(args: {
  leagueName: string | null
  view: Pick<EspnOfferView, 'trade' | 'dropLine'>
  grade: TradeGradeView | null
}): { title: string; body: string } {
  const name = args.leagueName?.trim() || 'your ESPN league'
  const names = (a: { playerName: string }[]) => a.map((x) => x.playerName).join(', ') || 'nothing'
  const t = args.view.trade
  const letter = args.grade?.graded ? args.grade.letter : null
  const lead = `${t.proposedBy} offers ${names(t.assetsReceived)} for your ${names(t.assetsGiven)}${args.view.dropLine ? ` ${args.view.dropLine}` : ''}`
  const body = [
    lead,
    // A name such as "Marvin Harrison Jr." already ends the sentence.
    lead.endsWith('.') ? '' : '.',
    letter ? ` AllFantasy grades it ${letter} for you.` : args.grade && !args.grade.graded ? ` Not graded: ${args.grade.reason}` : '',
    ' Answer it on ESPN.',
  ].join('')
  return { title: `Trade offer in ${name}${letter ? ` — ${letter} for you` : ''}`, body }
}
