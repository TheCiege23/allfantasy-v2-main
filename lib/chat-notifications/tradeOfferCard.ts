/**
 * A trade offer, as a message in the DM between the two managers.
 *
 * PURE AND BROWSER-SAFE — the trade card component imports the reader below, so nothing here may
 * touch prisma or anything `server-only`.
 *
 * Two message shapes live in `PlatformChatMessage.metadata`:
 *
 *   metadata.tradeOffer        the offer itself: both teams, what each side gives, the note, the
 *                              status, and where to open it. The card renders from this.
 *   metadata.tradeOfferStatus  a short follow-up ("Bob accepted the trade.") posted into the same
 *                              DM when the offer is answered.
 *
 * ⚠ THE MESSAGE BODY IS A COMPLETE PLAIN-TEXT VERSION OF THE CARD. Not every surface renders
 * metadata — the /messages inbox and the conversation-list preview show `body` only — so the text
 * has to stand on its own: who offered, what each side gives, the note. The card is the upgrade,
 * never the only copy.
 *
 * ⚠ READ BACK AS UNTRUSTED JSON. Metadata comes out of a JSON column any writer can reach, so the
 * reader checks every field and returns null for a malformed shape rather than throwing inside a
 * message list.
 */

export const TRADE_OFFER_META_KEY = 'tradeOffer'
export const TRADE_OFFER_STATUS_META_KEY = 'tradeOfferStatus'

export type TradeOfferSource = 'native' | 'redraft' | 'draft_pick' | 'sleeper' | 'yahoo'

export type TradeOfferStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'countered'
  | 'cancelled'
  | 'expired'
  | 'vetoed'
  | 'processed'

export const TRADE_OFFER_STATUSES: readonly TradeOfferStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'countered',
  'cancelled',
  'expired',
  'vetoed',
  'processed',
]

export type TradeOfferAsset = { label: string; detail?: string | null }

export type TradeOfferSide = {
  /** The manager's name as the league shows it. Never an email address. */
  manager: string
  team?: string | null
  /** What this side sends in the offer. */
  gives: TradeOfferAsset[]
}

export type TradeOfferCard = {
  v: 1
  source: TradeOfferSource
  tradeId: string
  leagueId: string | null
  leagueName: string | null
  proposer: TradeOfferSide
  receiver: TradeOfferSide
  note: string | null
  status: TradeOfferStatus
  /** Where "Open trade" goes when no per-viewer link exists. */
  href: string | null
  /**
   * Per-viewer links, keyed by AllFantasy user id. An imported league is one AF row PER importer,
   * so the two managers in a Sleeper offer usually open DIFFERENT league rows — a single link would
   * land one of them on a league they do not play.
   */
  hrefs?: Record<string, string> | null
  /**
   * False when the platform does not say who proposed (Yahoo). The card then names both teams
   * without claiming which one offered.
   */
  directionKnown: boolean
  /** Set for an imported league, where the offer can only be answered on the platform itself. */
  answerOn?: 'sleeper' | 'yahoo' | null
  createdAt: string
}

export type TradeOfferStatusNote = {
  source: TradeOfferSource
  tradeId: string
  status: TradeOfferStatus
  href: string | null
}

const PROVIDER_NAME: Record<'sleeper' | 'yahoo', string> = { sleeper: 'Sleeper', yahoo: 'Yahoo' }

export const TRADE_OFFER_NOTE_MAX = 500

function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function describeTradeAssets(assets: TradeOfferAsset[]): string {
  if (assets.length === 0) return 'nothing'
  return assets.map((a) => (a.detail ? `${a.label} (${a.detail})` : a.label)).join(', ')
}

/** The body of the offer message. Plain text; stands on its own without the card. */
export function buildTradeOfferMessageText(card: TradeOfferCard): string {
  const where = card.leagueName ? ` in ${card.leagueName}` : ''
  const p = card.proposer
  const r = card.receiver
  const lines: string[] = []
  if (card.directionKnown) {
    lines.push(`Trade offer${where}: ${p.manager} sent ${r.manager} a deal.`)
    lines.push(`${p.manager} gives: ${describeTradeAssets(p.gives)}.`)
    lines.push(`${r.manager} gives: ${describeTradeAssets(r.gives)}.`)
  } else {
    const provider = card.answerOn ? ` on ${PROVIDER_NAME[card.answerOn]}` : ''
    lines.push(`Trade offer pending${provider}${where} between ${p.manager} and ${r.manager}.`)
    lines.push(`${p.manager} sends: ${describeTradeAssets(p.gives)}.`)
    lines.push(`${r.manager} sends: ${describeTradeAssets(r.gives)}.`)
  }
  if (card.note) lines.push(`Note: "${card.note}"`)
  if (card.answerOn) {
    lines.push(`Answer it on ${PROVIDER_NAME[card.answerOn]} — the trade screen here has the breakdown.`)
  } else {
    lines.push('Open the trade to accept, counter or decline.')
  }
  return lines.join('\n')
}

/** The short follow-up posted when the offer is answered. */
export function buildTradeStatusMessageText(input: {
  status: TradeOfferStatus
  /** Who acted, when known. */
  actorName?: string | null
  proposerName?: string | null
  receiverName?: string | null
  /** One extra sentence, e.g. "It goes to commissioner review before it processes." */
  detail?: string | null
  answerOn?: 'sleeper' | 'yahoo' | null
}): string {
  const actor = input.actorName?.trim() || null
  const detail = input.detail?.trim() ? ` ${input.detail.trim()}` : ''
  switch (input.status) {
    case 'accepted':
      if (input.answerOn) return `Trade accepted on ${PROVIDER_NAME[input.answerOn]}.${detail}`
      return `${actor ?? input.receiverName ?? 'They'} accepted the trade.${detail}`
    case 'processed':
      return `Trade processed — rosters are updated.${detail}`
    case 'rejected':
      return `${actor ?? input.receiverName ?? 'They'} declined the trade.${detail}`
    case 'countered':
      return `${actor ?? input.receiverName ?? 'They'} countered — the new offer is below.${detail}`
    case 'cancelled':
      return `${actor ?? input.proposerName ?? 'They'} pulled the trade offer.${detail}`
    case 'expired':
      return `The trade offer expired.${detail}`
    case 'vetoed':
      return `The league vetoed this trade.${detail}`
    default:
      return `Trade update: ${input.status}.${detail}`
  }
}

function readSide(v: unknown): TradeOfferSide | null {
  const s = obj(v)
  if (!s) return null
  const manager = str(s.manager, 80)
  if (!manager) return null
  const gives: TradeOfferAsset[] = []
  if (Array.isArray(s.gives)) {
    for (const raw of s.gives as unknown[]) {
      const a = obj(raw)
      const label = str(a?.label, 120)
      if (!label) continue
      gives.push({ label, detail: str(a?.detail, 80) })
      if (gives.length >= 30) break
    }
  }
  return { manager, team: str(s.team, 80), gives }
}

function isStatus(v: unknown): v is TradeOfferStatus {
  return typeof v === 'string' && (TRADE_OFFER_STATUSES as readonly string[]).includes(v)
}

function isSource(v: unknown): v is TradeOfferSource {
  return v === 'native' || v === 'redraft' || v === 'draft_pick' || v === 'sleeper' || v === 'yahoo'
}

/** A link we are willing to render: same-origin path only. */
export function safeTradeHref(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return null
  return s.length > 500 ? null : s
}

export function readTradeOffer(meta: unknown): TradeOfferCard | null {
  const raw = obj(obj(meta)?.[TRADE_OFFER_META_KEY])
  if (!raw) return null
  const tradeId = str(raw.tradeId, 200)
  const proposer = readSide(raw.proposer)
  const receiver = readSide(raw.receiver)
  if (!tradeId || !proposer || !receiver || !isSource(raw.source)) return null
  const hrefs: Record<string, string> = {}
  const rawHrefs = obj(raw.hrefs)
  if (rawHrefs) {
    for (const [k, v] of Object.entries(rawHrefs)) {
      const h = safeTradeHref(v)
      if (h) hrefs[k] = h
    }
  }
  return {
    v: 1,
    source: raw.source,
    tradeId,
    leagueId: str(raw.leagueId, 200),
    leagueName: str(raw.leagueName, 120),
    proposer,
    receiver,
    note: str(raw.note, TRADE_OFFER_NOTE_MAX),
    status: isStatus(raw.status) ? raw.status : 'pending',
    href: safeTradeHref(raw.href),
    hrefs: Object.keys(hrefs).length ? hrefs : null,
    directionKnown: raw.directionKnown !== false,
    answerOn: raw.answerOn === 'sleeper' || raw.answerOn === 'yahoo' ? raw.answerOn : null,
    createdAt: str(raw.createdAt, 40) ?? '',
  }
}

export function readTradeOfferStatus(meta: unknown): TradeOfferStatusNote | null {
  const raw = obj(obj(meta)?.[TRADE_OFFER_STATUS_META_KEY])
  if (!raw) return null
  const tradeId = str(raw.tradeId, 200)
  if (!tradeId || !isSource(raw.source) || !isStatus(raw.status)) return null
  return { source: raw.source, tradeId, status: raw.status, href: safeTradeHref(raw.href) }
}

/** The link THIS viewer should follow. */
export function tradeOfferHrefFor(card: Pick<TradeOfferCard, 'href' | 'hrefs'>, viewerUserId?: string | null): string | null {
  if (viewerUserId && card.hrefs?.[viewerUserId]) return card.hrefs[viewerUserId]!
  return card.href
}

export const TRADE_OFFER_STATUS_LABELS: Record<TradeOfferStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Declined',
  countered: 'Countered',
  cancelled: 'Withdrawn',
  expired: 'Expired',
  vetoed: 'Vetoed',
  processed: 'Processed',
}
