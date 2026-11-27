/**
 * ESPN pending trade offers — the parse, and nothing that fetches. PURE.
 *
 * Shape authority: `contracts/espn/fixtures/fantasy-pending.NFL.2026.json` (owner capture,
 * 2026-11-27) and `fantasy_nfl_pending` in `contracts/espn/ENDPOINTS.yaml`. Never probe ESPN to
 * learn more; append to `contracts/espn/GAPS.md` instead.
 *
 * What the capture established:
 *   - `view=mPendingTransactions` is a real view. It returns a top-level `pendingTransactions` array.
 *   - `view=mTeam&view=mTransactions2` carries the same offer twice more: in
 *     `teams[].pendingTransactions` of BOTH teams involved, and in the top-level `transactions` list.
 *   - An offer is `{ id (uuid), type: 'TRADE_PROPOSAL', status: 'PENDING', teamId (proposer),
 *     proposedDate ms, expirationDate ms, teamActions {"<teamId>": "ACCEPTED"}, items[] }`.
 *   - An item is `{ type: 'TRADE' | 'DROP', playerId, fromTeamId, toTeamId, ... }`.
 *
 * 🛑 A `DROP` IS THE PROPOSER'S CONDITIONAL DROP, AND IT IS NOT A TRADED PLAYER. Its `toTeamId` is 0 —
 * no team receives him; he is released when the trade executes to make roster room. Read as a
 * `TRADE` he would be "sent to team 0", which makes a two-team offer look like a three-team one and
 * refuses the grade. Read as nothing, the proposer's real cost is silently missing from the grade.
 * It is kept as its own asset type (`drop`) so every reader has to decide what it means.
 *
 * ⚠ WHOSE OFFERS (owner rule, GAPS.md T-03): AllFantasy keeps and shows ONLY offers the reading
 * user's team sent or received. Whether ESPN shows a member offers between two OTHER teams was not
 * observable (the captured league had one offer), so `offersForTeam` filters regardless.
 */
import type { NormalizedOffer, NormalizedOfferAsset, OfferStatus } from './providerTradeOfferLedger'

export type EspnPendingItem = {
  type?: string | null
  playerId?: number | string | null
  fromTeamId?: number | string | null
  toTeamId?: number | string | null
  fromLineupSlotId?: number | null
  toLineupSlotId?: number | null
}

export type EspnPendingTransaction = {
  id?: string | null
  type?: string | null
  status?: string | null
  isPending?: boolean | null
  teamId?: number | string | null
  memberId?: string | null
  proposedDate?: number | null
  expirationDate?: number | null
  scoringPeriodId?: number | null
  teamActions?: Record<string, string> | null
  items?: EspnPendingItem[] | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** ESPN team ids are small positive integers; 0 means "no team" (a DROP's destination). */
export function espnTeamId(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? String(n) : null
}

/**
 * Every pending transaction in a league body, from whichever request produced it.
 *
 * `listed` is the proof `persistProviderTradeOffers` needs before it may retire anything: true only
 * when the body carries the top-level `pendingTransactions` ARRAY (Request 2). Request 1's lists are
 * read too, deduplicated by id, but a body without that array is never evidence that an offer is
 * gone — the capture does not show whether ESPN omits the key or sends `[]` when nothing is pending.
 */
export function readEspnPendingTransactions(body: unknown): { listed: boolean; transactions: EspnPendingTransaction[] } {
  if (!isRecord(body)) return { listed: false, transactions: [] }
  const out = new Map<string, EspnPendingTransaction>()
  const add = (raw: unknown) => {
    if (!isRecord(raw)) return
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!id || out.has(id)) return
    out.set(id, raw as EspnPendingTransaction)
  }
  const listed = Array.isArray(body.pendingTransactions)
  if (listed) for (const t of body.pendingTransactions as unknown[]) add(t)
  if (Array.isArray(body.teams)) {
    for (const team of body.teams) {
      if (isRecord(team) && Array.isArray(team.pendingTransactions)) for (const t of team.pendingTransactions) add(t)
    }
  }
  if (Array.isArray(body.transactions)) {
    for (const t of body.transactions) {
      if (isRecord(t) && String(t.type ?? '').toUpperCase() === 'TRADE_PROPOSAL') add(t)
    }
  }
  return { listed, transactions: [...out.values()] }
}

/**
 * ESPN's offer status onto ours. Only `PENDING` was observed; everything else is `unknown` rather
 * than a guess, and `providerStatus` keeps ESPN's own word.
 */
export function mapEspnOfferStatus(raw: string | null | undefined): OfferStatus {
  return String(raw ?? '').trim().toUpperCase() === 'PENDING' ? 'pending' : 'unknown'
}

const msDate = (v: unknown): Date | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? new Date(v) : null

/** One ESPN `TRADE_PROPOSAL` as a roster-neutral ledger offer, or null when it is not one. */
export function normalizeEspnTradeOffer(tx: EspnPendingTransaction): NormalizedOffer | null {
  if (String(tx.type ?? '').toUpperCase() !== 'TRADE_PROPOSAL') return null
  const providerTradeId = typeof tx.id === 'string' ? tx.id.trim() : ''
  if (!providerTradeId) return null
  const proposer = espnTeamId(tx.teamId)

  const assets: NormalizedOfferAsset[] = []
  for (const item of tx.items ?? []) {
    const kind = String(item?.type ?? '').toUpperCase()
    const playerId = item?.playerId == null ? null : String(item.playerId).trim() || null
    const from = espnTeamId(item?.fromTeamId)
    const base = { playerId, pickSeason: null, pickRound: null, pickOriginalRosterId: null, faabAmount: null }
    if (kind === 'TRADE') {
      assets.push({ assetType: 'player', ...base, fromRosterId: from, toRosterId: espnTeamId(item?.toTeamId) })
    } else if (kind === 'DROP') {
      // Released by the team that drops him; nobody receives him.
      assets.push({ assetType: 'drop', ...base, fromRosterId: from ?? proposer, toRosterId: null })
    }
  }

  const rosterIds = new Set<string>()
  if (proposer) rosterIds.add(proposer)
  for (const a of assets) {
    if (a.fromRosterId) rosterIds.add(a.fromRosterId)
    if (a.toRosterId) rosterIds.add(a.toRosterId)
  }
  const consented = Object.entries(tx.teamActions ?? {})
    .filter(([, action]) => String(action).toUpperCase() === 'ACCEPTED')
    .map(([team]) => espnTeamId(team))
    .filter((t): t is string => t != null)

  return {
    provider: 'espn',
    providerTradeId,
    status: mapEspnOfferStatus(tx.status),
    providerStatus: tx.status == null ? null : String(tx.status),
    proposedByRosterId: proposer,
    rosterIds: [...rosterIds],
    consentedRosterIds: consented,
    proposedAt: msDate(tx.proposedDate),
    expiresAt: msDate(tx.expirationDate),
    weekOrPeriod: typeof tx.scoringPeriodId === 'number' ? tx.scoringPeriodId : null,
    assets,
    payload: tx,
  }
}

/** Only offers this team sent or received (owner rule, GAPS.md T-03). */
export function offersForTeam(offers: readonly NormalizedOffer[], teamId: string | null | undefined): NormalizedOffer[] {
  const me = espnTeamId(teamId)
  if (!me) return []
  return offers.filter((o) => o.proposedByRosterId === me || o.rosterIds.includes(me))
}

/** The whole body → the offers this team may keep. */
export function parseEspnPendingOffersForTeam(body: unknown, teamId: string | null | undefined): {
  listed: boolean
  offers: NormalizedOffer[]
  /** Offers in the body that touch other teams only — counted, never kept. */
  excluded: number
} {
  const { listed, transactions } = readEspnPendingTransactions(body)
  const all = transactions.map(normalizeEspnTradeOffer).filter((o): o is NormalizedOffer => o != null)
  const offers = offersForTeam(all, teamId)
  return { listed, offers, excluded: all.length - offers.length }
}

// ── The viewer's view of a stored offer ─────────────────────────────────────

export type LedgerOfferAssetLike = {
  assetType: string
  playerId: string | null
  fromRosterId: string | null
  toRosterId: string | null
}

/**
 * A stored ESPN offer split from one team's side: what it sends, what it gets, and the conditional
 * drops of each side. The drop belongs to the side that releases the player — the viewer's own drop
 * is a cost to the viewer; the partner's drop is a cost to the partner and arrives nowhere.
 */
export function splitEspnOfferForTeam(
  assets: readonly LedgerOfferAssetLike[],
  teamId: string,
): {
  givePlayerIds: string[]
  getPlayerIds: string[]
  viewerDropIds: string[]
  partnerDropIds: string[]
  partnerTeamId: string | null
} {
  const me = espnTeamId(teamId)
  const out = { givePlayerIds: [] as string[], getPlayerIds: [] as string[], viewerDropIds: [] as string[], partnerDropIds: [] as string[], partnerTeamId: null as string | null }
  for (const a of assets) {
    const id = a.playerId?.trim()
    if (!id) continue
    const from = espnTeamId(a.fromRosterId)
    const to = espnTeamId(a.toRosterId)
    if (a.assetType === 'drop') {
      if (from === me) out.viewerDropIds.push(id)
      else {
        out.partnerDropIds.push(id)
        out.partnerTeamId ??= from
      }
      continue
    }
    if (from === me) {
      out.givePlayerIds.push(id)
      out.partnerTeamId ??= to
    } else if (to === me) {
      out.getPlayerIds.push(id)
      out.partnerTeamId ??= from
    }
  }
  return out
}

/** "and they drop Marvin Harrison Jr." / "and you drop …" — the card line for a conditional drop. */
export function espnDropLine(args: { viewerDrops: string[]; partnerDrops: string[] }): string | null {
  const list = (names: string[]) =>
    names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const parts: string[] = []
  if (args.partnerDrops.length) parts.push(`they drop ${list(args.partnerDrops)}`)
  if (args.viewerDrops.length) parts.push(`you drop ${list(args.viewerDrops)}`)
  return parts.length ? `and ${parts.join(', and ')}` : null
}
