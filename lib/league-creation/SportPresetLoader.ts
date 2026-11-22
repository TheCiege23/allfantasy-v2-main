/**
 * Server-side sport preset loader for league creation.
 * Centralizes sport preset payload + feature flags + team/logo context for end-to-end initialization.
 * Use when loading sport options in creation wizard to provide complete sport context including:
 * - roster/scoring/draft/waiver defaults
 * - feature flag availability (superflex, IDP, best ball, etc.)
 * - team data and logo URLs for rendering team previews
 */
import type { LeagueSport } from '@prisma/client'
import { getCreationPayload } from '@/lib/league-defaults-orchestrator'
import { getSportFeatureFlags } from '@/lib/sport-defaults/SportFeatureFlagsService'
import { getTeamMetadataForSportDbAware } from '@/lib/sport-teams/SportTeamMetadataRegistry'

interface SportPresetWithTeamContext {
  // From creation payload
  [key: string]: unknown
  // Feature flags
  featureFlags?: unknown
  // Team context (counts, sample logos)
  teamContext?: {
    teamCount: number
    sampleTeams: Array<{
      abbreviation: string
      team_name: string
      primary_logo_url: string | null
    }>
  }
}

export async function loadSportPresetForCreation(
  sport: LeagueSport,
  variant?: string | null
): Promise<SportPresetWithTeamContext> {
  const [payload, featureFlags, teams] = await Promise.all([
    getCreationPayload(sport, variant ?? null),
    getSportFeatureFlags(sport),
    getTeamMetadataForSportDbAware(sport).catch(() => []),
  ])

  return {
    ...payload,
    featureFlags,
    teamContext:
      teams && teams.length > 0
        ? {
            teamCount: teams.length,
            sampleTeams: teams.slice(0, 3).map((t) => ({
              abbreviation: t.abbreviation,
              team_name: t.team_name,
              primary_logo_url: t.primary_logo_url,
            })),
          }
        : undefined,
  }
}
