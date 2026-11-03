/** Rollback-only NHL three-team decision receipt probe against existing staging rosters. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { buildTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import { evaluateServerTradeDecision } from '@/lib/league-trade-engine/serverTradeDecision'
import { buildTradeDecisionSnapshot, writeTradeDecisionSnapshot } from '@/lib/league-trade-engine/tradeDecisionSnapshot'
import { publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import targetGuard from '../db-target-identity.cjs'

const rosterIds = (data: unknown): string[] => {
  const players = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { players?: unknown }).players : null
  return Array.isArray(players) ? players.filter((id): id is string => typeof id === 'string' && !!id) : []
}
class ProbeRollback extends Error {
  constructor(readonly report: Record<string, unknown>) { super('PROBE_ROLLBACK') }
}

async function main() {
  const leagueId = process.argv[2]
  assert.match(leagueId ?? '', /^[0-9a-f-]{36}$/i, 'NHL_LEAGUE_UUID_REQUIRED')
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  console.error('[nhl receipt] staging target verified')
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  assert.ok(league && league.sport === 'NHL', 'STAGING_NHL_LEAGUE_REQUIRED')
  const context = buildTradeLeagueContext(league, [], '')
  assert.equal(context.scoringMode, 'points', 'POINTS_LEAGUE_REQUIRED')
  assert.ok(Object.values(context.scoringRules).some((value) => value !== 0), 'SAVED_SCORING_RULES_REQUIRED')
  assert.ok(Object.keys(context.starterSlots).length, 'STARTER_SLOTS_REQUIRED')
  const rosters = await prisma.roster.findMany({ where: { leagueId },
    select: { id: true, playerData: true, platformUserId: true, faabRemaining: true } })
  const populated = rosters.filter((roster) => rosterIds(roster.playerData).length > 0)
  assert.ok(populated.length >= 3, 'THREE_POPULATED_ROSTERS_REQUIRED')
  const requestedRosters = process.argv.slice(3)
  assert.ok(requestedRosters.length === 0 || (requestedRosters.length === 3 &&
    new Set(requestedRosters).size === 3 && requestedRosters.every((id) =>
      populated.some((roster) => roster.id === id))), 'THREE_REAL_DISTINCT_ROSTERS_REQUIRED')
  const chosen: Array<(typeof rosters)[number] & { playerId: string }> = []
  const used = new Set<string>()
  for (const roster of populated.filter((row) => !requestedRosters.length || requestedRosters.includes(row.id))) {
    const playerId = rosterIds(roster.playerData).find((id) => !used.has(id))
    if (!playerId) continue
    used.add(playerId)
    chosen.push({ ...roster, playerId })
    if (chosen.length === 3) break
  }
  assert.equal(chosen.length, 3, 'THREE_DISTINCT_ROSTERED_PLAYERS_REQUIRED')
  console.error('[nhl receipt] three authentic rosters loaded')
  const assets = chosen.map((roster, index) => ({ itemType: 'player' as const,
    itemReference: roster.playerId, fromRosterId: roster.id,
    toRosterId: chosen[(index + 1) % 3]!.id }))
  const decision = await evaluateServerTradeDecision({ leagueId,
    proposerRosterId: chosen[0]!.id, receiverRosterId: chosen[1]!.id,
    participantRosterIds: chosen.map((roster) => roster.id), assets, season: league.season })
  assert.equal(decision.participants.length, 3, decision.reason ?? 'THREE_PARTICIPANTS_REQUIRED')
  console.error('[nhl receipt] server decision evaluated')
  assert.equal(decision.scope, 'market')
  assert.equal(decision.lineupBasis, 'historical_points_per_game', decision.reason ?? 'HISTORICAL_LINEUP_BASIS_REQUIRED')
  assert.equal(decision.lineupCoverage?.length, 3, 'THREE_LINEUP_COVERAGE_ROWS_REQUIRED')
  if (requestedRosters.length) assert.ok(decision.lineupCoverage?.every((row) =>
    row.status === 'verified' && row.missingIdentity === 0 && row.missingScoredHistory === 0),
  'COMPLETE_REAL_ROSTER_COVERAGE_REQUIRED')
  const probeUser = await prisma.appUser.findFirst({ select: { id: true } })
  assert.ok(probeUser, 'STAGING_APP_USER_REQUIRED')
  const snapshot = buildTradeDecisionSnapshot({ league, rosters: chosen, assets,
    proposedByUserId: probeUser.id, managerStrategy: null,
    tradeSettings: resolveLeagueTradeSettings(league) as unknown as Record<string, unknown>,
    serverDecisionResult: decision })
  let probeTradeId: string | null = null
  try {
    await prisma.$transaction(async (tx) => {
      const trade = await tx.afLeagueTrade.create({ data: { leagueId,
        proposedByUserId: probeUser.id, proposerRosterId: chosen[0]!.id,
        receiverRosterId: chosen[1]!.id, status: 'pending', reviewType: 'commissioner',
        metadata: { stagingProbe: true, participantRosterIds: chosen.map((roster) => roster.id) },
        items: { create: assets.map((asset) => ({ ...asset, metadata: {} })) } } })
      probeTradeId = trade.id
      await writeTradeDecisionSnapshot(tx, { tradeId: trade.id, leagueId,
        proposedByUserId: probeUser.id, snapshot })
      const saved = await tx.tradeDecisionSnapshot.findUnique({ where: { tradeId: trade.id } })
      assert.ok(saved, 'SAVED_SNAPSHOT_MISSING')
      const receipt = publicTradeDecisionReceipt(saved)
      assert.equal(receipt.participantDecisions.length, 3)
      assert.equal(receipt.lineupCoverage?.length, 3)
      assert.equal(receipt.lineupBasis, 'historical_points_per_game')
      assert.equal(receipt.projectionsVerified, false, 'HISTORICAL_LINEUP_IS_NOT_A_PROJECTION')
      throw new ProbeRollback({ leagueId, sport: league.sport, teamCount: rosters.length,
        rolledBack: true,
        weightedRules: Object.values(context.scoringRules).filter((value) => value !== 0).length,
        selectedRosterPlayerCounts: chosen.map((roster) => rosterIds(roster.playerData).length),
        modelVersion: decision.modelVersion, evaluatorSupported: decision.evaluatorSupported,
        reason: decision.reason,
        comparisonGrades: receipt.participantDecisions.map((row) => row.grade),
        lineupBasis: receipt.lineupBasis,
        lineupDeltas: receipt.participantDecisions.map((row) => row.lineupPointsDelta),
        lineupCoverage: receipt.lineupCoverage, projectionsVerified: receipt.projectionsVerified,
        outcomeVerified: receipt.outcomeVerified,
        contextualGradeAllowed: receipt.contextualGradeAllowed,
        missingEvidence: receipt.missingEvidence })
    }, { maxWait: 10_000, timeout: 30_000 })
  } catch (error) {
    if (!(error instanceof ProbeRollback)) throw error
    assert.ok(probeTradeId)
    const [tradesLeft, snapshotsLeft] = await Promise.all([
      prisma.afLeagueTrade.count({ where: { id: probeTradeId } }),
      prisma.tradeDecisionSnapshot.count({ where: { tradeId: probeTradeId } }),
    ])
    assert.equal(tradesLeft, 0, 'PROBE_TRADE_WAS_NOT_ROLLED_BACK')
    assert.equal(snapshotsLeft, 0, 'PROBE_SNAPSHOT_WAS_NOT_ROLLED_BACK')
    console.log(JSON.stringify(error.report, null, 2))
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
