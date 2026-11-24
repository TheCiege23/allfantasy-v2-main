import 'server-only'

import { prisma } from '@/lib/prisma'
import { crosswalkToSleeperIds, withTeamDefenseIds } from '@/lib/core-app/rosterIdCrosswalk'
import {
  ESPN_PLAYER_SCORE_SOURCE,
  espnPlayerScoreLeagueKey,
  parseEspnCurrentWeekPlayerScores,
  toSleeperKeyedScores,
} from './espnPlayerWeekScores'

/**
 * ESPN NFL → `league_player_weekly_scores` (GAPS.md PS-01): the current week's locked players, from the
 * league response the scheduled sync ALREADY fetched (`fetchEspnLeagueForImport`, called by the import
 * pipeline for the Fantasy OS collector and for an import). No ESPN request, no other host. Reads the rows
 * as `parseEspnCurrentWeekPlayerScores` gives them, crosswalks them to Sleeper ids, upserts.
 *
 *   - Keyed `espn:<platformLeagueId>` (see `espnPlayerScoreLeagueKey` for why not the bare id), the
 *     CANONICAL Sleeper id (`crosswalkToSleeperIds` + `withTeamDefenseIds`, the same pair My Team uses, so
 *     the id equals the bench ledger's `rec_player_key`), `rosterId` = the ESPN team id
 *     (`playerData.source_team_id`), source 'espn'. `isFinalized` is never set (see the column).
 *   - A player with no one-to-one Sleeper id is counted and skipped, never stored under his ESPN id.
 *   - Owns only source 'espn' rows: a row under the same key from any other source is left alone, and
 *     nothing is deleted — a player not in this read (dropped after his game, unlocked) keeps what he had.
 *   - Only a row whose points, slot or team changed is written.
 *
 * Never throws (the sync must not fail or wait on it) — see `recordEspnPlayerWeekScores`.
 */

export type EspnPlayerWeekScoresResult = {
  week: number | null
  read: number
  written: number
  unchanged: number
  unlocked: number
  unmapped: number
  ambiguous: number
  foreign: number
  skipped: string | null
}

export async function writeEspnPlayerWeekScores(args: {
  platformLeagueId: string
  season: number
  raw: unknown
}): Promise<EspnPlayerWeekScoresResult> {
  const parsed = parseEspnCurrentWeekPlayerScores(args.raw)
  const base = { week: parsed.week, read: parsed.rows.length, written: 0, unchanged: 0, unlocked: parsed.unlocked, unmapped: 0, ambiguous: 0, foreign: 0 }
  if (parsed.reason) return { ...base, skipped: parsed.reason }
  if (parsed.season != null && parsed.season !== args.season) return { ...base, skipped: 'season-mismatch' }
  if (parsed.week == null || parsed.rows.length === 0) return { ...base, skipped: parsed.week == null ? 'no-week' : 'nothing-locked' }

  const ids = [...new Set(parsed.rows.map((r) => r.espnPlayerId))]
  const players = await crosswalkToSleeperIds('espn', 'NFL', ids)
  // Ids only, exactly as My Team does: an ESPN D/ST id encodes its club (`teamDefenseCrosswalk.ts`).
  const crosswalk = withTeamDefenseIds('espn', players, ids.map((playerId) => ({ playerId })))
  const mapped = toSleeperKeyedScores(parsed.rows, crosswalk)
  const out = { ...base, unmapped: mapped.unmapped, ambiguous: mapped.ambiguous }
  if (mapped.rows.length === 0) return { ...out, skipped: null }

  const key = { leagueId: espnPlayerScoreLeagueKey(args.platformLeagueId), seasonYear: args.season, week: parsed.week }
  const existing = await prisma.leaguePlayerWeeklyScore.findMany({
    where: { ...key, playerId: { in: mapped.rows.map((r) => r.sleeperId) } },
    select: { playerId: true, points: true, isStarter: true, rosterId: true, source: true },
  })
  const stored = new Map(existing.map((e) => [e.playerId, e]))
  const writes = []
  for (const row of mapped.rows) {
    const points = Math.round(row.points * 100) / 100
    const prior = stored.get(row.sleeperId)
    if (prior && prior.source !== ESPN_PLAYER_SCORE_SOURCE) {
      out.foreign++
      continue
    }
    if (prior && prior.points === points && prior.isStarter === row.isStarter && prior.rosterId === row.teamId) {
      out.unchanged++
      continue
    }
    const data = { rosterId: row.teamId, isStarter: row.isStarter, points, source: ESPN_PLAYER_SCORE_SOURCE }
    writes.push(
      prisma.leaguePlayerWeeklyScore.upsert({
        where: { leagueId_seasonYear_week_playerId: { ...key, playerId: row.sleeperId } },
        create: { ...key, playerId: row.sleeperId, ...data },
        update: data,
      }),
    )
  }
  if (writes.length > 0) await prisma.$transaction(writes)
  out.written = writes.length
  return { ...out, skipped: null }
}

/**
 * Fire-and-forget wrapper for the sync. Never throws and is never awaited by it.
 *
 * 🛑 THE WARNING CARRIES COUNTS AND AN ERROR CLASS, NEVER A MESSAGE, URL OR ID. An ESPN request carries the
 * user's cookies and the league id; nothing from the request or the error text is logged here.
 */
export function recordEspnPlayerWeekScores(args: { platformLeagueId: string; season: number; raw: unknown }): void {
  if (String(process.env.ESPN_PLAYER_WEEK_SCORES ?? '').trim().toLowerCase() === 'off') return
  void writeEspnPlayerWeekScores(args)
    .then((r) => {
      if (r.unmapped > 0 || r.ambiguous > 0 || r.foreign > 0) {
        console.warn('[espn-player-week-scores] some players not stored', {
          written: r.written, unchanged: r.unchanged, unmapped: r.unmapped, ambiguous: r.ambiguous, foreign: r.foreign,
        })
      }
    })
    .catch((err: unknown) => {
      console.warn('[espn-player-week-scores] write failed', { error: err instanceof Error ? err.name : typeof err })
    })
}
