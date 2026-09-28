/**
 * An existing trade, normalized — the `Trade` of `docs/TRADE_EVALUATOR_DESIGN.md` ("Imported vs
 * native trades"). PURE: row shapes in, a normalized trade (or a named refusal) out. The server half
 * that reads the rows and resolves players is `./loadTrade.ts`.
 *
 * Three sources, one shape, and the engine never looks at which:
 *   - `af`       — `AfLeagueTrade` + items: the league Trades tab and the core Trade Center.
 *   - `redraft`  — `RedraftTradeProposal` + assets: the redraft tab. A SEPARATE native system with
 *                  its own roster table (`RedraftRoster`); there is no foreign key between the two.
 *   - `provider` — `ProviderTradeOffer` + assets: the stored ledger of Sleeper trades. Stored, not
 *                  scanned live: a request path does not call a provider (the DB-first rule).
 *
 * Differences from the design, flagged rather than papered over (the design says the code wins):
 *   - `status` adds `unknown` — the Sleeper ledger stores it, and mapping it to a real status would
 *     be a guess. Every source's own word is kept as `origin.rawStatus`.
 *   - A side carries `teamId` (the SOURCE's roster id) AND `rosterId` (the canonical `Roster.id`, or
 *     null when it cannot be mapped). A player asset carries its resolved `name`, because the grader
 *     prices by name (`./tradeGradeInputs.ts`).
 *   - Two teams only. The canonical evaluator grades two sides, so a multi-team trade is refused
 *     by name here rather than silently graded as two.
 */

export type TradeSource = 'af' | 'redraft' | 'provider'

export type TradeRef =
  | { kind: 'af'; tradeId: string }
  | { kind: 'redraft'; proposalId: string }
  | { kind: 'provider'; provider: 'sleeper'; providerTradeId: string }

export type TradeStatus = 'proposed' | 'accepted' | 'rejected' | 'vetoed' | 'expired' | 'completed' | 'unknown'

export type TradeOrigin = {
  source: TradeSource
  /** `native` for a trade made in AllFantasy; otherwise the host platform. */
  platform: string
  externalLeagueId: string | null
  externalTradeId: string | null
  /** Where the manager acts on an imported trade. Null for a native one. */
  deepLink: string | null
  /** When both rosters were last synced. For a native league, the load time — native is always current. */
  rostersSyncedAt: string | null
  /** The source's own status word, verbatim. */
  rawStatus: string
}

export type LoadedTradeAsset =
  | { kind: 'player'; playerId: string; name: string; position: string | null }
  | { kind: 'pick'; season: number; round: number; originalTeamId: string | null; label: string }
  | { kind: 'faab'; amount: number }

export type TradeSide = {
  /** The source's roster id: `Roster.id` (af), `RedraftRoster.id` (redraft), Sleeper `roster_id` (provider). */
  teamId: string
  /** The canonical `Roster.id`, when known. Always set for `af`; mapped for `redraft`; set later for `provider`. */
  rosterId: string | null
  gives: LoadedTradeAsset[]
}

export type LoadedTrade = {
  id: string
  leagueId: string
  sport: string
  origin: TradeOrigin
  status: TradeStatus
  sideA: TradeSide
  sideB: TradeSide
  proposedAt: string | null
  completedAt: string | null
}

export type TradeRefusalCode =
  | 'not_found'
  | 'not_member'
  | 'multi_team'
  | 'unreadable_asset'
  | 'unresolved_player'
  | 'no_assets'
  /** A pending trade's player is no longer on the roster sending him (set by `evaluateStoredTrade`). */
  | 'asset_moved'
  /** A PENDING offer between two other managers: private to them and the commissioner. */
  | 'not_party'

/** Why a trade cannot be loaded, in words a manager can act on. `missingAssets` names each one (design: `refused.missingAssets`). */
export type TradeRefusal = { code: TradeRefusalCode; reason: string; missingAssets: string[] }

/** Who is asking, in every id space a trade source uses. */
export type ViewerIdentity = {
  /** `Roster.id` — the id `AfLeagueTrade` speaks. */
  rosterId: string | null
  /** `RedraftRoster.id`, through `Roster.redraftRosterId`. */
  redraftRosterId: string | null
  /** The platform's roster id (`LeagueTeam.externalId`), for the Sleeper ledger. */
  externalTeamIds: string[]
}

/** Which side of the trade the viewer is on (null: neither), and whether they are its league's commissioner. */
export type TradeViewer = { side: 'A' | 'B' | null; isCommissioner: boolean }

export type LoadTradeResult = { ok: true; trade: LoadedTrade; viewer: TradeViewer } | { ok: false; refusal: TradeRefusal }

/** Sleeper roster ids arrive both zero-padded and not (`rosterIdMapKeys`); compare them normalized. */
export const normTeamId = (id: string) => (/^\d+$/.test(id) ? String(Number(id)) : id)

/** PURE. The viewer's ids in the id space a source uses for its teams. */
export function viewerIdsFor(source: TradeSource, viewer: ViewerIdentity): string[] {
  const ids = source === 'af' ? [viewer.rosterId] : source === 'redraft' ? [viewer.redraftRosterId] : viewer.externalTeamIds
  return ids.filter((x): x is string => typeof x === 'string' && x.length > 0).map(normTeamId)
}

/** PURE. Is the viewer one of the trade's parties? */
export function viewerIsParty(source: TradeSource, viewer: ViewerIdentity, parties: readonly (string | null | undefined)[]): boolean {
  const mine = new Set(viewerIdsFor(source, viewer))
  return parties.some((p) => typeof p === 'string' && mine.has(normTeamId(p)))
}

// ── Status ─────────────────────────────────────────────────────────────────────

const isPast = (d: Date | string | null | undefined, now: Date) => d != null && new Date(d).getTime() < now.getTime()

/**
 * `AfLeagueTrade.status`. `expired` is never WRITTEN for this table — expiry is lazy: a row stays
 * `pending` past its `expiresAt` and is refused at action time — so it is derived here.
 * `countered` and `cancelled` are both a rejection of THIS offer. `reversed` is a completed trade a
 * commissioner undid; the closest design status is `rejected`, and `rawStatus` keeps the difference.
 */
export function afTradeStatus(status: string, expiresAt: Date | string | null, now: Date): TradeStatus {
  switch (status) {
    case 'pending':
    case 'awaiting_votes':
    case 'awaiting_commissioner':
      return isPast(expiresAt, now) ? 'expired' : 'proposed'
    case 'accepted':
    case 'scheduled':
      return 'accepted'
    case 'processed':
      return 'completed'
    case 'rejected':
    case 'cancelled':
    case 'countered':
    case 'reversed':
      return 'rejected'
    case 'vetoed':
      return 'vetoed'
    case 'expired':
      return 'expired'
    default:
      return 'unknown'
  }
}

/** `RedraftTradeProposal.status`. Here `accepted` sets `processedAt` — accepted means executed. */
export function redraftTradeStatus(status: string, expiresAt: Date | string | null, now: Date): TradeStatus {
  switch (status) {
    case 'pending':
      return isPast(expiresAt, now) ? 'expired' : 'proposed'
    case 'accepted':
      return 'completed'
    case 'rejected':
    case 'cancelled':
      return 'rejected'
    case 'vetoed':
      return 'vetoed'
    case 'expired':
      return 'expired'
    default:
      return 'unknown'
  }
}

/** `ProviderTradeOffer.status`. `accepted` is Sleeper's `complete`. `vanished` left the feed unexecuted. */
export function providerTradeStatus(status: string): TradeStatus {
  switch (status) {
    case 'pending':
      return 'proposed'
    case 'accepted':
      return 'completed'
    case 'rejected':
    case 'vanished':
      return 'rejected'
    case 'expired':
      return 'expired'
    default:
      return 'unknown'
  }
}

// ── Assets ─────────────────────────────────────────────────────────────────────

/** Before player resolution: a player is only an id. */
export type RawTradeAsset =
  | { kind: 'player'; playerId: string }
  | { kind: 'pick'; season: number; round: number; originalTeamId: string | null; label: string }
  | { kind: 'faab'; amount: number }

export type RawMovement = { fromTeamId: string; toTeamId: string; asset: RawTradeAsset }

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const num = (...vs: unknown[]): number | null => {
  for (const v of vs) {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return null
}
const str = (...vs: unknown[]): string | null => {
  for (const v of vs) if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

const ORDINAL = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
export const pickLabel = (season: number, round: number) => `${season} ${ORDINAL(round)}`

/** `fdp:<season>:<round>:<originalRosterId>` (native inventory) or `pick:<season>:<round>:<rosterId>` (Chimmy). */
function parsePickRef(ref: string | null): { season: number; round: number; originalTeamId: string | null } | null {
  const m = /^(?:fdp|pick):(\d{4}):(\d{1,2})(?::(.+))?$/.exec(ref ?? '')
  return m ? { season: Number(m[1]), round: Number(m[2]), originalTeamId: m[3] ?? null } : null
}

type Unreadable = string

function pickAsset(season: number | null, round: number | null, originalTeamId: string | null, what: string): RawTradeAsset | Unreadable {
  if (season == null || round == null || round < 1) return `${what} (no season or round on record)`
  return { kind: 'pick', season, round, originalTeamId, label: pickLabel(season, round) }
}

/** An `AfLeagueTradeItem`. Players by `itemReference`; picks from metadata, then the `fdp:`/`pick:` reference. */
export function afItemAsset(item: {
  itemType: string
  itemReference: string | null
  faabAmount: number | null
  metadata: unknown
}): RawTradeAsset | Unreadable {
  const type = item.itemType.toLowerCase()
  const meta = obj(item.metadata)
  if (type === 'faab') {
    const amount = num(item.faabAmount, meta.faabAmount, meta.amount)
    return amount != null && amount > 0 ? { kind: 'faab', amount } : 'a FAAB amount (none on record)'
  }
  if (type.includes('pick')) {
    const ref = parsePickRef(item.itemReference)
    return pickAsset(
      num(meta.pickSeason, meta.season) ?? ref?.season ?? null,
      num(meta.pickRound, meta.round) ?? ref?.round ?? null,
      str(meta.originalRosterId) ?? ref?.originalTeamId ?? null,
      str(meta.pickLabel, meta.label) ?? 'a draft pick',
    )
  }
  if (type === 'player' || type === 'keeper' || type === 'devy') {
    const id = str(item.itemReference)
    return id ? { kind: 'player', playerId: id } : `${str(meta.playerName, meta.name) ?? 'a player'} (no player id on record)`
  }
  return `a ${type.replace(/_/g, ' ')} (not a priceable asset)`
}

/** A `RedraftTradeAsset`. */
export function redraftAsset(a: {
  assetType: string
  playerId: string | null
  playerName: string | null
  pickSeason: number | null
  pickRound: number | null
  metadata: unknown
}): RawTradeAsset | Unreadable {
  const type = a.assetType.toLowerCase()
  const meta = obj(a.metadata)
  if (type === 'faab') {
    const amount = num(meta.amount, meta.faab, meta.faabAmount)
    return amount != null && amount > 0 ? { kind: 'faab', amount } : 'a FAAB amount (none on record)'
  }
  if (type.includes('pick')) return pickAsset(a.pickSeason, a.pickRound, str(meta.originalRosterId), 'a draft pick')
  if (type === 'player') {
    const id = str(a.playerId)
    return id ? { kind: 'player', playerId: id } : `${str(a.playerName) ?? 'a player'} (no player id on record)`
  }
  return `a ${type.replace(/_/g, ' ')} (not a priceable asset)`
}

/** A `ProviderTradeOfferAsset`. Its `pickOriginalRosterId` is the pick's ORIGINAL owner (Sleeper `roster_id`). */
export function providerAsset(a: {
  assetType: string
  playerId: string | null
  pickSeason: number | null
  pickRound: number | null
  pickOriginalRosterId: string | null
  faabAmount: number | null
}): RawTradeAsset | Unreadable {
  const type = a.assetType.toLowerCase()
  if (type === 'faab') return a.faabAmount != null && a.faabAmount > 0 ? { kind: 'faab', amount: a.faabAmount } : 'a FAAB amount (none on record)'
  if (type === 'pick') return pickAsset(a.pickSeason, a.pickRound, str(a.pickOriginalRosterId), 'a draft pick')
  if (type === 'player') {
    const id = str(a.playerId)
    return id ? { kind: 'player', playerId: id } : 'a player (no player id on record)'
  }
  return `a ${type} (not a priceable asset)`
}

// ── Two sides out of movements ────────────────────────────────────────────────

export type RawTrade = {
  sideA: { teamId: string; gives: RawTradeAsset[] }
  sideB: { teamId: string; gives: RawTradeAsset[] }
}

/**
 * Fold per-asset movements into the design's two sides. `sideAId` is the proposer when the source
 * knows one. Refuses a trade with a third team — on either end of any movement — and one where a
 * side sends nothing.
 */
export function twoSides(
  movements: ReadonlyArray<{ fromTeamId: string | null; toTeamId: string | null; asset: RawTradeAsset | Unreadable }>,
  opts: { sideAId?: string | null; sideBId?: string | null; declaredTeamIds?: readonly string[] } = {},
): { ok: true; trade: RawTrade } | { ok: false; refusal: TradeRefusal } {
  const unreadable = movements.flatMap((m) => (typeof m.asset === 'string' ? [m.asset] : []))
  if (unreadable.length) {
    return {
      ok: false,
      refusal: {
        code: 'unreadable_asset',
        reason: `${unreadable.slice(0, 3).join(', ')} cannot be priced, so this trade is not graded.`,
        missingAssets: unreadable,
      },
    }
  }
  const teams = new Set<string>(opts.declaredTeamIds ?? [])
  for (const m of movements) {
    if (m.fromTeamId) teams.add(m.fromTeamId)
    if (m.toTeamId) teams.add(m.toTeamId)
  }
  if (opts.sideAId) teams.add(opts.sideAId)
  if (opts.sideBId) teams.add(opts.sideBId)
  if (teams.size > 2) {
    return {
      ok: false,
      refusal: {
        code: 'multi_team',
        reason: `This is a ${teams.size}-team trade; trades are graded between two teams.`,
        missingAssets: [],
      },
    }
  }
  const ordered = [...teams]
  const a = opts.sideAId ?? ordered[0]
  const b = opts.sideBId ?? ordered.find((t) => t !== a)
  if (!a || !b || movements.some((m) => !m.fromTeamId || !m.toTeamId)) {
    return { ok: false, refusal: { code: 'no_assets', reason: 'This trade does not record who sends what.', missingAssets: [] } }
  }
  const gives = (team: string) =>
    movements.filter((m) => m.fromTeamId === team).map((m) => m.asset as RawTradeAsset)
  const trade: RawTrade = { sideA: { teamId: a, gives: gives(a) }, sideB: { teamId: b, gives: gives(b) } }
  if (!trade.sideA.gives.length || !trade.sideB.gives.length) {
    return { ok: false, refusal: { code: 'no_assets', reason: 'One side of this trade sends nothing.', missingAssets: [] } }
  }
  return { ok: true, trade }
}
