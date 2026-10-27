/**
 * ORPHAN TEAM AUCTION — the players and future picks of an abandoned team, sold to the rest of the
 * league for FAAB in one sealed-bid round.
 *
 * The dispersal draft hands the same assets out in turns; this sells them instead, so a team that
 * wants one player badly can pay for them rather than waiting for its pick.
 *
 * The rules:
 *   sealed      every team bids on as many assets as it likes, and nobody sees another team's bids
 *               until the auction closes
 *   budget      a team's bids together cannot be more than its FAAB, so it can afford everything it
 *               could win
 *   award       highest bid first; a tie goes to the better waiver priority (the lower number), then
 *               to the bid placed first. A team pays only for what it wins, and a win it can no longer
 *               afford (FAAB spent on waivers since) is skipped so the asset goes to the next bid
 *   unsold      a player with no bid is dropped to free agency and a pick with no bid stays with the
 *               orphan team, as the dispersal draft does; the orphan team's FAAB goes to 0
 *
 * Players reach the winning team's bench (lib/dispersal-draft/nativeDispersal.ts), so a winner can end
 * up over the roster limit and must make room before its next lineup save — the same as a dispersal
 * draft or a trade.
 *
 * AF Commissioner: opening one needs the plan. An auction already open still closes on time if the
 * plan lapses, because the league has bid in it.
 *
 * Pure.
 */

/** League.settings: the current (or last) auction. Written only by lib/orphan-auction. */
export const ORPHAN_AUCTION_KEY = 'orphan_auction'
/** Roster.settings: that team's sealed bids. Each team writes only its own. */
export const ORPHAN_AUCTION_BIDS_KEY = 'orphan_auction_bids'

export const CLOSE_AFTER_HOURS = [24, 48, 72, 168] as const
export const DEFAULT_CLOSE_AFTER_HOURS = 48
export const DEFAULT_MIN_BID = 1
export const MAX_MIN_BID = 100

export type OrphanAuctionAsset = {
  id: string
  kind: 'player' | 'pick'
  sourceRosterId: string
  label: string
  playerId?: string
  position?: string
  team?: string
  /** `inventoryPickId`, the native future pick it sells. */
  pickId?: string
  pickRound?: number
  pickYear?: number
  originalOwnerRosterId?: string
}

export type OrphanAuctionAward = { assetId: string; rosterId: string; amount: number }

export type OrphanAuctionResult = {
  awards: OrphanAuctionAward[]
  /** Assets nobody won. */
  unsold: string[]
  /** Won, but no longer with the orphan team at close (moved meanwhile): not charged. */
  missing: string[]
}

export type OrphanAuction = {
  id: string
  status: 'open' | 'closed' | 'cancelled'
  sourceRosterIds: string[]
  /** Team names of the orphan teams, for the notices. */
  sourceTeamNames: string[]
  assets: OrphanAuctionAsset[]
  minBid: number
  openedAt: string
  openedBy: string
  closesAt: string
  closedAt?: string | null
  result?: OrphanAuctionResult | null
}

/** A team's sealed bids: asset id → whole dollars. */
export type OrphanAuctionBids = { auctionId: string; bids: Record<string, number>; updatedAt: string }

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

export function readOrphanAuction(settings: unknown): OrphanAuction | null {
  const raw = asObject(asObject(settings)?.[ORPHAN_AUCTION_KEY])
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.assets)) return null
  if (raw.status !== 'open' && raw.status !== 'closed' && raw.status !== 'cancelled') return null
  return raw as unknown as OrphanAuction
}

/** A team's bids for this auction; bids for an earlier one read as none. */
export function readOrphanAuctionBids(rosterSettings: unknown, auctionId: string): OrphanAuctionBids | null {
  const raw = asObject(asObject(rosterSettings)?.[ORPHAN_AUCTION_BIDS_KEY])
  if (!raw || raw.auctionId !== auctionId) return null
  const bids = asObject(raw.bids) ?? {}
  const clean: Record<string, number> = {}
  for (const [k, v] of Object.entries(bids)) if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v
  return { auctionId, bids: clean, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString() }
}

export const isAuctionOpen = (a: OrphanAuction | null, now: Date): boolean =>
  Boolean(a && a.status === 'open' && Date.parse(a.closesAt) > now.getTime())

/** Open, and its closing time has passed: ready to award. */
export const isAuctionDue = (a: OrphanAuction | null, now: Date): boolean =>
  Boolean(a && a.status === 'open' && Date.parse(a.closesAt) <= now.getTime())

export type BidIssue = 'AUCTION_CLOSED' | 'UNKNOWN_ASSET' | 'NOT_WHOLE_DOLLARS' | 'BELOW_MIN_BID' | 'OVER_BUDGET'

/**
 * A team's bids as it sends them, checked. Empty and zero-or-missing entries mean "no bid" and are
 * dropped (unless the minimum is $0, when an explicit 0 is a bid).
 */
export function checkBids(input: {
  auction: OrphanAuction
  raw: unknown
  budget: number
  now: Date
}): { ok: true; bids: Record<string, number>; total: number } | { ok: false; issue: BidIssue; assetId?: string } {
  if (!isAuctionOpen(input.auction, input.now)) return { ok: false, issue: 'AUCTION_CLOSED' }
  const raw = asObject(input.raw) ?? {}
  const known = new Set(input.auction.assets.map((a) => a.id))
  const bids: Record<string, number> = {}
  for (const [assetId, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === '') continue
    if (!known.has(assetId)) return { ok: false, issue: 'UNKNOWN_ASSET', assetId }
    const amount = typeof value === 'number' ? value : Number(value)
    if (!Number.isInteger(amount) || amount < 0) return { ok: false, issue: 'NOT_WHOLE_DOLLARS', assetId }
    if (amount === 0 && input.auction.minBid > 0) continue
    if (amount < input.auction.minBid) return { ok: false, issue: 'BELOW_MIN_BID', assetId }
    bids[assetId] = amount
  }
  const total = Object.values(bids).reduce((s, n) => s + n, 0)
  if (total > Math.max(0, Math.floor(input.budget))) return { ok: false, issue: 'OVER_BUDGET' }
  return { ok: true, bids, total }
}

export type BidderAtClose = {
  rosterId: string
  bids: Record<string, number>
  /** When the team last saved its bids; the earlier one wins a tie on equal priority. */
  updatedAt: string
  /** FAAB at close. */
  budget: number
  /** Waiver priority: the lower number wins a tie. Null sorts last. */
  waiverPriority: number | null
}

/**
 * Who wins what. Highest bid first, then waiver priority, then the earlier bid, then the roster id so
 * the result never depends on read order. A team that can no longer afford a win (its FAAB fell since
 * it bid) is skipped for that asset, which then goes to the next bid.
 */
export function resolveOrphanAuction(input: {
  auction: OrphanAuction
  bidders: readonly BidderAtClose[]
}): Omit<OrphanAuctionResult, 'missing'> {
  const known = new Set(input.auction.assets.map((a) => a.id))
  const source = new Set(input.auction.sourceRosterIds)
  const rows = input.bidders
    .filter((b) => !source.has(b.rosterId))
    .flatMap((b) =>
      Object.entries(b.bids)
        .filter(([assetId, amount]) => known.has(assetId) && Number.isInteger(amount) && amount >= input.auction.minBid)
        .map(([assetId, amount]) => ({ assetId, amount, bidder: b })),
    )
  rows.sort(
    (x, y) =>
      y.amount - x.amount ||
      (x.bidder.waiverPriority ?? Number.MAX_SAFE_INTEGER) - (y.bidder.waiverPriority ?? Number.MAX_SAFE_INTEGER) ||
      Date.parse(x.bidder.updatedAt) - Date.parse(y.bidder.updatedAt) ||
      (x.bidder.rosterId < y.bidder.rosterId ? -1 : x.bidder.rosterId > y.bidder.rosterId ? 1 : 0) ||
      (x.assetId < y.assetId ? -1 : x.assetId > y.assetId ? 1 : 0),
  )
  const left = new Map(input.bidders.map((b) => [b.rosterId, Math.max(0, Math.floor(b.budget))]))
  const sold = new Map<string, OrphanAuctionAward>()
  for (const r of rows) {
    if (sold.has(r.assetId)) continue
    const budget = left.get(r.bidder.rosterId) ?? 0
    if (r.amount > budget) continue
    left.set(r.bidder.rosterId, budget - r.amount)
    sold.set(r.assetId, { assetId: r.assetId, rosterId: r.bidder.rosterId, amount: r.amount })
  }
  return {
    awards: input.auction.assets.map((a) => sold.get(a.id)).filter((x): x is OrphanAuctionAward => Boolean(x)),
    unsold: input.auction.assets.filter((a) => !sold.has(a.id)).map((a) => a.id),
  }
}

const list = (names: readonly string[], es: boolean) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${es ? 'y' : 'and'} ${names[names.length - 1]}`

const dateText = (iso: string, es: boolean) =>
  new Date(iso).toLocaleString(es ? 'es-US' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })

/** Notice to every bidding team when the commissioner opens the auction. */
export function openNotice(input: { teams: readonly string[]; assets: number; closesAt: string; leagueName: string }) {
  const teams = { en: list(input.teams, false), es: list(input.teams, true) }
  return {
    title: { en: `Orphan auction open in ${input.leagueName}`, es: `Subasta de equipo huérfano abierta en ${input.leagueName}` },
    body: {
      en: `${input.assets} players and picks from ${teams.en} are up for sealed FAAB bids until ${dateText(input.closesAt, false)}. Highest bid wins each one.`,
      es: `${input.assets} jugadores y selecciones de ${teams.es} están en subasta con ofertas FAAB secretas hasta ${dateText(input.closesAt, true)}. La oferta más alta gana cada uno.`,
    },
  }
}

/** Notice to each bidding team when the auction closes: what it won and what it paid. */
export function resultNotice(input: { won: readonly { label: string; amount: number }[]; leagueName: string }) {
  if (input.won.length === 0) {
    return {
      title: { en: `Orphan auction closed in ${input.leagueName}`, es: `Cerró la subasta de equipo huérfano en ${input.leagueName}` },
      body: {
        en: 'You were outbid on everything you bid for, so no FAAB was spent. See every winning bid on the Waivers page.',
        es: 'Otras ofertas superaron todas las tuyas, así que no gastaste FAAB. Puedes ver cada oferta ganadora en la página de agentes libres.',
      },
    }
  }
  const paid = input.won.reduce((s, w) => s + w.amount, 0)
  const items = input.won.map((w) => `${w.label} ($${w.amount})`)
  return {
    title: { en: `You won ${input.won.length} in the orphan auction`, es: `Ganaste ${input.won.length} en la subasta de equipo huérfano` },
    body: {
      en: `${list(items, false)}: $${paid} of FAAB in all. Players are on your ${input.leagueName} bench; if your roster is over the limit, drop a player before your next lineup save.`,
      es: `${list(items, true)}: $${paid} de FAAB en total. Los jugadores están en tu banca en ${input.leagueName}; si tu plantilla pasa del límite, suelta a un jugador antes de guardar tu próxima alineación.`,
    },
  }
}
