/**
 * Staging-only check of Fantrax future draft picks, end to end.
 *
 *   node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *     scripts/audits/verify-fantrax-future-picks-staging.ts <fantrax-league-id> [flags] [team name ...]
 *
 * With no flag it imports the league's snapshot (the one write the normal import makes) and prints
 * the traded and home picks the importer derived.
 *
 *   --refresh            also apply the scheduled sync's `traded_picks` step to the league already
 *                        in the app, and report what it wrote and cleared
 *   --trade-csv <path>   also run a Fantrax trade-history export through the upload service
 *   --trade-screen       also print what the trade screens would list (read-only)
 *
 * Team names after the flags are matched loosely and have their picks printed in full.
 * The Fantrax account is read from staging's stored credentials. No Secret ID is printed.
 */
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import { getFantraxLeagues } from '@/lib/league-import/fantrax/fantraxApi'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { applySleeperScopeToLeague } from '@/lib/import-os/collector/applySleeperLeagueSync'
import { importFantraxTradeHistory } from '@/lib/league-import/fantrax/importFantraxTradeHistory'
import { loadImportedFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'
import targetGuard from '../db-target-identity.cjs'

const FLAGS_WITH_VALUE = new Set(['--trade-csv'])

async function main() {
  const argv = process.argv.slice(2)
  const sourceLeagueId = argv[0]
  if (!/^[a-z0-9]{16}$/.test(sourceLeagueId ?? '')) throw new Error('INVALID_LEAGUE_ID')
  if (targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label !== 'staging') {
    throw new Error('STAGING_DATABASE_REQUIRED')
  }
  const has = (flag: string) => argv.includes(flag)
  const valueOf = (flag: string) => (has(flag) ? argv[argv.indexOf(flag) + 1] : undefined)
  const wanted: string[] = []
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (FLAGS_WITH_VALUE.has(a)) { i++; continue }
    if (!a.startsWith('--')) wanted.push(a.toLowerCase())
  }

  /* The account that can see this league, and the team it owns there. */
  const accounts = await prisma.leagueAuth.findMany({
    where: { platform: 'fantrax', apiKey: { not: null } },
    select: { userId: true },
  })
  let owner: { userId: string; teamName: string } | null = null
  for (const account of accounts) {
    const auth = await getDecryptedAuth(account.userId, 'fantrax')
    if (!auth?.apiKey) continue
    const discovered = await getFantraxLeagues(auth.apiKey)
    if (!discovered.ok) continue
    const league = discovered.data.find((l) => l.leagueId === sourceLeagueId)
    if (league?.teamNames[0]) { owner = { userId: account.userId, teamName: league.teamNames[0] }; break }
  }
  if (!owner) throw new Error('NO_STAGING_ACCOUNT_OWNS_A_TEAM_IN_THAT_LEAGUE')

  const result = await runImportedLeagueNormalizationPipeline({
    provider: 'fantrax', sourceId: `fantrax-league:${sourceLeagueId}|${owner.teamName}`, userId: owner.userId,
  })
  if (!result.success) throw new Error(`IMPORT_${result.code}: ${result.error}`)
  const n = result.normalized
  const nameByTeam = new Map(n.rosters.map((r) => [r.source_team_id, (r as { team_name?: string }).team_name ?? r.source_team_id]))
  const label = (id: string) => nameByTeam.get(id) ?? id

  const snapshots = await prisma.fantraxLeague.findMany({ where: { sourceLeagueId }, select: { id: true } })
  const league = await prisma.league.findFirst({
    where: { platform: 'fantrax', platformLeagueId: { in: [sourceLeagueId, ...snapshots.map((s) => s.id)] } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, platform: true, season: true, isDynasty: true, settings: true },
  })

  const out: Record<string, unknown> = {
    target: 'staging',
    league: { name: n.league.name, season: n.league.season, teams: n.rosters.length, inApp: league?.id ?? null },
    draftPicks: n.draft_picks.length,
    tradedPicks: n.traded_picks?.length ?? null,
    returnedPicks: n.returned_picks?.length ?? null,
    traded: (n.traded_picks ?? [])
      .map((p) => `${p.season} R${p.round}: ${label(p.original_roster_id)} -> ${label(p.current_owner_roster_id)}`)
      .sort(),
  }

  if (has('--refresh')) {
    if (!league) throw new Error('LEAGUE_NOT_IN_APP_ON_STAGING')
    const applied = await applySleeperScopeToLeague({ leagueId: league.id, scope: 'traded_picks', normalized: n })
    out.refreshed = { result: applied, rowsAfter: await prisma.futureDraftPick.count({ where: { leagueId: league.id } }) }
  }

  const csvPath = valueOf('--trade-csv')
  if (csvPath) {
    if (!league) throw new Error('LEAGUE_NOT_IN_APP_ON_STAGING')
    const res = await importFantraxTradeHistory({ leagueId: league.id, csvText: readFileSync(csvPath, 'utf8') })
    out.tradeCsv = res.ok
      ? { imported: res.imported, rowsWritten: res.rowsWritten, refused: res.refused.length, skippedLines: res.skippedLines.length, laterRoundPicks: res.laterRoundPicks }
      : res
    out.rowsAfterCsv = await prisma.futureDraftPick.count({ where: { leagueId: league.id } })
  }

  if (has('--trade-screen')) {
    if (!league) throw new Error('LEAGUE_NOT_IN_APP_ON_STAGING')
    const [teams, rosters] = await Promise.all([
      prisma.leagueTeam.findMany({
        where: { leagueId: league.id },
        select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true },
      }),
      prisma.roster.findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true, playerData: true } }),
    ])
    const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : null
    const picks = await loadImportedFuturePicks({
      leagueId: league.id,
      platform: league.platform,
      isDynasty: Boolean(league.isDynasty),
      leagueSeason: league.season,
      status: typeof settings?.status === 'string' ? settings.status : null,
      teams: teams.map((t) => ({
        id: t.id, externalId: String(t.externalId ?? ''), platformUserId: t.platformUserId ?? null,
        claimedByUserId: t.claimedByUserId ?? null, teamName: t.teamName ?? null,
      })),
      rosters,
    })
    const nameByExternal = new Map(teams.map((t) => [String(t.externalId), t.teamName ?? '']))
    const teamByRoster = new Map<string, string>()
    for (const [externalId, rosterId] of picks.rosterIdByTeamId) teamByRoster.set(rosterId, nameByExternal.get(externalId) ?? externalId)
    const all = [...picks.picksByRosterId.values()].flat()
    out.tradeScreen = {
      coverage: picks.coverage,
      readFailed: picks.readFailed,
      rostersWithPicks: picks.picksByRosterId.size,
      totalPicks: all.length,
      seasons: [...new Set(all.map((p) => p.season))].sort(),
      rounds: [...new Set(all.map((p) => p.round))].sort(),
      acquiredPicks: all.filter((p) => p.fromTeamName).length,
      detail: [...picks.picksByRosterId.entries()]
        .map(([rosterId, list]) => ({ team: teamByRoster.get(rosterId) ?? rosterId, list }))
        .filter((t) => wanted.some((w) => t.team.toLowerCase().includes(w)))
        .map((t) => ({
          team: t.team,
          picks: t.list.map((p) => `${p.season} R${p.round}${p.fromTeamName ? ` (from ${p.fromTeamName})` : ''}`),
        })),
    }
  }

  console.log(JSON.stringify(out, null, 1))
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ failed: true, message: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
