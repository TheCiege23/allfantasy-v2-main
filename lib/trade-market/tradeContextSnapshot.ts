import type {
  NormalizedImportResult,
  NormalizedLeagueSettings,
  NormalizedRoster,
  NormalizedTransaction,
} from '@/lib/league-import/types'

/**
 * THE SITUATION AROUND A TRADE, SAVED WHEN THE TRADE IS FIRST SEEN (owner's call, 2026-11-22).
 *
 * The trade learner has to know WHY a manager paid what they paid, not only WHAT moved: a superflex team carrying two
 * quarterbacks pays extra for a third; a team with both tight ends hurt pays for one; a contender buys a veteran and a
 * rebuilder sells him for picks. `LeagueTrade` stores what moved and when. What it could not store is the part that
 * disappears: each team's roster at that moment, its record, its FAAB. A week later the rosters have moved again and
 * that context can only be guessed at.
 *
 * So the live sync — which already holds the league's settings, every roster and every recent transaction — saves
 * them beside the trade. RAW FACTS ONLY, interpreted later: nothing here decides that a league is superflex or a team
 * is rebuilding. The learner decides, and can decide again when it gets better, because the facts are kept.
 *
 * PURE: the sync's own payload in, a snapshot out. No database read, no provider call.
 *
 * ⚠ WHAT IS NOT HERE, AND WHY:
 *   - Each asset's market value on the trade date: `PlayerValueSnapshot` keeps a dated daily series, so the learner
 *     reads it by date. Copying it here would freeze one chart into the row.
 *   - Bye weeks: the schedule is stored by week; the trade's week finds them.
 *   - Injury status: the sync payload does not carry it. Not captured yet — a known gap, not a hidden one.
 */

export const TRADE_CONTEXT_SNAPSHOT_VERSION = 1

/** A snapshot is saved only for a trade seen within this long of happening, so a roster rebuilt from the sync is the roster of that week, not of some later one. */
export const TRADE_CONTEXT_MAX_LAG_HOURS = 7 * 24

/** League settings worth keeping, by name. A whitelist, so a provider adding a large field cannot bloat every trade row. */
const LEAGUE_KEYS = [
  'sport', 'season', 'leagueSize', 'rosterSize', 'scoring', 'isDynasty', 'is_keeper', 'max_keepers', 'best_ball',
  'current_week', 'start_week', 'regular_season_length', 'playoff_start_week', 'playoff_teams', 'playoff_team_count',
  'trade_deadline_week', 'faab_budget', 'waiver_type', 'reserve_slots', 'taxi_slots', 'taxi_years', 'pick_trading',
  'sleeper_league_type',
] as const satisfies readonly (keyof NormalizedLeagueSettings)[]

export type TradeContextPlayer = {
  id: string
  position: string | null
  team: string | null
  /** The lineup slot the player held before the trade, when the provider says (e.g. "SUPER_FLEX"); null on the bench. */
  slot: string | null
  starter: boolean
  reserve: boolean
  taxi: boolean
}

export type TradeContextSide = {
  rosterId: string
  managerId: string | null
  record: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number | null; rank: number | null }
  faabRemaining: number | null
  waiverPriority: number | null
  /** This team's roster just before the trade: the sync's roster with this trade and every later move undone. */
  rosterBefore: TradeContextPlayer[]
}

export type TradeContextSnapshot = {
  version: typeof TRADE_CONTEXT_SNAPSHOT_VERSION
  source: 'live_sync'
  provider: string
  capturedAt: string
  tradeAt: string | null
  /** Hours between the trade and this capture. The learner trusts a small one. */
  lagHours: number | null
  /** Moves undone to rebuild the rosters: this trade plus every later one in the sync that touched either team. */
  movesUndone: number
  league: Partial<Pick<NormalizedLeagueSettings, (typeof LEAGUE_KEYS)[number]>>
  /** The starting lineup's slots and how many of each — read from the rosters' own slot labels. Null when the provider gives none. */
  starterSlots: Record<string, number> | null
  /** The league's scoring rules as the provider states them, including any per-position reception bonus. */
  scoring: { format: string | null; rules: Array<{ stat: string; points: number; positions: string[] | null }> } | null
  sides: TradeContextSide[]
}

function timeOf(t: NormalizedTransaction): number | null {
  const ms = Date.parse(t.completed_at ?? t.status_updated_at ?? t.created_at)
  return Number.isFinite(ms) ? ms : null
}

function pickLeague(league: NormalizedLeagueSettings): TradeContextSnapshot['league'] {
  const out: Record<string, unknown> = {}
  for (const k of LEAGUE_KEYS) {
    const v = league[k]
    if (v !== undefined && v !== null) out[k] = v
  }
  return out as TradeContextSnapshot['league']
}

/** The widest lineup any roster shows, as slot → count. One full lineup is the league's starting format. */
function starterSlotsOf(rosters: NormalizedRoster[]): Record<string, number> | null {
  let best: Record<string, number> | null = null
  let bestSize = 0
  for (const r of rosters) {
    const slots = r.starter_slot_by_id ? Object.values(r.starter_slot_by_id).filter(Boolean) : []
    if (slots.length <= bestSize) continue
    const counts: Record<string, number> = {}
    for (const s of slots) counts[s] = (counts[s] ?? 0) + 1
    best = counts
    bestSize = slots.length
  }
  return best
}

/**
 * Undo `moves` (newest first) on one roster's player set: a player this roster ADDED leaves, a player it DROPPED
 * comes back. What remains is the roster before the oldest move undone.
 */
function rosterBeforeMoves(current: Iterable<string>, rosterId: string, moves: NormalizedTransaction[]): Set<string> {
  const players = new Set(current)
  for (const m of moves) {
    for (const [pid, rid] of Object.entries(m.adds ?? {})) if (String(rid) === rosterId) players.delete(pid)
    for (const [pid, rid] of Object.entries(m.drops ?? {})) if (String(rid) === rosterId) players.add(pid)
  }
  return players
}

/**
 * The context of one completed trade, from the sync payload that contains it, or null when it cannot be told
 * honestly: no time on the trade, seen too long after it, or neither team found among the rosters.
 */
export function buildTradeContextSnapshot(
  normalized: NormalizedImportResult,
  trade: NormalizedTransaction,
  capturedAt: Date,
): TradeContextSnapshot | null {
  const tradeMs = timeOf(trade)
  if (tradeMs == null) return null
  const lagHours = Math.max(0, (capturedAt.getTime() - tradeMs) / 3_600_000)
  if (lagHours > TRADE_CONTEXT_MAX_LAG_HOURS) return null

  const sideIds = [...new Set(trade.roster_ids.map((r) => String(r ?? '')).filter(Boolean))]
  const rosters = new Map((normalized.rosters ?? []).map((r) => [String(r.source_team_id), r]))
  if (!sideIds.some((id) => rosters.has(id))) return null

  // This trade and everything after it that touched either team, newest first — undone to reach "just before".
  const touches = (m: NormalizedTransaction) =>
    m.roster_ids.some((r) => sideIds.includes(String(r))) ||
    Object.values(m.adds ?? {}).some((r) => sideIds.includes(String(r))) ||
    Object.values(m.drops ?? {}).some((r) => sideIds.includes(String(r)))
  const later = (normalized.transactions ?? [])
    .filter((m) => m.source_transaction_id !== trade.source_transaction_id && touches(m))
    .filter((m) => {
      const ms = timeOf(m)
      return ms != null && ms >= tradeMs
    })
    .sort((a, b) => (timeOf(b) ?? 0) - (timeOf(a) ?? 0))
  const undo = [...later, trade]

  const standing = new Map((normalized.standings ?? []).map((s) => [String(s.source_team_id), s]))
  const players = normalized.player_map ?? {}

  const sides: TradeContextSide[] = sideIds.flatMap((rosterId) => {
    const r = rosters.get(rosterId)
    if (!r) return []
    const before = rosterBeforeMoves(r.player_ids ?? [], rosterId, undo)
    const starters = new Set(r.starter_ids ?? [])
    const reserve = new Set(r.reserve_ids ?? [])
    const taxi = new Set(r.taxi_ids ?? [])
    const s = standing.get(rosterId)
    return [
      {
        rosterId,
        managerId: r.source_manager_id || null,
        record: {
          wins: s?.wins ?? r.wins ?? 0,
          losses: s?.losses ?? r.losses ?? 0,
          ties: s?.ties ?? r.ties ?? 0,
          pointsFor: s?.points_for ?? r.points_for ?? 0,
          pointsAgainst: s?.points_against ?? r.points_against ?? null,
          rank: s?.rank ?? null,
        },
        faabRemaining: r.faab_remaining ?? null,
        waiverPriority: r.waiver_priority ?? null,
        rosterBefore: [...before].sort().map((id) => ({
          id,
          position: players[id]?.position || null,
          team: players[id]?.team || null,
          // Lineup state is the sync's, so it describes the roster before the trade only for players still on it.
          slot: r.starter_slot_by_id?.[id] ?? null,
          starter: starters.has(id),
          reserve: reserve.has(id),
          taxi: taxi.has(id),
        })),
      },
    ]
  })

  const scoring = normalized.scoring
    ? {
        format: normalized.scoring.scoring_format ?? null,
        rules: normalized.scoring.rules.map((rule) => ({
          stat: rule.stat_key,
          points: rule.points_value,
          positions: rule.positions?.length ? rule.positions : null,
        })),
      }
    : null

  return {
    version: TRADE_CONTEXT_SNAPSHOT_VERSION,
    source: 'live_sync',
    provider: normalized.source?.source_provider ?? 'unknown',
    capturedAt: capturedAt.toISOString(),
    tradeAt: new Date(tradeMs).toISOString(),
    lagHours: Math.round(lagHours * 10) / 10,
    movesUndone: undo.length,
    league: pickLeague(normalized.league),
    starterSlots: starterSlotsOf(normalized.rosters ?? []),
    scoring,
    sides,
  }
}
