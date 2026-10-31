/**
 * Explicit staging-only import and end-to-end NBA points grade for one Fantrax league.
 * The connected account and its exact team are read from Fantrax; no team is guessed.
 *
 * node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *   scripts/audits/verify-fantrax-nba-staging-flow.ts <fantrax-league-id>
 */
import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import { getFantraxLeagues } from '@/lib/league-import/fantrax/fantraxApi'
import { listFantraxOwnedTeams } from '@/lib/league-import/fantrax/fantraxTeamSelection'
import { assertImportCommissioner } from '@/lib/league-import/commissionerGate'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { persistImportWithCanonicalAudit } from '@/lib/league-import/importPersistenceService'
import { loadTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import { loadNbaPointsTradeEvaluation } from '@/lib/trades/nbaPointsTradeEvaluation'
import targetGuard from '../db-target-identity.cjs'

type Roster = { rosterItems?: Array<{ id: string }> }

async function publicFantraxJson(path: string): Promise<any> {
  const response = await fetch(`https://www.fantrax.com/fxea/general/${path}`, {
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error('FANTRAX_PUBLIC_DATA_UNAVAILABLE')
  return response.json()
}

async function main() {
  const sourceLeagueId = process.argv[2]
  if (!/^[a-z0-9]{16}$/.test(sourceLeagueId ?? '')) throw new Error('INVALID_LEAGUE_ID')
  if (targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label !== 'staging') {
    throw new Error('STAGING_DATABASE_REQUIRED')
  }

  const accounts = await prisma.leagueAuth.findMany({
    where: { platform: 'fantrax', apiKey: { not: null } },
    select: { userId: true },
  })
  const matches: Array<{ userId: string; teamId: string; teamName: string; sourceId: string }> = []
  for (const account of accounts) {
    const auth = await getDecryptedAuth(account.userId, 'fantrax')
    if (!auth?.apiKey) continue
    const response = await getFantraxLeagues(auth.apiKey)
    if (!response.ok) continue
    for (const league of response.data.filter((item) => item.leagueId === sourceLeagueId)) {
      for (const team of listFantraxOwnedTeams(league)) {
        if (!team.teamId) throw new Error('OWNED_TEAM_ID_UNAVAILABLE')
        matches.push({ userId: account.userId, teamId: team.teamId,
          teamName: team.teamName, sourceId: team.sourceId })
      }
    }
  }
  if (matches.length !== 1) throw new Error(`EXPECTED_ONE_VERIFIED_TEAM_GOT_${matches.length}`)
  const owned = matches[0]!

  const gate = await assertImportCommissioner({
    appUserId: owned.userId, provider: 'fantrax', sourceLeagueId: owned.sourceId,
    requireCommissioner: true,
  })
  if (!gate.ok || gate.verification !== 'member' || gate.sourceManagerId !== owned.teamName) {
    throw new Error('FANTRAX_MEMBERSHIP_GATE_FAILED')
  }

  const normalized = await runImportedLeagueNormalizationPipeline({
    provider: 'fantrax', sourceId: owned.sourceId, userId: owned.userId,
  })
  if (!normalized.success) throw new Error(`IMPORT_${normalized.code}`)
  const canonical = buildCanonicalImportBundle(normalized.normalized)
  const { persisted, skipped } = await persistImportWithCanonicalAudit({
    userId: owned.userId, provider: 'fantrax', normalized: normalized.normalized,
    canonical, allowUpdateExisting: false, importerSourceManagerId: gate.sourceManagerId,
  })
  if (persisted.incompleteSteps.length) throw new Error('IMPORT_INCOMPLETE')

  const league = await loadTradeLeagueContext(persisted.league.id, owned.userId)
  if (!league || league.platform !== 'fantrax' || league.sport !== 'NBA') {
    throw new Error('IMPORTED_NBA_CONTEXT_UNAVAILABLE')
  }
  if (league.teams.length !== 10 || league.viewerTeamIds.length !== 1 ||
      Object.keys(league.scoringRules).length !== 6 || league.scoringMode !== 'points') {
    throw new Error('IMPORTED_LEAGUE_CONTEXT_INCOMPLETE')
  }
  const claimed = league.teams.find((team) => team.id === league.viewerTeamIds[0])
  if (!claimed || claimed.name !== owned.teamName) throw new Error('WRONG_TEAM_CLAIMED')

  const [rosterPayload, directory] = await Promise.all([
    publicFantraxJson(`getTeamRosters?leagueId=${sourceLeagueId}`),
    publicFantraxJson('getPlayerIds?sport=NBA'),
  ])
  const rosters = (rosterPayload.rosters ?? rosterPayload) as Record<string, Roster>
  const ownRoster = rosters[owned.teamId]
  if (!ownRoster) throw new Error('OWNED_ROSTER_UNAVAILABLE')
  const ids = [...new Set(Object.values(rosters).flatMap((team) =>
    (team.rosterItems ?? []).map((item) => String(item.id))))]
  const identities = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NBA', fantraxId: { in: ids } }, select: { fantraxId: true },
  })
  const linked = new Set(identities.map((item) => item.fantraxId))
  function firstLinked(team: Roster) {
    const item = (team.rosterItems ?? []).find((player) =>
      linked.has(String(player.id)) && directory[player.id]?.name)
    return item ? { name: directory[item.id].name as string, playerId: String(item.id) } : null
  }
  const sender = firstLinked(ownRoster)
  const receiver = Object.entries(rosters)
    .filter(([teamId]) => teamId !== owned.teamId)
    .map(([, roster]) => firstLinked(roster))
    .find((player) => player !== null)
  if (!sender || !receiver) throw new Error('LINKED_TRADE_ASSETS_UNAVAILABLE')
  const grade = await loadNbaPointsTradeEvaluation({
    league, senderGives: [sender], receiverGives: [receiver],
  })
  if (!grade.ok) throw new Error(`GRADE_${grade.code}`)

  console.log(JSON.stringify({
    target: 'staging', verifiedMembership: gate.verification,
    leagueId: persisted.league.id, sourceLeagueId, teamCount: league.teams.length,
    claimedTeam: claimed.name, claimedTeamCount: league.viewerTeamIds.length,
    scoringMode: league.scoringMode, scoringRules: league.scoringRules,
    skippedImport: skipped, incompleteSteps: persisted.incompleteSteps.length,
    grade: { ok: grade.ok, sender: sender.name, receiver: receiver.name,
      senderPointsPerGame: grade.senderTotal, receiverPointsPerGame: grade.receiverTotal,
      coverageWarnings: grade.coverage.length },
  }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error?.message || 'STAGING_FLOW_FAILED' }))
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
