import "server-only"
import {
  syncWorldCupFixtures,
  syncWorldCupTeams,
  type WorldCupFixtureSyncResult,
  type WorldCupSyncOptions,
  type WorldCupTeamSyncResult,
} from "./worldCupDataSyncService"

type WorldCupImportMode = "teams" | "fixtures" | "all"

type WorldCupImportReadinessInput = WorldCupSyncOptions & {
  challengeId?: string | null
  mode?: WorldCupImportMode
}

type WorldCupImportReadinessResult = {
  ok: true
  mode: WorldCupImportMode
  dryRun: boolean
  provider: string | null
  seasonYear: number
  teams: WorldCupTeamSyncResult | null
  fixtures: WorldCupFixtureSyncResult | null
}

export async function importWorldCupReadinessData(
  input: WorldCupImportReadinessInput = {}
): Promise<WorldCupImportReadinessResult> {
  const mode = input.mode ?? "all"
  const dryRun = Boolean(input.dryRun)
  const seasonYear = input.seasonYear ?? 2026
  const provider = input.provider ?? null

  const teams =
    mode === "teams" || mode === "all"
      ? await syncWorldCupTeams({ provider, dryRun, seasonYear })
      : null
  const fixtures =
    (mode === "fixtures" || mode === "all") && input.challengeId
      ? await syncWorldCupFixtures({
          provider,
          dryRun,
          seasonYear,
          challengeId: input.challengeId,
        })
      : null

  return {
    ok: true,
    mode,
    dryRun,
    provider,
    seasonYear,
    teams,
    fixtures,
  }
}
