/**
 * Authenticated live Fantrax import of a large league into staging.
 * Uses the production normalization and commit services, then reads stored
 * trade context. The caller supplies a league ID; credentials stay in staging.
 *
 * node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *   scripts/audits/verify-fantrax-large-staging-flow.ts <fantrax-league-id>
 */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import { getFantraxLeagues } from '@/lib/league-import/fantrax/fantraxApi'
import { listFantraxOwnedTeams } from '@/lib/league-import/fantrax/fantraxTeamSelection'
import { assertImportCommissioner } from '@/lib/league-import/commissionerGate'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { persistImportedLeagueFromNormalization } from '@/lib/league-import/ImportedLeagueCommitService'
import { loadTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const sourceLeagueId = process.argv[2]
  assert.match(sourceLeagueId ?? '', /^[a-z0-9]{16}$/, 'INVALID_LEAGUE_ID')
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const accounts = await prisma.leagueAuth.findMany({
    where: { platform: 'fantrax', apiKey: { not: null } }, select: { userId: true },
  })
  const owners: Array<{ userId: string; teamId: string; sourceId: string }> = []
  for (const account of accounts) {
    const auth = await getDecryptedAuth(account.userId, 'fantrax')
    if (!auth?.apiKey) continue
    const discovered = await getFantraxLeagues(auth.apiKey)
    if (!discovered.ok) continue
    for (const league of discovered.data.filter((item) => item.leagueId === sourceLeagueId)) {
      for (const team of listFantraxOwnedTeams(league)) {
        if (team.teamId) owners.push({ userId: account.userId, teamId: team.teamId,
          sourceId: team.sourceId })
      }
    }
  }
  assert.equal(owners.length, 1, 'EXPECTED_ONE_VERIFIED_OWNER_TEAM')
  const owner = owners[0]!
  const gate = await assertImportCommissioner({
    appUserId: owner.userId, provider: 'fantrax', sourceLeagueId: owner.sourceId,
    requireCommissioner: true,
  })
  assert.ok(gate.ok && gate.verification === 'member' && gate.sourceManagerId,
    'FANTRAX_MEMBERSHIP_GATE_FAILED')

  const started = performance.now()
  const result = await runImportedLeagueNormalizationPipeline({
    provider: 'fantrax', sourceId: owner.sourceId, userId: owner.userId,
  })
  if (process.argv.includes('--expect-unsupported') && !result.success &&
      result.code === 'NORMALIZATION_FAILED' &&
      result.error.includes('player sport is not yet supported')) {
    const stored = await prisma.league.count({
      where: { platform: 'fantrax', platformLeagueId: sourceLeagueId },
    })
    assert.equal(stored, 0, 'Unsupported league was partially imported')
    console.log(JSON.stringify({ target: 'staging', sourceLeagueId,
      verifiedMembership: gate.verification, unsupportedSport: true,
      storedLeagueRows: stored }))
    return
  }
  assert.ok(result.success, `NORMALIZATION_FAILED_${result.success ? '' : result.code}: ${result.success ? '' : result.error}`)
  const normalizedMs = Math.round(performance.now() - started)
  const rosterCount = result.normalized.rosters.length
  assert.ok(rosterCount >= 100, `EXPECTED_100_PLUS_TEAMS_GOT_${rosterCount}`)
  assert.ok(result.normalized.rosters.every((roster) => roster.source_team_id),
    'MISSING_SOURCE_TEAM_ID')
  assert.equal(new Set(result.normalized.rosters.map((roster) => roster.source_team_id)).size,
    rosterCount, 'DUPLICATE_SOURCE_TEAM_IDS')

  const persisted = await persistImportedLeagueFromNormalization({
    userId: owner.userId, provider: 'fantrax', normalized: result.normalized,
    canonicalBundle: buildCanonicalImportBundle(result.normalized),
    importerSourceManagerId: gate.sourceManagerId,
  })
  const commitMs = Math.round(performance.now() - started) - normalizedMs
  assert.equal(persisted.incompleteSteps.length, 0, 'IMPORT_BOOTSTRAP_INCOMPLETE')
  const [league, teamRows, rosterRows] = await Promise.all([
    loadTradeLeagueContext(persisted.league.id, owner.userId),
    prisma.leagueTeam.count({ where: { leagueId: persisted.league.id } }),
    prisma.roster.count({ where: { leagueId: persisted.league.id } }),
  ])
  assert.ok(league, 'STORED_TRADE_CONTEXT_UNAVAILABLE')
  assert.equal(league.platformLeagueId, sourceLeagueId)
  assert.equal(league.teams.length, rosterCount)
  assert.equal(teamRows, rosterCount)
  assert.equal(rosterRows, rosterCount)
  assert.equal(league.viewerTeamIds.length, 1)
  assert.ok(league.teams.some((team) =>
    team.id === league.viewerTeamIds[0] && team.claimedByUserId === owner.userId),
  'OWNER_TEAM_CLAIM_MISMATCH')
  console.log(JSON.stringify({
    target: 'staging', sourceLeagueId, verification: gate.verification,
    sport: league.sport, normalizedTeams: rosterCount, storedTeams: teamRows,
    storedRosters: rosterRows, claimedTeams: league.viewerTeamIds.length,
    scoringMode: league.scoringMode, scoringRules: Object.keys(league.scoringRules).length,
    missingContext: league.missing, normalizedMs, commitMs,
  }, null, 2))
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
