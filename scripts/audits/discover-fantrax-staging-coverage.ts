/** Read-only inventory of connected Fantrax staging leagues; never prints credentials. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import {
  getFantraxLeagueInfo, getFantraxLeagues, getFantraxPlayerIds,
  getFantraxStandings, getFantraxTeamRosters,
} from '@/lib/league-import/fantrax/fantraxApi'
import { listFantraxOwnedTeams } from '@/lib/league-import/fantrax/fantraxTeamSelection'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const identifySports = process.argv.includes('--identify-sports')
  const sportMaps = identifySports
    ? Object.fromEntries(await Promise.all((['MLB', 'NHL', 'NCAAB', 'EPL'] as const)
      .map(async (sport) => [sport, await getFantraxPlayerIds(sport)] as const)))
    : null
  const accounts = await prisma.leagueAuth.findMany({
    where: { platform: 'fantrax', apiKey: { not: null } },
    select: { userId: true },
  })
  const leagues: Array<{
    leagueId: string; account: number; ownedTeams: number; teams: number | null;
    infoError?: string;
    largeProbe?: {
      rosterTeams: number | null; standingsTeams: number | null;
      rosterPlayers: number | null; missingRosterTeams: number | null;
      missingStandingTeams: number | null; duplicateTeamNames: number | null;
      rosterError?: string; standingsError?: string;
      scoringType?: string | null; sportMatches?: Record<string, number | null>;
      scoringCategories?: string[]; scoringOverrides?: number;
      basketballConfigs?: Array<{ code: string; position: string; points: number | null }>;
    };
  }> = []
  const accountErrors: Array<{ account: number; kind: string }> = []
  for (const [index, account] of accounts.entries()) {
    const auth = await getDecryptedAuth(account.userId, 'fantrax')
    if (!auth?.apiKey) {
      accountErrors.push({ account: index + 1, kind: 'credential_unavailable' })
      continue
    }
    const discovered = await getFantraxLeagues(auth.apiKey)
    if (!discovered.ok) {
      accountErrors.push({ account: index + 1, kind: discovered.failure.kind })
      continue
    }
    for (const league of discovered.data) {
      const info = await getFantraxLeagueInfo(league.leagueId)
      const teamIds = info.ok
        ? new Set(Object.values(info.data.teamInfo ?? {}).map((team) => team.id))
        : new Set<string>()
      let largeProbe: typeof leagues[number]['largeProbe']
      if (info.ok && teamIds.size >= 100) {
        const [rosters, standings] = await Promise.all([
          getFantraxTeamRosters(league.leagueId), getFantraxStandings(league.leagueId),
        ])
        const rosterIds = rosters.ok ? new Set(Object.keys(rosters.data)) : null
        const standingIds = standings.ok ? new Set(standings.data.map((row) => row.teamId)) : null
        const rosterNames = rosters.ok
          ? Object.values(rosters.data).map((row) => row.teamName.trim().toLowerCase())
          : null
        const playerIds = rosters.ok
          ? Object.values(rosters.data).flatMap((row) => row.rosterItems.map((item) => item.id))
          : []
        const sportMatches = sportMaps ? Object.fromEntries(Object.entries(sportMaps)
          .map(([sport, directory]) => [sport, directory.ok
            ? playerIds.filter((id) => id in directory.data).length : null])) : undefined
        const scoring = info.data.scoringSystem as {
          scoringCategorySettings?: Array<{ configs?: Array<{
            scoringCategory?: { code?: string }; position?: { shortName?: string; code?: string };
            points?: number | string;
          }> }>;
        } | null | undefined
        const configs = scoring?.scoringCategorySettings?.flatMap((setting) => setting.configs ?? []) ?? []
        largeProbe = {
          rosterTeams: rosterIds?.size ?? null,
          standingsTeams: standingIds?.size ?? null,
          rosterPlayers: rosters.ok
            ? Object.values(rosters.data).reduce((n, row) => n + row.rosterItems.length, 0)
            : null,
          missingRosterTeams: rosterIds
            ? [...teamIds].filter((id) => !rosterIds.has(id)).length : null,
          missingStandingTeams: standingIds
            ? [...teamIds].filter((id) => !standingIds.has(id)).length : null,
          duplicateTeamNames: rosterNames
            ? rosterNames.length - new Set(rosterNames).size : null,
          scoringType: typeof info.data.scoringSystem?.type === 'string'
            ? info.data.scoringSystem.type : null,
          ...(sportMatches ? { sportMatches } : {}),
          scoringCategories: [...new Set(configs.map((config) => config.scoringCategory?.code)
            .filter((code): code is string => Boolean(code)))].sort(),
          scoringOverrides: configs.filter((config) => {
            const position = (config.position?.shortName ?? config.position?.code ?? '').toUpperCase()
            return position !== '' && position !== 'DEFAULT' && position !== '-1'
          }).length,
          ...((sportMatches?.NCAAB ?? 0) > 0 ? { basketballConfigs: configs.map((config) => ({
            code: config.scoringCategory?.code ?? '',
            position: config.position?.shortName ?? config.position?.code ?? '',
            points: Number.isFinite(Number(config.points)) ? Number(config.points) : null,
          })) } : {}),
          ...(rosters.ok ? {} : { rosterError: rosters.failure.kind }),
          ...(standings.ok ? {} : { standingsError: standings.failure.kind }),
        }
      }
      leagues.push({
        leagueId: league.leagueId,
        account: index + 1,
        ownedTeams: listFantraxOwnedTeams(league).filter((team) => team.teamId).length,
        teams: info.ok ? Object.keys(info.data.teamInfo ?? {}).length : null,
        ...(info.ok ? {} : { infoError: info.failure.kind }),
        ...(largeProbe ? { largeProbe } : {}),
      })
    }
  }
  console.log(JSON.stringify({
    target: 'staging', connectedAccounts: accounts.length, accountErrors,
    leagues, multiTeamCandidates: leagues.filter((league) => league.ownedTeams >= 2).length,
    largeLeagueCandidates: leagues.filter((league) => (league.teams ?? 0) >= 100).length,
  }, null, 2))
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
