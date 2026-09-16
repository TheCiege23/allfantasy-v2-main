import type { LeagueTradeAsset, LeagueTradeHistoryItem } from '@/components/league/types'
import type { LedgerOffer } from './providerTradeOfferReads'

/**
 * Ledger offers, in the shape the trade timeline already renders.
 *
 * ── WHAT #7 ACTUALLY NEEDED, WHICH WAS NOT A NEW SCREEN ───────────────────────────────────────
 *
 * `TradeInbox` already has the five buckets — all / needs you / sent / completed /
 * "Declined & expired" — over `activeTrades` + `historyTrades`. For an imported Sleeper league the
 * last filter was permanently empty, because `historyTrades` comes from `buildNativeTradeHistory`
 * and an imported league has no native trades, while the live scan keeps only `pending` and
 * `complete` and drops `failed` on the floor. So a declined provider offer was invisible
 * everywhere in the product, and an expired one was not knowable at all.
 *
 * The UI was starved, not missing. This is the feed.
 *
 * ⚠ SETTLED ROWS ONLY, AND PENDING IS DELIBERATELY ABSENT. `lib/core-app/trades.ts` records the
 * decision that a pending offer is read LIVE and never from a table — "a cached copy would go
 * stale the moment it was accepted" — and it is right: an offer answered on Sleeper thirty seconds
 * ago must not still be sitting in someone's inbox here. The ledger supplies what the live read
 * cannot (what BECAME of an offer); the live read keeps what the ledger cannot (what is true now).
 * Each owns a different question, so they cannot disagree.
 */

/** Ledger statuses this feed contributes. Anything else belongs to the live path. */
const SETTLED_BUCKETS = new Set(['declined', 'gone'])

function assetLabel(a: LedgerOffer['assets'][number]): LeagueTradeAsset {
  const id = [a.assetType, a.playerId, a.pickSeason, a.pickRound, a.fromRosterId, a.toRosterId]
    .filter((v) => v != null)
    .join(':')
  if (a.assetType === 'faab') {
    return { id, label: `$${a.faabAmount ?? 0} FAAB`, sublabel: null, headshotUrl: null, accent: 'orange' }
  }
  if (a.assetType === 'pick') {
    const year = a.pickSeason ?? '—'
    const round = a.pickRound ?? '—'
    return {
      id,
      label: `${year} round ${round} pick`,
      sublabel: a.pickOriginalRosterId ? `originally roster ${a.pickOriginalRosterId}` : null,
      headshotUrl: null,
      accent: 'blue',
    }
  }
  /*
   * ⚠ THE PROVIDER PLAYER ID IS THE LABEL WHEN NOTHING RESOLVES IT, AND THAT IS ON PURPOSE.
   * Dropping an unresolvable player would make a two-for-one render as a one-for-one — a trade
   * that reads as a plausible deal rather than as missing data. A visible id is ugly and honest;
   * a missing row is neither.
   */
  return {
    id,
    label: a.playerId ? `Player ${a.playerId}` : 'Unknown asset',
    sublabel: null,
    headshotUrl: null,
    accent: 'slate',
  }
}

/**
 * The status string the timeline filters on.
 *
 * 🛑 `vanished` IS PASSED THROUGH AS ITSELF RATHER THAN RELABELLED `expired`. It would have been
 * one character to make it fit the existing `isClosedStatus` list, and it would have stated a
 * cause nobody observed — the whole reason the writer keeps the two apart. The UI predicate is
 * widened to accept it instead, and it renders as "Withdrawn or expired".
 */
export function timelineStatusFor(offer: LedgerOffer): string {
  if (offer.bucket === 'declined') return 'rejected'
  if (offer.goneReason === 'expired') return 'expired'
  return 'vanished'
}

/**
 * ⚠ DIRECTION IS `complete`, NOT `incoming`/`outgoing`, AND THAT IS NOT LAZINESS. The ledger is
 * roster-keyed and Sleeper's `creator` is a USER id, so nothing here can say who proposed a
 * settled offer without a user→roster resolution that does not exist. `complete` is the type's
 * own "neither side claimed" value, already used by executed rows. Guessing a direction would
 * render a manager's own offer backwards — the same mistake the Yahoo path explicitly refuses to
 * make, in its own words: "guessing would render a manager's own outgoing offer backwards, which
 * reads as a plausible trade rather than as a bug".
 */
export function buildProviderOfferHistoryRows(args: {
  offers: LedgerOffer[]
  viewerRosterId: string
  /** Roster id → display name. Missing ids fall back to a neutral label, never to a guess. */
  teamNames: Map<string, string>
}): LeagueTradeHistoryItem[] {
  const rows: LeagueTradeHistoryItem[] = []
  for (const offer of args.offers) {
    if (!SETTLED_BUCKETS.has(offer.bucket)) continue

    const partnerId = offer.rosterIds.find((r) => r !== args.viewerRosterId) ?? null
    const sent: LeagueTradeAsset[] = []
    const received: LeagueTradeAsset[] = []
    for (const a of offer.assets) {
      if (a.fromRosterId === args.viewerRosterId) sent.push(assetLabel(a))
      else if (a.toRosterId === args.viewerRosterId) received.push(assetLabel(a))
    }

    rows.push({
      id: `provider-offer:${offer.id}`,
      direction: 'complete',
      partnerName:
        (partnerId ? args.teamNames.get(partnerId) : null) ??
        (offer.rosterIds.length > 2 ? `${offer.rosterIds.length - 1} managers` : 'Another manager'),
      /*
       * ⚠ `at` CARRIES ITS OWN PROVENANCE AND THE EMPTY STRING IS DELIBERATE. The type wants a
       * string; inventing `new Date()` for an offer with no known time would date it to the moment
       * the page was rendered, which is a fabricated timestamp in a feature whose whole point is
       * reliable ones. An empty string sorts last and renders as unknown.
       */
      timestamp: offer.at ? offer.at.toISOString() : '',
      sent,
      received,
      status: timelineStatusFor(offer),
    })
  }
  return rows
}
