/**
 * Each castaway's LIVE Survivor points for an NBA week that is not final yet — unofficial, for the
 * Matchup tab's tribe race only (owner's request, 2026-11-25).
 *
 * 🛑 THE OFFICIAL WEEKLY TOTAL IS 0 UNTIL THE WEEK CLOSES, BY DESIGN. `scoreNbaSurvivorRoster` counts a
 * starter toward `survivor_weekly_scores` only once his NBA week is finalized, so for six days every
 * tribe in an NBA Survivor league read 0–0–0 and the race looked broken. This sums the same per-starter
 * breakdown the Matchup tab already shows a manager for his own roster (`nbaSurvivorStarterPoints`:
 * final points plus the games already played), for every castaway.
 *
 * Display only. Nothing here writes a score, and nothing that decides immunity or Elimination Council
 * reads it — those stay on the official weekly scores.
 *
 * Expensive (a schedule and box-score read per starter), so the summary route asks for it only when the
 * Matchup tab does, and a result is cached a minute per league and week.
 */
import 'server-only'
import { nbaSurvivorStarterPoints } from './survivorNbaWeeklyScoring'

const TTL_MS = 60_000
const CONCURRENCY = 4
const cache = new Map<string, { at: number; scores: Record<string, number> }>()

type StarterPoints = typeof nbaSurvivorStarterPoints

/** Whether a summary read carries live totals: asked for, an NBA league, a week, and not final yet. */
export function wantsSurvivorLiveScores(input: {
  liveParam: string | null | undefined
  sport: string | null | undefined
  week: number
  rows: ReadonlyArray<{ isFinalized: boolean }>
}): boolean {
  const final = input.rows.length > 0 && input.rows.every((r) => r.isFinalized)
  return input.liveParam === '1' && String(input.sport ?? '').toUpperCase() === 'NBA' && input.week > 0 && !final
}

/** Live points per main roster id. A roster that cannot be scored is left out, never reported as 0. */
export async function loadNbaSurvivorLiveMemberScores(
  input: { leagueId: string; week: number; season: number; rosterIds: readonly string[] },
  deps: { starterPoints?: StarterPoints; now?: number } = {},
): Promise<Record<string, number>> {
  const now = deps.now ?? Date.now()
  const key = `${input.leagueId}:${input.season}:${input.week}`
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.scores
  const starterPoints = deps.starterPoints ?? nbaSurvivorStarterPoints
  const scores: Record<string, number> = {}
  const queue = [...new Set(input.rosterIds)]
  const worker = async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      const byPlayer = await starterPoints({ leagueId: input.leagueId, legacyRosterId: id, week: input.week, season: input.season }).catch(() => null)
      if (!byPlayer) continue
      let total = 0
      for (const p of byPlayer.values()) total += p.points
      scores[id] = Math.round(total * 100) / 100
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  cache.set(key, { at: now, scores })
  return scores
}

export function clearSurvivorLiveTribeScoresCache(): void {
  cache.clear()
}
