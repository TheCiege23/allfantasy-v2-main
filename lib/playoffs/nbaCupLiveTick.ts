import "server-only"
import { syncNbaCupTournament } from "./syncNbaCupTournament"

/** Existing live-score worker owns ingestion; pool readers never poll ESPN or publish results. */
export type NbaCupLiveTickResult = { activeGames: number; gamesPublished?: number; poolsUpdated?: number; providerFailures: number; skipped?: string }
export async function refreshNbaCupLive(): Promise<NbaCupLiveTickResult> {
  const now = new Date()
  if (now.getUTCMonth() < 9) return { activeGames: 0, providerFailures: 0, skipped: "outside-cup-season" }
  const result = await syncNbaCupTournament({ season: now.getUTCFullYear(), apply: true, mode: "live" })
  return { activeGames: "activeGames" in result ? result.activeGames ?? 0 : 0,
    gamesPublished: "gamesPublished" in result ? result.gamesPublished : 0,
    poolsUpdated: "poolsUpdated" in result ? result.poolsUpdated : 0,
    providerFailures: result.failures.length }
}
