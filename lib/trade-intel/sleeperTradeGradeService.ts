import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { GRADE_THRESHOLDS, TIE_BAND, letterFor, type GradeLetter } from '@/lib/trade-intel/gradeScale'
import { sleeperGet } from '@/lib/trade-intel/sleeperTradeSync'
import {
  getSeasonStatsBoard,
  getWeekStatsBoard,
  scoreStatLine,
  type SeasonStatsBoard,
} from '@/lib/sports-data/sleeperMarketService'

/**
 * sleeperTradeGradeService v2 — retroactive + evolving trade grades over the
 * league's WHOLE life, now TENURE-AWARE (roster churn netted out).
 *
 * v1 credited an asset's full-season points for every season after the trade.
 * v2 credits points ONLY while the asset actually stayed on the acquiring
 * roster: the full transaction feed (trades, waivers, free-agent cuts) across
 * every season is scanned for the first event that removed the player from
 * that roster — a later cut or re-trade stops the clock at that week, and the
 * weeks actually held are scored from real weekly stat lines. Rules, all
 * stated in the payload/UI:
 *  - Credit runs from the trade week (inclusive) to the week before departure;
 *    a full season held = that season's total.
 *  - First stint only: if a manager re-acquires the same player later, that
 *    new stint belongs to the later transaction, not this grade.
 *  - Redraft leagues grade the trade season only (rosters reset, so there is
 *    nothing real to credit afterwards); dynasty/keeper leagues grade every
 *    season until departure.
 *  - Traded picks resolve to the player actually drafted; his clock starts at
 *    his draft season and stops the same way. A pick that was flipped again
 *    before the draft (drafting roster ≠ this trade's receiver) is labeled,
 *    not guessed.
 *  - Injury impact = games missed of 17 (proxy); playoffs = bracket fact.
 *
 * The letter scale ships in the payload — every grade is recomputable from
 * the numbers shown next to it. The current season grades as partial and
 * re-grades on every 6h cache refresh, so current and future trades get the
 * same treatment automatically, forever.
 */

const CACHE_PREFIX = 'trade-grades:v2:'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_CHAIN = 12
const MAX_WEEKS = 18
const SEASON_GAMES = 17

// Provider reads live in the sync module (DB-first boundary): this service owns
// grading, not how league data is fetched.
const j = sleeperGet

// ── Wire types (consumed subset) ─────────────────────────────────────────────
type WireLeague = {
  league_id: string
  name: string
  season: string
  status: string
  previous_league_id?: string | null
}
type WireUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}
type WireRoster = { roster_id: number; owner_id: string | null }
type WireBracketNode = { t1?: number | null; t2?: number | null }
type WireTransaction = {
  transaction_id: string
  type: string
  status: string
  leg: number
  created: number
  roster_ids?: number[] | null
  adds?: Record<string, number> | null
  drops?: Record<string, number> | null
  draft_picks?:
    | { season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number }[]
    | null
}
type WireDraft = {
  draft_id: string
  season: string
  status: string
  slot_to_roster_id?: Record<string, number> | null
}
type WireDraftPick = {
  round: number
  draft_slot: number
  player_id?: string | null
  picked_by?: string | null
  metadata?: {
    first_name?: string | null
    last_name?: string | null
    position?: string | null
  } | null
}

// ── Payload types ────────────────────────────────────────────────────────────
export type { GradeLetter } from '@/lib/trade-intel/gradeScale'

export type AssetDeparture = {
  season: string
  week: number
  via: 'dropped' | 'traded'
}

export type TradeAsset = {
  playerId: string
  name: string
  position: string | null
  /** Full-season totals for reference (league-scored). */
  pointsBySeason: Record<string, number>
  /** Points credited to THIS grade — only weeks the asset was actually held. */
  creditedBySeason: Record<string, number>
  /** How/when the asset left the acquiring roster; null = still there (or season over in redraft). */
  departed: AssetDeparture | null
  gamesMissedBySeason: Record<string, number | null>
}

export type TradePickAsset = {
  season: string
  round: number
  originalRosterId: number
  label: string
  resolved: {
    playerId: string
    name: string
    position: string | null
    creditedBySeason: Record<string, number>
    departed: AssetDeparture | null
  } | null
  pending: boolean
  /** Pick changed hands again before the draft — outcome belongs to a later trade. */
  rerouted: boolean
}

export type TradeSideGrade = {
  rosterId: number
  ownerId: string | null
  managerName: string
  teamName: string | null
  avatar: string | null
  playersIn: TradeAsset[]
  playersOut: TradeAsset[]
  picksIn: TradePickAsset[]
  picksOut: TradePickAsset[]
  madePlayoffs: boolean | null
  seasonNets: { season: string; net: number; partial: boolean }[]
  cumulativeNet: number
  initialGrade: GradeLetter
  currentGrade: GradeLetter
  trend: 'improving' | 'worsening' | 'steady'
}

export type GradedTrade = {
  id: string
  season: string
  week: number
  createdIso: string
  multiTeam: boolean
  tie: boolean
  sides: TradeSideGrade[]
  hasPendingPicks: boolean
}

export type TradeGradesPayload = {
  version: 2
  fetchedAt: string
  staleAsOf: string | null
  sleeperLeagueId: string
  seasonsScanned: string[]
  currentSeasonPartial: boolean
  gradeScale: {
    description: string
    thresholds: { letter: GradeLetter; minAvgNetPerSeason: number | null }[]
    tieBand: number
  }
  contextNotes: string[]
  trades: GradedTrade[]
  missing: string[]
}

// Scale lives in gradeScale.ts so a projection can score on identical bands
// without importing this server-only module. Re-exported for existing callers.

// ── Chain + season collection ────────────────────────────────────────────────
type SeasonData = {
  idx: number
  leagueId: string
  season: string
  complete: boolean
  users: Map<string, WireUser>
  rosterOwner: Map<number, string | null>
  ownerRoster: Map<string, number>
  playoffRosters: Set<number> | null
  trades: WireTransaction[]
  /** Every completed transaction that removed players from rosters (for departure detection). */
  events: { created: number; week: number; type: string; drops: Record<string, number> }[]
  draftPickResolver: ((round: number, originalRosterId: number) => WireDraftPick | null) | null
}

async function collectSeason(league: WireLeague, idx: number, missing: string[]): Promise<SeasonData> {
  const id = league.league_id
  const weekFetches = Array.from({ length: MAX_WEEKS }, (_, i) =>
    j<WireTransaction[]>(`/league/${id}/transactions/${i + 1}`),
  )
  const [users, rosters, bracket, drafts, ...weeks] = await Promise.all([
    j<WireUser[]>(`/league/${id}/users`),
    j<WireRoster[]>(`/league/${id}/rosters`),
    j<WireBracketNode[]>(`/league/${id}/winners_bracket`),
    j<WireDraft[]>(`/league/${id}/drafts`),
    ...weekFetches,
  ])
  if (!users) missing.push(`${league.season}: managers`)
  if (!rosters) missing.push(`${league.season}: rosters`)

  const trades: WireTransaction[] = []
  const events: SeasonData['events'] = []
  let weeksMissing = 0
  weeks.forEach((w) => {
    if (!w) {
      weeksMissing += 1
      return
    }
    for (const t of w) {
      if (t.status !== 'complete') continue
      if (t.type === 'trade') trades.push(t)
      if (t.drops && Object.keys(t.drops).length > 0) {
        events.push({
          created: t.created,
          week: Math.min(Math.max(t.leg || 1, 1), MAX_WEEKS),
          type: t.type,
          drops: t.drops,
        })
      }
    }
  })
  if (weeksMissing === MAX_WEEKS) missing.push(`${league.season}: transactions`)
  events.sort((a, b) => a.created - b.created)

  const playoffRosters = bracket
    ? new Set(bracket.flatMap((n) => [n.t1, n.t2]).filter((x): x is number => typeof x === 'number'))
    : null

  let draftPickResolver: SeasonData['draftPickResolver'] = null
  const draft = (drafts ?? []).find((d) => d.status === 'complete') ?? (drafts ?? [])[0] ?? null
  if (draft) {
    const picks = await j<WireDraftPick[]>(`/draft/${draft.draft_id}/picks`)
    const slotToRoster = draft.slot_to_roster_id ?? null
    if (picks && slotToRoster) {
      const rosterToSlot = new Map<number, number>()
      for (const [slot, rosterId] of Object.entries(slotToRoster)) rosterToSlot.set(rosterId, Number(slot))
      const bySlot = new Map<string, WireDraftPick>()
      for (const p of picks) bySlot.set(`${p.round}:${p.draft_slot}`, p)
      draftPickResolver = (round, originalRosterId) => {
        const slot = rosterToSlot.get(originalRosterId)
        if (slot == null) return null
        return bySlot.get(`${round}:${slot}`) ?? null
      }
    }
  }

  return {
    idx,
    leagueId: id,
    season: league.season,
    complete: String(league.status).toLowerCase() === 'complete',
    users: new Map((users ?? []).map((u) => [u.user_id, u])),
    rosterOwner: new Map((rosters ?? []).map((r) => [r.roster_id, r.owner_id ?? null])),
    ownerRoster: new Map(
      (rosters ?? [])
        .filter((r): r is WireRoster & { owner_id: string } => typeof r.owner_id === 'string')
        .map((r) => [r.owner_id, r.roster_id]),
    ),
    playoffRosters,
    trades,
    events,
    draftPickResolver,
  }
}

// ── Tenure windows ───────────────────────────────────────────────────────────
type SeasonWindow = { season: string; mode: 'full' | 'weeks'; from: number; to: number; partial: boolean }

/**
 * Which weeks of which graded seasons does this stint cover?
 * start = (startIdx, startWeek); departure stops the clock the week before.
 */
function stintWindows(
  seasons: SeasonData[],
  startIdx: number,
  startWeek: number,
  departure: { idx: number; week: number } | null,
  dynastyLike: boolean,
): SeasonWindow[] {
  const windows: SeasonWindow[] = []
  for (const s of seasons) {
    if (s.idx < startIdx) continue
    if (!dynastyLike && s.idx > startIdx) break
    if (departure && s.idx > departure.idx) break
    const from = s.idx === startIdx ? startWeek : 1
    const to = departure && departure.idx === s.idx ? departure.week - 1 : MAX_WEEKS
    if (to < from) continue
    windows.push({
      season: s.season,
      mode: from <= 1 && to >= MAX_WEEKS ? 'full' : 'weeks',
      from,
      to,
      partial: !s.complete,
    })
  }
  return windows
}

// ── Build ────────────────────────────────────────────────────────────────────
async function buildTradeGrades(sleeperLeagueId: string): Promise<TradeGradesPayload | null> {
  const missing: string[] = []
  const context = await getLeagueContext(sleeperLeagueId)
  if (!context) return null
  const scoring = context.scoring.settings
  const format = context.scoring.format
  const dynastyLike = context.variant.dynasty || context.variant.keeper

  const chain: WireLeague[] = []
  let cursor: string | null = sleeperLeagueId
  for (let i = 0; i < MAX_CHAIN && cursor; i += 1) {
    // Explicit annotation breaks a circular inference: `cursor` builds the URL
    // that yields `league`, and `league.previous_league_id` reassigns `cursor`.
    const league: WireLeague | null = await j<WireLeague>(`/league/${cursor}`)
    if (!league) {
      missing.push('part of the league chain (an older season did not load)')
      break
    }
    chain.unshift(league)
    cursor = league.previous_league_id ?? null
  }
  if (chain.length === 0) return null

  const seasons: SeasonData[] = []
  for (let i = 0; i < chain.length; i += 1) {
    seasons.push(await collectSeason(chain[i], i, missing))
  }
  const seasonByYear = new Map(seasons.map((s) => [s.season, s]))
  const currentSeasonPartial = !seasons[seasons.length - 1].complete

  // Season totals (full-season reference + full-season windows).
  const seasonBoards = new Map<string, SeasonStatsBoard>()
  for (const s of seasons) {
    const board = await getSeasonStatsBoard(s.season, s.complete)
    if (board) seasonBoards.set(s.season, board)
    else missing.push(`${s.season}: season stats`)
  }

  const seasonPoints = (playerId: string, season: string): number | null => {
    const row = seasonBoards.get(season)?.players[playerId]
    if (!row) return null
    return Math.round(scoreStatLine(row.stats, scoring, format).points * 10) / 10
  }
  const gamesMissed = (playerId: string, season: string): number | null => {
    const gp = seasonBoards.get(season)?.players[playerId]?.stats.gp
    if (typeof gp !== 'number') return null
    return Math.max(0, SEASON_GAMES - Math.round(gp))
  }
  const nameFor = (playerId: string): { name: string; position: string | null } => {
    for (const board of seasonBoards.values()) {
      const row = board.players[playerId]
      if (row) return { name: row.name, position: row.position }
    }
    return { name: `Player ${playerId}`, position: null }
  }

  // Departure: earliest event after (idx, created) where this roster dropped the player.
  const findDeparture = (
    playerId: string,
    rosterId: number,
    fromIdx: number,
    fromCreated: number,
  ): { idx: number; departure: AssetDeparture } | null => {
    for (const s of seasons) {
      if (s.idx < fromIdx) continue
      for (const e of s.events) {
        if (s.idx === fromIdx && e.created <= fromCreated) continue
        if (e.drops[playerId] === rosterId) {
          return {
            idx: s.idx,
            departure: { season: s.season, week: e.week, via: e.type === 'trade' ? 'traded' : 'dropped' },
          }
        }
      }
    }
    return null
  }

  // ── Pass 1: enumerate every stint so weekly boards can be prefetched ──
  type Stint = {
    playerId: string
    windows: SeasonWindow[]
    departure: AssetDeparture | null
  }
  const stintCache = new Map<string, Stint>()
  const weeklyNeeds = new Map<string, Set<number>>() // season → weeks

  const stintFor = (
    playerId: string,
    rosterId: number,
    startIdx: number,
    startWeek: number,
    startCreated: number,
  ): Stint => {
    const key = `${playerId}:${rosterId}:${startIdx}:${startWeek}:${startCreated}`
    const cached = stintCache.get(key)
    if (cached) return cached
    const dep = findDeparture(playerId, rosterId, startIdx, startCreated)
    // `findDeparture` returns { idx, departure: AssetDeparture }, but
    // `stintWindows` only needs { idx, week } — project rather than widening its
    // signature, so the window logic stays independent of AssetDeparture's shape.
    const windows = stintWindows(
      seasons,
      startIdx,
      startWeek,
      dep ? { idx: dep.idx, week: dep.departure.week } : null,
      dynastyLike,
    )
    for (const w of windows) {
      if (w.mode !== 'weeks') continue
      const set = weeklyNeeds.get(w.season) ?? new Set<number>()
      for (let wk = w.from; wk <= w.to; wk += 1) set.add(wk)
      weeklyNeeds.set(w.season, set)
    }
    const stint: Stint = { playerId, windows, departure: dep?.departure ?? null }
    stintCache.set(key, stint)
    return stint
  }

  type PendingSide = {
    seasonData: SeasonData
    t: WireTransaction
    rosterId: number
    playerStintsIn: { playerId: string; stint: Stint }[]
    playerStintsOut: { playerId: string; stint: Stint }[]
    pickStintsIn: { p: NonNullable<WireTransaction['draft_picks']>[number]; resolved: WireDraftPick | null; stint: Stint | null; rerouted: boolean }[]
    pickStintsOut: { p: NonNullable<WireTransaction['draft_picks']>[number]; resolved: WireDraftPick | null; stint: Stint | null; rerouted: boolean }[]
  }

  const resolvePick = (
    p: NonNullable<WireTransaction['draft_picks']>[number],
    receivingRosterId: number,
  ): { resolved: WireDraftPick | null; stint: Stint | null; rerouted: boolean } => {
    const landing = seasonByYear.get(p.season)
    const pick = landing?.draftPickResolver?.(p.round, p.roster_id) ?? null
    if (!pick?.player_id || !landing) return { resolved: null, stint: null, rerouted: false }
    const drafterRoster = pick.picked_by ? landing.ownerRoster.get(pick.picked_by) ?? null : null
    if (drafterRoster == null || drafterRoster !== receivingRosterId) {
      // The pick moved again before the draft — its outcome belongs to a later trade.
      return { resolved: pick, stint: null, rerouted: true }
    }
    return {
      resolved: pick,
      stint: stintFor(pick.player_id, drafterRoster, landing.idx, 1, 0),
      rerouted: false,
    }
  }

  const pendingSides: PendingSide[][] = []
  for (const seasonData of seasons) {
    for (const t of seasonData.trades) {
      const rosterIds = t.roster_ids ?? []
      if (rosterIds.length === 0) continue
      const tradeWeek = Math.min(Math.max(t.leg || 1, 1), MAX_WEEKS)
      const sides: PendingSide[] = rosterIds.map((rosterId) => ({
        seasonData,
        t,
        rosterId,
        playerStintsIn: Object.entries(t.adds ?? {})
          .filter(([, r]) => r === rosterId)
          .map(([pid]) => ({
            playerId: pid,
            stint: stintFor(pid, rosterId, seasonData.idx, tradeWeek, t.created),
          })),
        // OUT value = what the player did for the roster that RECEIVED him.
        playerStintsOut: Object.entries(t.drops ?? {})
          .filter(([, r]) => r === rosterId)
          .map(([pid]) => {
            const receiver = t.adds?.[pid]
            return {
              playerId: pid,
              stint:
                receiver != null
                  ? stintFor(pid, receiver, seasonData.idx, tradeWeek, t.created)
                  : stintFor(pid, rosterId, seasonData.idx, tradeWeek, t.created),
            }
          }),
        pickStintsIn: (t.draft_picks ?? [])
          .filter((p) => p.owner_id === rosterId)
          .map((p) => ({ p, ...resolvePick(p, rosterId) })),
        pickStintsOut: (t.draft_picks ?? [])
          .filter((p) => p.previous_owner_id === rosterId)
          .map((p) => ({ p, ...resolvePick(p, p.owner_id) })),
      }))
      pendingSides.push(sides)
    }
  }

  // ── Prefetch weekly boards for every partial window ──
  const weekBoards = new Map<string, SeasonStatsBoard>() // `${season}:${week}`
  for (const [season, weeks] of weeklyNeeds) {
    const complete = seasonByYear.get(season)?.complete ?? true
    const fetched = await Promise.all(
      [...weeks].map(async (wk) => ({ wk, board: await getWeekStatsBoard(season, wk, complete) })),
    )
    let anyMissing = false
    for (const { wk, board } of fetched) {
      if (board) weekBoards.set(`${season}:${wk}`, board)
      else anyMissing = true
    }
    if (anyMissing) missing.push(`${season}: some weekly stat lines`)
  }

  const creditedFor = (playerId: string, windows: SeasonWindow[]): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const w of windows) {
      if (w.mode === 'full') {
        const pts = seasonPoints(playerId, w.season)
        if (pts != null) out[w.season] = pts
        continue
      }
      let sum = 0
      let any = false
      for (let wk = w.from; wk <= w.to; wk += 1) {
        const row = weekBoards.get(`${w.season}:${wk}`)?.players[playerId]
        if (!row) continue
        sum += scoreStatLine(row.stats, scoring, format).points
        any = true
      }
      if (any) out[w.season] = Math.round(sum * 10) / 10
    }
    return out
  }

  // ── Pass 2: assemble graded trades ──
  const trades: GradedTrade[] = []
  const byTrade = new Map<string, PendingSide[]>()
  for (const sides of pendingSides) {
    if (sides.length > 0) byTrade.set(`${sides[0].seasonData.leagueId}:${sides[0].t.transaction_id}`, sides)
  }

  for (const [id, sides] of byTrade) {
    const { seasonData, t } = sides[0]
    const gradedSeasonYears = seasons
      .filter((s) => s.idx >= seasonData.idx && (dynastyLike || s.idx === seasonData.idx))
      .map((s) => ({ season: s.season, partial: !s.complete }))

    const toAsset = (playerId: string, stint: Stint): TradeAsset => {
      const meta = nameFor(playerId)
      const pointsBySeason: Record<string, number> = {}
      const gamesMissedBySeason: Record<string, number | null> = {}
      for (const g of gradedSeasonYears) {
        const pts = seasonPoints(playerId, g.season)
        if (pts != null) pointsBySeason[g.season] = pts
        gamesMissedBySeason[g.season] = gamesMissed(playerId, g.season)
      }
      return {
        playerId,
        ...meta,
        pointsBySeason,
        creditedBySeason: creditedFor(playerId, stint.windows),
        departed: stint.departure,
        gamesMissedBySeason,
      }
    }

    const toPickAsset = (
      entry: PendingSide['pickStintsIn'][number],
    ): TradePickAsset => {
      const { p, resolved, stint, rerouted } = entry
      const label = `${p.season} round ${p.round}`
      if (!resolved?.player_id) {
        return { season: p.season, round: p.round, originalRosterId: p.roster_id, label, resolved: null, pending: true, rerouted: false }
      }
      const meta = nameFor(resolved.player_id)
      const name =
        [resolved.metadata?.first_name, resolved.metadata?.last_name].filter(Boolean).join(' ').trim() ||
        meta.name
      return {
        season: p.season,
        round: p.round,
        originalRosterId: p.roster_id,
        label,
        resolved: {
          playerId: resolved.player_id,
          name,
          position: resolved.metadata?.position?.toUpperCase() ?? meta.position,
          creditedBySeason: stint ? creditedFor(resolved.player_id, stint.windows) : {},
          departed: stint?.departure ?? null,
        },
        pending: false,
        rerouted,
      }
    }

    const gradedSides: TradeSideGrade[] = sides.map((side) => {
      const ownerId = side.seasonData.rosterOwner.get(side.rosterId) ?? null
      const user = ownerId ? side.seasonData.users.get(ownerId) : undefined
      const playersIn = side.playerStintsIn.map((x) => toAsset(x.playerId, x.stint))
      const playersOut = side.playerStintsOut.map((x) => toAsset(x.playerId, x.stint))
      const picksIn = side.pickStintsIn.map(toPickAsset)
      const picksOut = side.pickStintsOut.map(toPickAsset)

      const seasonNets = gradedSeasonYears.map((g) => {
        const sum = (assets: TradeAsset[]) =>
          assets.reduce((acc, a) => acc + (a.creditedBySeason[g.season] ?? 0), 0)
        const sumPicks = (picks: TradePickAsset[]) =>
          picks.reduce((acc, p) => acc + (p.resolved?.creditedBySeason[g.season] ?? 0), 0)
        const net = sum(playersIn) + sumPicks(picksIn) - sum(playersOut) - sumPicks(picksOut)
        return { season: g.season, net: Math.round(net * 10) / 10, partial: g.partial }
      })
      const cumulativeNet = Math.round(seasonNets.reduce((acc, s) => acc + s.net, 0) * 10) / 10
      const initialGrade = letterFor(seasonNets[0]?.net ?? 0)
      const currentGrade = letterFor(cumulativeNet / Math.max(1, seasonNets.length))
      let trend: TradeSideGrade['trend'] = 'steady'
      if (seasonNets.length >= 2) {
        const last = seasonNets[seasonNets.length - 1].net
        const prev = seasonNets[seasonNets.length - 2].net
        if (last > prev + 15) trend = 'improving'
        else if (last < prev - 15) trend = 'worsening'
      }

      return {
        rosterId: side.rosterId,
        ownerId,
        managerName: user?.display_name ?? 'Manager',
        teamName: user?.metadata?.team_name?.trim() || null,
        avatar: user?.avatar ?? null,
        playersIn,
        playersOut,
        picksIn,
        picksOut,
        madePlayoffs: side.seasonData.playoffRosters
          ? side.seasonData.playoffRosters.has(side.rosterId)
          : null,
        seasonNets,
        cumulativeNet,
        initialGrade,
        currentGrade,
        trend,
      }
    })

    const maxAbs = Math.max(...gradedSides.map((s) => Math.abs(s.cumulativeNet)), 0)
    trades.push({
      id,
      season: seasonData.season,
      week: Math.min(Math.max(t.leg || 1, 1), MAX_WEEKS),
      createdIso: new Date(t.created).toISOString(),
      multiTeam: (t.roster_ids ?? []).length > 2,
      tie: maxAbs <= TIE_BAND,
      sides: gradedSides,
      hasPendingPicks: gradedSides.some((s) =>
        [...s.picksIn, ...s.picksOut].some((p) => p.pending || p.rerouted),
      ),
    })
  }
  trades.sort((a, b) => b.createdIso.localeCompare(a.createdIso))

  const contextNotes: string[] = [
    `Points are credited ONLY while an asset stayed on the acquiring roster — a later cut or re-trade stops the clock that week (first stint only). Scored with this league's real settings${context.variant.idp ? ' (IDP stats included)' : ''}.`,
    dynastyLike
      ? 'Dynasty/keeper league: grades keep accruing every season until the asset departs.'
      : 'Redraft league: rosters reset each year, so each trade is graded on its own season only.',
    'Injury impact = games missed of a 17-game season (a counted proxy, not a medical report).',
  ]
  if (context.houseRules.pirate?.active) {
    contextNotes.push(
      'Pirate rules declared: weekly floor and roster spread matter more here than raw totals — read C-grade ties with that lens.',
    )
  }

  return {
    version: 2,
    fetchedAt: new Date().toISOString(),
    staleAsOf: null,
    sleeperLeagueId,
    seasonsScanned: seasons.map((s) => s.season),
    currentSeasonPartial,
    gradeScale: {
      description:
        'Average net credited points per graded season (points in − points out, only while held, incl. resolved picks). Recompute any letter from the numbers shown.',
      // Same constant letterFor() branches on, so the published scale can never
      // describe different bands than the one that produced the letters.
      thresholds: GRADE_THRESHOLDS,
      tieBand: TIE_BAND,
    },
    contextNotes,
    trades,
    missing,
  }
}

/**
 * Cached accessor with stale-flagged fallback (same contract as league history).
 * `options.force` bypasses a still-fresh cache — used by the trade-completion
 * notifier the moment a NEW completed trade is detected upstream, so the
 * emailed grades include it instead of waiting out the TTL.
 */
export async function getTradeGrades(
  sleeperLeagueId: string,
  options?: { force?: boolean },
): Promise<TradeGradesPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${sleeperLeagueId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as TradeGradesPayload)
      : null
  if (!options?.force && cachedPayload?.version === 2 && cached && cached.expiresAt > now) {
    return cachedPayload
  }

  const fresh = await buildTradeGrades(sleeperLeagueId).catch((err) => {
    console.error('[trade-grades] build failed', { sleeperLeagueId, err })
    return null
  })
  if (fresh) {
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey },
        update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
        create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
      })
      .catch((err) => console.error('[trade-grades] cache write failed', { sleeperLeagueId, err }))
    return fresh
  }
  if (cachedPayload?.version === 2 && cached) {
    return { ...cachedPayload, staleAsOf: cached.expiresAt.toISOString() }
  }
  return null
}
