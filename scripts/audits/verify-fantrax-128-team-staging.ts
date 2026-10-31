/**
 * Synthetic 128-team Fantrax persistence and NBA trade-grade probe.
 * Uses an existing connected NBA snapshot for real scoring/player data, adds 118
 * empty synthetic teams, and deletes every fixture row in finally.
 *
 * node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *   scripts/audits/verify-fantrax-128-team-staging.ts
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import { buildCanonicalImportBundle } from '@/lib/league-import/canonicalImportNormalizer'
import { persistImportWithCanonicalAudit } from '@/lib/league-import/importPersistenceService'
import { persistImportedLeagueFromNormalization } from '@/lib/league-import/ImportedLeagueCommitService'
import { loadTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import { loadNbaPointsTradeEvaluation } from '@/lib/trades/nbaPointsTradeEvaluation'
import targetGuard from '../db-target-identity.cjs'

const SAMPLE_SOURCE_ID = '51isdapqmt6atvdz'
const FIXTURE_PREFIX = 'af-fantrax-128-probe-'

async function cleanup(sourceId: string) {
  assert.ok(sourceId.startsWith(FIXTURE_PREFIX), 'Refusing to clean an unrecognized source')
  const leagues = await prisma.league.findMany({
    where: { platform: 'fantrax', platformLeagueId: sourceId }, select: { id: true },
  })
  for (const league of leagues) {
    await prisma.legacyScoreRecord.deleteMany({ where: { leagueId: league.id } })
    await prisma.leagueManagerClaim.deleteMany({ where: { leagueId: league.id } })
    await prisma.league.delete({ where: { id: league.id } })
  }
  await prisma.legacyEvidenceRecord.deleteMany({
    where: { sourceReference: `fantrax:${sourceId}` },
  })
  await prisma.importRun.deleteMany({ where: { provider: 'fantrax', sourceLeagueId: sourceId } })
  await prisma.leagueSyncState.deleteMany({ where: { provider: 'fantrax', externalLeagueId: sourceId } })
  assert.equal(await prisma.league.count({ where: { platformLeagueId: sourceId } }), 0)
  assert.equal(await prisma.importRun.count({ where: { sourceLeagueId: sourceId } }), 0)
}

async function main() {
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const sourceId = `${FIXTURE_PREFIX}${randomUUID()}`
  try {
    const sample = await prisma.league.findFirst({
      where: { platform: 'fantrax', platformLeagueId: SAMPLE_SOURCE_ID, sport: 'NBA' },
      select: { id: true, userId: true },
    })
    assert.ok(sample, 'Connected Fantrax NBA staging sample is unavailable')
    const snapshot = await prisma.fantraxLeague.findFirst({
      where: { sourceLeagueId: SAMPLE_SOURCE_ID, appUserId: sample.userId },
      orderBy: { updatedAt: 'desc' }, select: { id: true },
    })
    assert.ok(snapshot, 'Fantrax NBA snapshot is unavailable')
    const original = await runImportedLeagueNormalizationPipeline({
      provider: 'fantrax', sourceId: `id:${snapshot.id}`, userId: sample.userId,
    })
    assert.ok(original.success, 'Fantrax snapshot normalization failed')
    const sampleContext = await loadTradeLeagueContext(sample.id, sample.userId)
    assert.ok(sampleContext && sampleContext.scoringMode === 'points' &&
      Object.keys(sampleContext.scoringRules).length > 0, 'NBA points rules unavailable')

    const normalized = structuredClone(original.normalized)
    normalized.source.source_league_id = sourceId
    normalized.source.import_batch_id = `fantrax-scale-${randomUUID()}`
    normalized.league.name = 'Synthetic Fantrax 128-team scale probe'
    normalized.league.leagueSize = 128
    normalized.league.scoring = 'points'
    normalized.scoring = {
      scoring_format: 'points',
      rules: Object.entries(sampleContext.scoringRules).map(([stat_key, points_value]) =>
        ({ stat_key, points_value })),
      raw: { syntheticScaleProbe: true },
    }
    const cason = Object.entries(normalized.player_map).find(([, player]) =>
      /cason.*wallace|wallace.*cason/i.test(player.name))
    const kelel = Object.entries(normalized.player_map).find(([, player]) =>
      /kelel.*ware|ware.*kelel/i.test(player.name))
    assert.ok(cason && kelel, 'Known NBA grade assets unavailable in snapshot')
    const first = normalized.rosters.find((roster) => roster.player_ids.includes(cason[0]))
    const second = normalized.rosters.find((roster) => roster.player_ids.includes(kelel[0]))
    assert.ok(first && second && first.source_team_id !== second.source_team_id,
      'Known grade assets must belong to different teams')
    const existingIds = new Set(normalized.rosters.map((roster) => roster.source_team_id))
    for (let index = normalized.rosters.length; index < 128; index++) {
      let teamId = String(1_500_000_000 + index)
      while (existingIds.has(teamId)) teamId = String(Number(teamId) + 1)
      existingIds.add(teamId)
      normalized.rosters.push({
        source_team_id: teamId, source_manager_id: `fantrax-team:${teamId}`,
        owner_name: 'Shared synthetic name', team_name: 'Shared synthetic name',
        avatar_url: null, wins: 0, losses: 0, ties: 0, points_for: 0,
        player_ids: [], starter_ids: [], reserve_ids: [], taxi_ids: [],
      })
      normalized.standings.push({
        source_team_id: teamId, rank: index + 1, wins: 0, losses: 0, ties: 0, points_for: 0,
      })
    }
    normalized.coverage.currentRosters = {
      state: 'partial', count: 128, note: '118 empty synthetic teams in scale probe',
    }
    normalized.coverage.currentStandings = { state: 'partial', count: 128 }
    assert.equal(normalized.rosters.length, 128)

    normalized.viewer_source_team_id = first.source_team_id
    const canonical = buildCanonicalImportBundle(normalized)
    // The initial commit uses the production commit service directly. The audited
    // second-team join then exercises the normal import path without starting a
    // background legacy-score sweep across 128 temporary teams.
    const created = await persistImportedLeagueFromNormalization({
      userId: sample.userId, provider: 'fantrax', normalized, canonicalBundle: canonical,
      importerSourceManagerId: first.source_manager_id,
    })
    normalized.viewer_source_team_id = second.source_team_id
    const { persisted: joined } = await persistImportWithCanonicalAudit({
      userId: sample.userId, provider: 'fantrax', normalized,
      canonical: buildCanonicalImportBundle(normalized),
      importerSourceManagerId: second.source_manager_id,
    })
    assert.equal(created.incompleteSteps.length, 0, 'Initial import bootstrap incomplete')
    assert.equal(joined.incompleteSteps.length, 0, 'Team join incomplete')
    assert.equal(joined.joinedExisting, true, 'Second team did not join the existing league')
    const leagueIds = [created.league.id, joined.league.id]
    assert.equal(new Set(leagueIds).size, 1, 'Two imports created duplicate League rows')
    const context = await loadTradeLeagueContext(leagueIds[0]!, sample.userId)
    assert.ok(context && context.teams.length === 128 && context.viewerTeamIds.length === 2,
      '128-team context or two team claims missing')
    assert.equal(context.teamCount, 128)
    assert.equal(context.scoringMode, 'points')
    assert.ok(context.viewerTeamIds.every((id) => context.teams.some((team) => team.id === id)))
    const grade = await loadNbaPointsTradeEvaluation({
      league: context,
      senderGives: [{ name: cason[1].name, playerId: cason[0] }],
      receiverGives: [{ name: kelel[1].name, playerId: kelel[0] }],
    })
    assert.ok(grade.ok, `NBA grade failed: ${grade.ok ? '' : grade.code}`)
    console.log(JSON.stringify({
      target: 'staging', fixture: 'synthetic', teams: context.teams.length,
      claimedTeams: context.viewerTeamIds.length, leagueRows: new Set(leagueIds).size,
      scoringRules: Object.keys(context.scoringRules).length,
      grade: { ok: grade.ok, senderPointsPerGame: grade.senderTotal,
        receiverPointsPerGame: grade.receiverTotal },
    }))
  } finally {
    await cleanup(sourceId)
    console.log('PASS: synthetic fixture cleaned up')
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
