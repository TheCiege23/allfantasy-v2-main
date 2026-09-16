import 'server-only'

import { prisma } from '@/lib/prisma'
import type { OfferStatus } from './providerTradeOfferLedger'

/**
 * The DB-first read layer over `provider_trade_offers` — the buckets a manager actually asks for:
 * what needs them, what they are waiting on, and what is already settled.
 *
 * 🛑 THE MIGRATION IS STILL PARKED AND NOTHING CALLS THIS. Wiring a surface to it before the
 * tables exist raises P2021 rather than degrading, and pointing a surface at a table nothing
 * refreshes is worse than the live call it replaces. The writer, this reader and the scheduled
 * caller go live together or not at all.
 *
 * ── ⚠ "NEEDS YOU" IS DERIVED FROM CONSENT, NOT FROM AUTHORSHIP, AND THAT IS NOT A WORKAROUND ──
 *
 * The obvious split is "offers I sent" versus "offers sent to me", and it cannot be built here:
 * Sleeper's `creator` is a USER id, not a roster id, so `proposedByRosterId` is null for every
 * Sleeper row (the writer deliberately declines to put one id space into the other's column).
 *
 * Consent is the better signal anyway, not merely the available one. A manager who has already
 * agreed has nothing left to do whether or not they started it, and in a THREE-team trade
 * "sender" is not even well defined — but "has this roster agreed yet" is, for every participant.
 * So the question the bucket answers is the question the manager has: is anyone waiting on me?
 */

export type OfferBucket =
  /** Pending, and this roster has NOT consented — the only bucket with an action attached. */
  | 'needsYou'
  /** Pending, and this roster HAS consented — waiting on somebody else. */
  | 'awaitingOthers'
  | 'completed'
  | 'declined'
  /** No longer on offer, and the provider did not say why. See `goneReason`. */
  | 'gone'

/**
 * Where a displayed timestamp came from.
 *
 * 🛑 A PROVIDER TIME AND AN OBSERVATION TIME ARE NOT INTERCHANGEABLE, AND #7 ASKED FOR RELIABLE
 * TIMESTAMPS SPECIFICALLY. When the provider states when an offer was made, that is the truth.
 * When it does not, the earliest we can honestly claim is when WE FIRST SAW IT — which can be
 * days late for a league whose first sync happened after the offer was sent. Rendering the second
 * as though it were the first turns "sent 5 minutes ago" into a fabrication, so the source ships
 * with the value and the UI is expected to say "first seen" rather than "sent".
 */
export type TimestampSource = 'provider' | 'firstObserved'

export type LedgerOffer = {
  id: string
  providerTradeId: string
  provider: string
  status: OfferStatus
  bucket: OfferBucket
  /** Only set on `gone`: `vanished` means the provider never said why. */
  goneReason: 'expired' | 'withdrawnOrExpired' | null
  at: Date | null
  atSource: TimestampSource | null
  rosterIds: string[]
  consentedRosterIds: string[]
  /** Rosters yet to agree. Empty on a settled offer. */
  awaitingRosterIds: string[]
  assets: LedgerAsset[]
}

export type LedgerAsset = {
  assetType: string
  playerId: string | null
  pickSeason: number | null
  pickRound: number | null
  pickOriginalRosterId: string | null
  faabAmount: number | null
  fromRosterId: string | null
  toRosterId: string | null
}

type OfferRow = {
  id: string
  providerTradeId: string
  provider: string
  status: string
  rosterIds: string[]
  consentedRosterIds: string[]
  proposedAt: Date | null
  firstSeenAt: Date
  expiresAt: Date | null
  assets: LedgerAsset[]
}

/**
 * Which bucket an offer belongs in for one roster.
 *
 * ⚠ `unknown` DOES NOT BECOME A BUCKET WITH AN ACTION. An unrecognised provider status means we do
 * not know what happened, and the two mistakes are not symmetric: filing it under `needsYou` puts
 * a phantom decision in front of a manager, while `gone` merely under-reports. It lands in `gone`
 * with no reason, which reads as "we cannot say" rather than as a request.
 *
 * Pure, so every branch is testable without a database.
 */
export function bucketFor(status: OfferStatus, hasConsented: boolean): OfferBucket {
  switch (status) {
    case 'pending':
      return hasConsented ? 'awaitingOthers' : 'needsYou'
    case 'accepted':
      return 'completed'
    case 'rejected':
      return 'declined'
    case 'expired':
    case 'vanished':
    case 'unknown':
    default:
      return 'gone'
  }
}

/**
 * ⚠ `vanished` AND `expired` ARE REPORTED APART, WHICH IS THE WHOLE REASON THE WRITER KEEPS THEM
 * APART. An offer that stopped appearing may have been withdrawn, expired, or missed by a
 * rate-limited sweep. Labelling that "expired" states a cause nobody observed, so it surfaces as
 * `withdrawnOrExpired` and a surface is expected to say so in those words.
 */
export function goneReasonFor(status: OfferStatus): LedgerOffer['goneReason'] {
  if (status === 'expired') return 'expired'
  if (status === 'vanished') return 'withdrawnOrExpired'
  return null
}

function toLedgerOffer(row: OfferRow, rosterId: string): LedgerOffer {
  const status = row.status as OfferStatus
  const consented = new Set(row.consentedRosterIds)
  const bucket = bucketFor(status, consented.has(rosterId))
  const settled = bucket !== 'needsYou' && bucket !== 'awaitingOthers'

  return {
    id: row.id,
    providerTradeId: row.providerTradeId,
    provider: row.provider,
    status,
    bucket,
    goneReason: goneReasonFor(status),
    at: row.proposedAt ?? row.firstSeenAt ?? null,
    atSource: row.proposedAt ? 'provider' : row.firstSeenAt ? 'firstObserved' : null,
    rosterIds: row.rosterIds,
    consentedRosterIds: row.consentedRosterIds,
    /*
     * ⚠ EMPTY ONCE SETTLED, RATHER THAN "EVERYONE WHO NEVER CONSENTED". On a rejected or vanished
     * offer the non-consenters are not being waited on — nobody is waiting at all — and a surface
     * rendering "awaiting Team B" beside a declined trade is describing a decision that already
     * happened.
     */
    awaitingRosterIds: settled ? [] : row.rosterIds.filter((r) => !consented.has(r)),
    assets: row.assets,
  }
}

export type LedgerView = {
  leagueId: string
  rosterId: string
  needsYou: LedgerOffer[]
  awaitingOthers: LedgerOffer[]
  completed: LedgerOffer[]
  declined: LedgerOffer[]
  gone: LedgerOffer[]
  /**
   * When the sweep last confirmed it read this league's feed, or null if it never has.
   *
   * 🛑 SHIPPED SO A SURFACE CAN DATE ITS OWN SILENCE. "No offers" and "we have not looked" render
   * identically and mean opposite things, and this repo has already paid for that confusion on
   * injuries. A caller with no rows and a null here must say it does not know yet.
   */
  feedLastSeenAt: Date | null
}

const EMPTY_VIEW = (leagueId: string, rosterId: string): LedgerView => ({
  leagueId,
  rosterId,
  needsYou: [],
  awaitingOthers: [],
  completed: [],
  declined: [],
  gone: [],
  feedLastSeenAt: null,
})

/**
 * Every offer in one league that touches one roster, bucketed.
 *
 * ⚠ FILTERED ON `rosterIds`, NOT ON THE ASSETS. A roster can be party to a trade it neither gives
 * nor receives a player in — a pure FAAB leg, or a three-team deal where its only movement is a
 * pick — and an asset-side filter drops exactly those. The writer records participation
 * separately from movement for this reason.
 */
export async function getLeagueTradeLedgerForRoster(args: {
  leagueId: string
  rosterId: string
  /** Settled offers, newest first. Pending are never truncated — they are the actionable ones. */
  settledLimit?: number
}): Promise<LedgerView> {
  const rows = (await prisma.providerTradeOffer
    .findMany({
      where: { leagueId: args.leagueId, rosterIds: { has: args.rosterId } },
      orderBy: [{ proposedAt: 'desc' }, { firstSeenAt: 'desc' }],
      include: { assets: true },
    })
    .catch(() => [])) as unknown as OfferRow[]

  if (rows.length === 0) {
    const view = EMPTY_VIEW(args.leagueId, args.rosterId)
    view.feedLastSeenAt = await latestFeedSeenAt(args.leagueId)
    return view
  }

  const view = EMPTY_VIEW(args.leagueId, args.rosterId)
  const limit = args.settledLimit ?? 50
  for (const row of rows) {
    const offer = toLedgerOffer(row, args.rosterId)
    const target = view[offer.bucket]
    /*
     * The cap applies only to settled buckets. Truncating `needsYou` would hide a decision a
     * manager still has to make, which is the one thing this view exists to surface.
     */
    if (offer.bucket === 'needsYou' || offer.bucket === 'awaitingOthers' || target.length < limit) {
      target.push(offer)
    }
  }
  view.feedLastSeenAt = await latestFeedSeenAt(args.leagueId)
  return view
}

/**
 * The most recent moment the sweep confirmed it read this league's feed.
 *
 * ⚠ TAKEN ACROSS THE WHOLE LEAGUE, NOT THE VIEWER'S OWN OFFERS. A manager with no trades would
 * otherwise get null and be told nothing is known, while the league had been swept minutes
 * earlier — the absence of THEIR offers is a real answer, and this is what makes it sayable.
 */
async function latestFeedSeenAt(leagueId: string): Promise<Date | null> {
  const row = await prisma.providerTradeOffer
    .findFirst({
      where: { leagueId },
      orderBy: { lastSeenAt: 'desc' },
      select: { lastSeenAt: true },
    })
    .catch(() => null)
  return row?.lastSeenAt ?? null
}
