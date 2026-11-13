import type { WorldCupMatchView } from "./types"

const WORLD_CUP_KNOCKOUT_MODES = ["predictive", "reseeded", "knockout_only"] as const
export type WorldCupKnockoutMode = (typeof WORLD_CUP_KNOCKOUT_MODES)[number]

export function normalizeWorldCupKnockoutMode(value: unknown): WorldCupKnockoutMode {
  if (value === "knockout_only") return "knockout_only"
  return value === "reseeded" ? "reseeded" : "predictive"
}

export function getWorldCupKnockoutModeFromPayload(sourcePayload: unknown): WorldCupKnockoutMode {
  if (!sourcePayload || typeof sourcePayload !== "object" || Array.isArray(sourcePayload)) return "predictive"
  const leagueSettings = (sourcePayload as Record<string, unknown>).leagueSettings
  if (!leagueSettings || typeof leagueSettings !== "object" || Array.isArray(leagueSettings)) return "predictive"
  return normalizeWorldCupKnockoutMode((leagueSettings as Record<string, unknown>).knockoutMode)
}

export function hasOfficialWorldCupReseededKnockoutFixtures(
  matches: Array<Pick<WorldCupMatchView, "round" | "homeTeamId" | "awayTeamId" | "apiFixtureId" | "apiStatusShort">>
): boolean {
  const roundOf32 = matches.filter((match) => match.round === "round_of_32")
  if (roundOf32.length === 0) return false
  return roundOf32.every((match) => {
    const status = (match.apiStatusShort ?? "").trim().toUpperCase()
    return Boolean(
      match.homeTeamId &&
        match.awayTeamId &&
        match.apiFixtureId &&
        status !== "TEST" &&
        status !== "SIM"
    )
  })
}
