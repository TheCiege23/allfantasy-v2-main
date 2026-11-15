import type { TradeOfferSource, TradeOfferStatus } from './tradeOfferCard'

/**
 * The ALERT that goes with a trade's status line in the two managers' DM (2026-11-15: "build the
 * league-moment alerts").
 *
 * 🛑 A TWO-TEAM REDRAFT OR DRAFT-PICK TRADE ENDED IN SILENCE. When it was accepted, declined, vetoed,
 * went through, was withdrawn or expired, the only record was a line under the offer card in the DM
 * (`postTradeStatusToDm`) — a system message, which raises no notification. The other manager learned
 * their offer was accepted, or vetoed, only if they happened to open that conversation. (A multi-team
 * trade has no DM card and was already told through lib/redraft/multiTeamTradeNotices.ts.)
 *
 * Only these two sources: the native trade engine, the Sleeper sweep and the Yahoo scan already send
 * their own trade alerts (lib/league-trade-engine, lib/trade-intel/tradeNotifyService), and sending
 * this beside them would tell people twice.
 *
 * Pure: the copy and the rules, testable without a database.
 */
export const TRADE_STATUS_ALERT_SOURCES: readonly TradeOfferSource[] = ['redraft', 'draft_pick']

export type TradeStatusAlert = {
  title: string
  /** Email is for an outcome; a withdrawn or expired OFFER is bell and phone only. */
  email: boolean
}

const ALERTS: Partial<Record<TradeOfferStatus, TradeStatusAlert>> = {
  accepted: { title: 'Trade accepted', email: true },
  rejected: { title: 'Trade declined', email: true },
  vetoed: { title: 'Trade vetoed', email: true },
  processed: { title: 'Trade went through', email: true },
  cancelled: { title: 'Trade offer withdrawn', email: false },
  expired: { title: 'Trade offer expired', email: false },
}

/**
 * The alert for a status, or null when there is none to send. `pending` is the offer itself (already
 * announced), and `countered` posts a NEW offer, which is announced as one.
 */
export function tradeStatusAlertFor(source: TradeOfferSource, status: TradeOfferStatus): TradeStatusAlert | null {
  if (!TRADE_STATUS_ALERT_SOURCES.includes(source)) return null
  return ALERTS[status] ?? null
}

/**
 * Who hears it: both managers in the DM, except the one who acted. Nobody is told about their own
 * accept or decline; a veto, a processed trade or an expiry has no actor among them, so both hear it.
 */
export function tradeStatusRecipients(memberUserIds: readonly string[], actorUserId: string | null | undefined): string[] {
  return [...new Set(memberUserIds)].filter((id) => typeof id === 'string' && id.length > 0 && id !== actorUserId)
}

/** Where the alert opens: the recipient's own trade link when the card has one, else the card's. */
export function tradeStatusHref(
  card: { href?: string | null; hrefs?: Record<string, string> | null; leagueId?: string | null } | null,
  userId: string,
): string {
  return card?.hrefs?.[userId] ?? card?.href ?? (card?.leagueId ? `/league/${encodeURIComponent(card.leagueId)}?view=trades` : '/app')
}
