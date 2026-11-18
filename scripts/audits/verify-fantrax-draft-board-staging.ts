/**
 * Staging-only: import one Fantrax league and report what its draft columns hold.
 * The connected account and its exact team are read from Fantrax; no team is guessed.
 *
 *   node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *     scripts/audits/verify-fantrax-draft-board-staging.ts --list
 *   node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *     scripts/audits/verify-fantrax-draft-board-staging.ts <fantrax-league-id>
 *
 * `--list` prints the leagues the staging-connected Fantrax accounts can see
 * (id and name only). Neither mode prints a Secret ID.
 *
 * Writes ONE thing: the `FantraxLeague` snapshot row the normal import writes.
 * It does not commit the league into the app.
 */
import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import { getFantraxLeagues } from '@/lib/league-import/fantrax/fantraxApi'
import { listFantraxOwnedTeams } from '@/lib/league-import/fantrax/fantraxTeamSelection'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import {
  futurePicksFromStoredInventory,
  madePicksFromStoredBoard,
  parseStoredFantraxDraftBoard,
} from '@/lib/league-import/fantrax/fantraxDraft'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const arg = process.argv[2]
  if (targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label !== 'staging') {
    throw new Error('STAGING_DATABASE_REQUIRED')
  }

  const accounts = await prisma.leagueAuth.findMany({
    where: { platform: 'fantrax', apiKey: { not: null } },
    select: { userId: true },
  })

  const seen: Array<{ userId: string; leagueId: string; leagueName: string; teamId: string; teamName: string; sourceId: string }> = []
  for (const account of accounts) {
    const auth = await getDecryptedAuth(account.userId, 'fantrax')
    if (!auth?.apiKey) continue
    const response = await getFantraxLeagues(auth.apiKey)
    if (!response.ok) continue
    for (const league of response.data) {
      for (const team of listFantraxOwnedTeams(league)) {
        seen.push({
          userId: account.userId,
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamId: team.teamId ?? '',
          teamName: team.teamName,
          sourceId: team.sourceId,
        })
      }
    }
  }

  if (arg === '--list') {
    console.log(JSON.stringify({
      accounts: accounts.length,
      leagues: seen.map((s) => ({ leagueId: s.leagueId, leagueName: s.leagueName, teamName: s.teamName })),
    }, null, 1))
    return
  }

  if (!/^[a-z0-9]{16}$/.test(arg ?? '')) throw new Error('INVALID_LEAGUE_ID')
  const matches = seen.filter((s) => s.leagueId === arg && s.teamId)
  if (matches.length < 1) throw new Error('NO_VERIFIED_TEAM_IN_THAT_LEAGUE')
  const owned = matches[0]!

  const normalized = await runImportedLeagueNormalizationPipeline({
    provider: 'fantrax', sourceId: owned.sourceId, userId: owned.userId,
  })
  if (!normalized.success) throw new Error(`IMPORT_${normalized.code}`)

  const row = await prisma.fantraxLeague.findFirst({
    where: { sourceLeagueId: arg, appUserId: owned.userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, leagueName: true, season: true, sport: true, teamCount: true, draftBoard: true, draftPicks: true, standings: true, updatedAt: true },
  })
  if (!row) throw new Error('SNAPSHOT_ROW_NOT_FOUND')

  /* Traded future picks with team NAMES, so they can be checked against the
     league's own trade history by eye. */
  const nameById = new Map<string, string>()
  for (const s of (Array.isArray(row.standings) ? row.standings : []) as Array<Record<string, unknown>>) {
    if (typeof s?.fantraxTeamId === 'string' && typeof s?.team === 'string') nameById.set(s.fantraxTeamId, s.team)
  }
  const tradedNamed = futurePicksFromStoredInventory(row.draftPicks).picks
    .filter((p) => p.currentOwnerTeamId !== p.originalOwnerTeamId)
    .map((p) => `${p.season} R${p.round}: ${nameById.get(p.originalOwnerTeamId) ?? '?'} -> ${nameById.get(p.currentOwnerTeamId) ?? '?'}`)
    .sort()

  const board = madePicksFromStoredBoard(parseStoredFantraxDraftBoard(row.draftBoard))
  const inventory = (row.draftPicks ?? {}) as { current?: unknown[]; futureRaw?: unknown[] }
  const futureRaw = Array.isArray(inventory.futureRaw) ? inventory.futureRaw : []
  const futureKeys = new Map<string, number>()
  for (const entry of futureRaw) {
    if (entry === null || typeof entry !== 'object') continue
    for (const key of Object.keys(entry)) futureKeys.set(key, (futureKeys.get(key) ?? 0) + 1)
  }

  const n = normalized.normalized
  console.log(JSON.stringify({
    target: 'staging',
    league: { name: row.leagueName, season: row.season, sport: row.sport, teams: row.teamCount },
    snapshotUpdatedAt: row.updatedAt,
    draftBoardStored: row.draftBoard != null,
    draftPicksStored: row.draftPicks != null,
    board: {
      slots: board.slots,
      made: board.picks.length,
      outstanding: board.outstanding,
      state: board.draftState,
      named: board.picks.filter((p) => p.playerName).length,
      firstThree: board.picks.slice(0, 3),
    },
    inventory: {
      current: Array.isArray(inventory.current) ? inventory.current.length : null,
      future: futureRaw.length,
      futureKeys: Object.fromEntries(futureKeys),
      futureSamples: futureRaw.slice(0, 1),
      tradedCount: tradedNamed.length,
      traded: tradedNamed,
    },
    normalized: {
      draftPicks: n.draft_picks.length,
      unknownTeamPicks: n.draft_picks.filter((p) => p.source_roster_id === 'fantrax-team:unknown').length,
      draftCoverage: n.coverage.draftHistory,
      tradedPicks: n.traded_picks?.length ?? null,
      tradedPickTeamsAreLeagueTeams: (n.traded_picks ?? []).every((p) => {
        const ids = new Set(n.rosters.map((r) => r.source_team_id))
        return ids.has(p.original_roster_id) && ids.has(p.current_owner_roster_id)
      }),
      rosters: n.rosters.length,
    },
  }, null, 1))
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ failed: true, message: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
