import type { NormalizedImportResult } from './types'
import { bootstrapLeagueFromNormalizedImport } from './sleeper/SleeperLeagueCreationBootstrapService'

export async function bootstrapLeagueFromImport(
  leagueId: string,
  normalized: NormalizedImportResult,
  /** Who imported this, and which manager they are on the source platform. */
  importer?: { userId: string; sourceManagerId?: string | null } | null,
) {
  return bootstrapLeagueFromNormalizedImport(leagueId, normalized, importer)
}
