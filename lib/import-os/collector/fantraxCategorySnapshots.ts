import type { FantraxPeriodScore } from '@/lib/league-import/fantrax/fantraxApi'
import { normalizeFantraxTeamName } from '@/lib/league-import/fantrax/fantraxTeamIds'
import { verifiedCategoryPairs, type ImportedCategoryPair } from './importedCategorySnapshots'

/** Join provider team names only when each name and roster ID is unique in the connected league. */
export function fantraxCategoryPairs(
  period: FantraxPeriodScore,
  teams: readonly { externalId: string; teamName: string | null; ownerName: string | null }[],
): ImportedCategoryPair[] {
  const byName = new Map<string, string>()
  const duplicate = new Set<string>()
  const byId = new Map<string, string>()
  for (const team of teams) {
    const name = normalizeFantraxTeamName(team.teamName || team.ownerName || '')
    if (!name || !team.externalId) continue
    if (byName.has(name) || byId.has(team.externalId)) {
      duplicate.add(name)
      duplicate.add(byId.get(team.externalId) ?? '')
      continue
    }
    byName.set(name, team.externalId)
    byId.set(team.externalId, name)
  }
  return verifiedCategoryPairs(period.matchups.filter((pair) =>
    pair.away.gamesPlayed > 0 || pair.home.gamesPlayed > 0).map((pair) => ({
    teamId1: normalizeFantraxTeamName(pair.away.teamName),
    teamId2: normalizeFantraxTeamName(pair.home.teamName),
    categories1: pair.away.categories,
    categories2: pair.home.categories,
  })), (name) => duplicate.has(name) ? null : byName.get(name) ?? null)
}
