/**
 * Rolling Insights live feed → GameSnapshot.
 *
 * Verified against a real 200 payload (2025-11-16, 13 games, 232 KB), not against
 * the documentation — the published samples date from 2019 and 2023.
 *
 * Actual shape:
 *   { data: { NFL: [ { game_ID, game_status, player_box: {
 *       away_team: { "<playerId>": {...} }, home_team: { ... } } } ] } }
 *
 * ⚠ USE https AND ROLLING_INSIGHTS_RSC_TOKEN. Two things that cost real time to
 * learn: the docs show http:// throughout but https WORKS with a valid
 * certificate, so the token never needs to travel in cleartext; and
 * CLIENT_SECRET2 is the OTHER-SPORTS credential — using it against NFL returns
 * 304 forever and looks exactly like "no new data".
 */

import type { GameSnapshot, PlayerStatLine, TeamStatLine } from './eventDetector'

/**
 * Fields that are not cumulative stats and must never enter a stat payload.
 *
 * ⚠ `DK_fantasy_points` IS DRAFTKINGS SCORING AND IS ACTIVELY WRONG FOR US. It
 * encodes one operator's format — no TE premium, no custom IDP, no 6-point
 * passing TDs. Letting it into the payload invites a caller to read it as "the"
 * fantasy score. Points are computed per league by leagueScoring.ts from raw
 * stats; this number has no correct use here.
 */
const NON_STAT_FIELDS = new Set([
  'player', 'position', 'position_category', 'status', 'snap_counts',
  'DK_fantasy_points', 'field_goal_distances', 'passer_rating',
])

type RiPlayer = Record<string, unknown> & { player?: string; position?: string }

function toStats(raw: RiPlayer): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (NON_STAT_FIELDS.has(k)) continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

/**
 * Status strings observed in live payloads: "Final", "Final OT", and in-progress
 * variants. Normalised so poll cadence and detection do not each parse them.
 */
export function normaliseStatus(raw: string | undefined): string {
  const s = (raw ?? '').toLowerCase()
  if (s.startsWith('final') || s.includes('complete')) return 'final'
  if (s.includes('progress') || s.includes('quarter') || s.includes('half') || /q[1-4]/.test(s)) {
    return 'in_progress'
  }
  if (s.includes('schedul') || s.includes('pre')) return 'scheduled'
  return s || 'unknown'
}

/**
 * Parse a live response into one snapshot per game.
 *
 * ⚠ RETURNS AN EMPTY ARRAY FOR A 304 BODY, AND THAT IS THE NORMAL CASE. RI returns
 * 304 with no body when nothing has changed since your last poll. The caller must
 * treat that as "no work", NOT as "no games" and certainly not as an error — see
 * shouldProcess() below.
 */
export function parseLivePayload(payload: unknown, capturedAt: Date): GameSnapshot[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>
  const data = (root.data ?? root) as Record<string, unknown>
  const games = data?.NFL
  if (!Array.isArray(games)) return []

  const out: GameSnapshot[] = []
  for (const raw of games) {
    if (!raw || typeof raw !== 'object') continue
    const g = raw as Record<string, unknown>
    const gameId = String(g.game_ID ?? g.game_id ?? '').trim()
    if (!gameId) continue

    const box = g.player_box as Record<string, unknown> | undefined
    const players: PlayerStatLine[] = []

    for (const sideKey of ['away_team', 'home_team']) {
      const side = box?.[sideKey]
      if (!side || typeof side !== 'object') continue
      const teamName = String(
        (sideKey === 'away_team' ? g.away_team_name : g.home_team_name) ?? ''
      ).trim() || null

      // Keyed by provider player id — "143", "320" etc.
      for (const [playerId, rawPlayer] of Object.entries(side as Record<string, unknown>)) {
        if (!rawPlayer || typeof rawPlayer !== 'object') continue
        const p = rawPlayer as RiPlayer
        players.push({
          playerId,
          playerName: String(p.player ?? '').trim() || playerId,
          team: teamName,
          stats: toStats(p),
        })
      }
    }

    /*
     * ⚠ TEAM DEFENCE LIVES IN `full_box.team_stats`, NOT IN `player_box`.
     * An earlier read of this feed checked only player_box, concluded team defence
     * was absent, and had the provider return an empty map — which would have
     * scored every DST slot at zero while looking like a deliberate design choice.
     * It is all here: sacks, defense_touchdowns, defense_interceptions, every
     * return-TD variant, and points_against_defense_special_teams.
     */
    const teams: TeamStatLine[] = []
    const fullBox = g.full_box as Record<string, unknown> | undefined
    for (const sideKey of ['away_team', 'home_team']) {
      const side = fullBox?.[sideKey] as Record<string, unknown> | undefined
      if (!side) continue
      const abbrv = String(side.abbrv ?? '').trim().toUpperCase()
      if (!abbrv) continue
      const ts = side.team_stats as Record<string, unknown> | undefined
      const stats: Record<string, number> = {}
      for (const [k, v] of Object.entries(ts ?? {})) {
        if (NON_STAT_FIELDS.has(k)) continue
        if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v
      }
      const score = typeof side.score === 'number' ? side.score : null
      teams.push({ team: abbrv, score, stats })
    }

    // Game state — the provider seam documents fractionElapsed as an unfilled gap
    // because no source supplied a clock. This one does.
    const cur = (fullBox?.current ?? {}) as Record<string, unknown>
    const redZone = cur.RedZone === true || cur.RedZone === 1
    const quarter = cur.Quarter != null ? String(cur.Quarter) : null

    out.push({
      gameId,
      status: normaliseStatus(String(g.game_status ?? g.status ?? '')),
      capturedAt,
      players,
      teams,
      redZone,
      quarter,
      seasonType: g.season_type != null ? String(g.season_type) : null,
    })
  }
  return out
}

export type PollOutcome =
  | { kind: 'unchanged' }
  | { kind: 'changed'; snapshots: GameSnapshot[] }
  | { kind: 'error'; status: number }

/**
 * Decide what a poll response means.
 *
 * ⚠ 304 IS SUCCESS. RI's own docs: "No data returned if you have received the
 * latest update." It is their conditional-polling mechanism and it is what makes a
 * 12-second cadence affordable — cost scales with CHANGE, not with frequency.
 *
 * ⚠ BUT ONLY IF THE CALLER SKIPS THE WORK. A poller that re-parses and re-diffs an
 * unchanged body every 12 seconds pays the full cost anyway and gains nothing. The
 * whole point of returning 'unchanged' here is that the caller does no parse, no
 * diff, and no event emission.
 */
export function interpretPollResponse(
  status: number,
  body: unknown,
  capturedAt: Date
): PollOutcome {
  if (status === 304) return { kind: 'unchanged' }
  if (status < 200 || status >= 300) return { kind: 'error', status }
  const snapshots = parseLivePayload(body, capturedAt)
  // A 200 whose body parses to nothing is still "no work" rather than an error —
  // an empty slate happens on days with no games.
  return snapshots.length > 0 ? { kind: 'changed', snapshots } : { kind: 'unchanged' }
}

/** Build the live URL. Always https — the token must not ride in cleartext. */
export function liveUrl(date: string, token: string, opts: { gameId?: string } = {}): string {
  const base = 'https://rest.datafeeds.rolling-insights.com/api/v1'
  const q = new URLSearchParams({ RSC_token: token })
  if (opts.gameId) q.set('game_id', opts.gameId)
  return `${base}/live/${date}/NFL?${q.toString()}`
}

/**
 * Whether polling should continue for this set of games.
 *
 * ⚠ STOP ON FINAL. A poller left running against completed games burns quota
 * forever and — because everything is final — returns 304 every time, so it looks
 * healthy while doing nothing. Silent waste is harder to notice than a crash.
 */
export function hasActiveGames(snapshots: GameSnapshot[]): boolean {
  return snapshots.some((s) => s.status !== 'final')
}
