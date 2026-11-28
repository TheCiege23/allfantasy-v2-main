import { prisma } from '@/lib/prisma'
import { IDENTITY_SLEEPER_SELECT, identityMapSleeperIdOf, identityMapSleeperWhere } from '@/lib/player-identity/identityMapSleeperColumn'
import { getDraftPicks, getLeagueDrafts } from '@/lib/sleeper-client'

interface PredictedTarget {
  player: string
  position: string
  probability: number
  scorecard?: {
    adpWeight: number
    teamNeedWeight: number
    managerTendencyWeight: number
    newsImpactWeight: number
    rookieRankBoostWeight: number
  }
}

interface PredictedPick {
  overall: number
  round: number
  pick: number
  manager: string
  topTargets: PredictedTarget[]
}

interface ActualPick {
  overall: number
  round: number
  pick: number
  rosterId: number
  playerId: string
  playerName: string
  position: string
  manager: string
}

interface ManagerAccuracy {
  manager: string
  totalPicks: number
  exactHits: number
  top3Hits: number
  exactHitRate: number
  top3HitRate: number
  avgPredictedProbOfActual: number
  bestPrediction: { overall: number; player: string; probability: number } | null
  worstMiss: { overall: number; predicted: string; actual: string; predictedProb: number } | null
}

interface BiggestMiss {
  overall: number
  round: number
  pick: number
  manager: string
  predicted: string
  predictedPosition: string
  predictedProb: number
  actual: string
  actualPosition: string
  reason: string
  scorecardInsight: string
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

const normName = (n: string) =>
  String(n || '').toLowerCase().replace(/[.'-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim()

function inferMissReason(
  predicted: PredictedTarget,
  actual: { playerName: string; position: string },
  predictedList: PredictedTarget[]
): { reason: string; scorecardInsight: string } {
  const sc = predicted.scorecard
  if (!sc) return { reason: 'Insufficient scoring data', scorecardInsight: 'No scorecard available' }

  const actualInList = predictedList.find(t => normName(t.player) === normName(actual.playerName))
  const actualProb = actualInList?.probability || 0

  if (actual.position !== predicted.position) {
    return {
      reason: `Position surprise: Chimmy expected ${predicted.position}, manager went ${actual.position}`,
      scorecardInsight: `Team Need weight (${sc.teamNeedWeight}%) may have been miscalibrated for ${actual.position} demand`,
    }
  }

  if (sc.managerTendencyWeight > 35) {
    return {
      reason: `Manager tendency overweighted — Chimmy leaned too heavily on historical behavior`,
      scorecardInsight: `Tendency weight was ${sc.managerTendencyWeight}%, but manager deviated from pattern`,
    }
  }

  if (sc.adpWeight > 45) {
    return {
      reason: `ADP-driven miss — Chimmy trusted consensus ranking too much`,
      scorecardInsight: `ADP weight was ${sc.adpWeight}%, actual pick was a reach or value grab`,
    }
  }

  if (sc.newsImpactWeight > 15) {
    return {
      reason: `News-driven miss — recent player news skewed prediction`,
      scorecardInsight: `News weight was ${sc.newsImpactWeight}%, which inflated/deflated the wrong player`,
    }
  }

  if (actualProb > 0 && actualProb < predicted.probability) {
    return {
      reason: `Close call — actual pick was in predictions but ranked lower (${actualProb}% vs ${predicted.probability}%)`,
      scorecardInsight: `Chimmy identified the player but underestimated probability by ${predicted.probability - actualProb}%`,
    }
  }

  return {
    reason: `Unpredicted pick — ${actual.playerName} was not in the Chimmy's top targets`,
    scorecardInsight: `All five scoring factors missed this selection`,
  }
}

function computeCalibrationDeltas(
  predictions: PredictedPick[],
  actuals: ActualPick[]
): { adp: number; need: number; tendency: number; news: number; rookie: number } {
  const deltas = { adp: 0, need: 0, tendency: 0, news: 0, rookie: 0 }
  let count = 0

  for (const actual of actuals) {
    const pred = predictions.find(p => p.overall === actual.overall)
    if (!pred || !pred.topTargets.length) continue

    const topPredicted = pred.topTargets[0]
    const sc = topPredicted.scorecard
    if (!sc) continue

    const actualInList = pred.topTargets.find(t => normName(t.player) === normName(actual.playerName))
    if (actualInList) continue

    const error = 1
    const totalWeight = sc.adpWeight + sc.teamNeedWeight + sc.managerTendencyWeight + sc.newsImpactWeight + sc.rookieRankBoostWeight || 100

    deltas.adp += error * (sc.adpWeight / totalWeight - 0.2)
    deltas.need += error * (sc.teamNeedWeight / totalWeight - 0.2)
    deltas.tendency += error * (sc.managerTendencyWeight / totalWeight - 0.2)
    deltas.news += error * (sc.newsImpactWeight / totalWeight - 0.2)
    deltas.rookie += error * (sc.rookieRankBoostWeight / totalWeight - 0.2)
    count++
  }

  if (count === 0) return deltas

  const lr = 0.08
  return {
    adp: -lr * (deltas.adp / count),
    need: -lr * (deltas.need / count),
    tendency: -lr * (deltas.tendency / count),
    news: -lr * (deltas.news / count),
    rookie: -lr * (deltas.rookie / count),
  }
}

export async function runRetrospective(
  leagueId: string,
  userId: string,
  platformLeagueId: string,
  season: number,
  teamMapping: Map<string, string>
): Promise<{
  retrospective: any
  calibration: any
  error?: string
}> {
  const drafts = await getLeagueDrafts(platformLeagueId)
  if (!drafts.length) return { retrospective: null, calibration: null, error: 'No drafts found for this league' }

  const latestDraft = drafts[0]
  const draftId = latestDraft.draft_id
  if (!draftId) return { retrospective: null, calibration: null, error: 'No draft ID found' }

  const rawPicks = await getDraftPicks(draftId)
  if (!rawPicks.length) return { retrospective: null, calibration: null, error: 'Draft has no picks yet — it may not have started' }

  /*
   * 🛑 IN THE DRAFT'S SPORT, FROM THAT SPORT'S COLUMN. Sleeper reuses ids across sports (NFL 1466
   * Travis Kelce / NBA 1466 JaVale McGee); `sleeperId` is the NFL column, NBA ids live in
   * `sleeperNbaId`. With no sport to name, picks stay unnamed rather than named as strangers.
   */
  const draftLeague = await prisma.league.findFirst({
    where: { OR: [{ id: leagueId }, { platformLeagueId }] },
    select: { sport: true },
  })
  const draftSport = String(draftLeague?.sport ?? latestDraft.sport ?? '').toUpperCase() || null
  const pickWhere = identityMapSleeperWhere(rawPicks.map((p: any) => String(p.player_id)).filter(Boolean), draftSport)
  const playerMap = pickWhere
    ? await prisma.playerIdentityMap.findMany({
        where: pickWhere,
        select: { ...IDENTITY_SLEEPER_SELECT, canonicalName: true, position: true },
      })
    : []
  const playerLookup = new Map(playerMap.map(p => [identityMapSleeperIdOf(p, draftSport), p]))

  const actuals: ActualPick[] = rawPicks.map((p: any) => {
    const ident = playerLookup.get(String(p.player_id))
    const managerName = teamMapping.get(String(p.roster_id)) || `Manager ${p.roster_id}`
    return {
      overall: p.pick_no,
      round: p.round,
      pick: p.draft_slot || (p.pick_no % 12) || 12,
      rosterId: p.roster_id,
      playerId: String(p.player_id),
      playerName: ident?.canonicalName || p.metadata?.first_name + ' ' + p.metadata?.last_name || `Player ${p.player_id}`,
      position: ident?.position || p.metadata?.position || 'UNK',
      manager: managerName,
    }
  }).sort((a: ActualPick, b: ActualPick) => a.overall - b.overall)

  const snapshot = await prisma.draftPredictionSnapshot.findFirst({
    where: { leagueId, season },
    orderBy: { createdAt: 'desc' },
  })

  if (!snapshot) return { retrospective: null, calibration: null, error: 'No prediction snapshot found for this league/season. Run the Predict Board first before importing the real draft.' }

  const predictions: PredictedPick[] = snapshot.snapshotJson as any

  const managerStats = new Map<string, {
    total: number
    exactHits: number
    top3Hits: number
    probSum: number
    best: { overall: number; player: string; probability: number } | null
    worst: { overall: number; predicted: string; actual: string; predictedProb: number } | null
  }>()

  const biggestMisses: BiggestMiss[] = []

  for (const actual of actuals) {
    const pred = predictions.find(p => p.overall === actual.overall)
    if (!pred) continue

    const manager = actual.manager
    if (!managerStats.has(manager)) {
      managerStats.set(manager, { total: 0, exactHits: 0, top3Hits: 0, probSum: 0, best: null, worst: null })
    }
    const stats = managerStats.get(manager)!
    stats.total++

    const topPick = pred.topTargets[0]
    const isExactHit = topPick && normName(topPick.player) === normName(actual.playerName)
    const isTop3Hit = pred.topTargets.some(t => normName(t.player) === normName(actual.playerName))

    if (isExactHit) stats.exactHits++
    if (isTop3Hit) stats.top3Hits++

    const actualInTargets = pred.topTargets.find(t => normName(t.player) === normName(actual.playerName))
    stats.probSum += actualInTargets?.probability || 0

    if (isExactHit && topPick) {
      if (!stats.best || topPick.probability > stats.best.probability) {
        stats.best = { overall: actual.overall, player: topPick.player, probability: topPick.probability }
      }
    }

    if (!isExactHit && topPick) {
      const missScore = topPick.probability
      if (!stats.worst || missScore > stats.worst.predictedProb) {
        stats.worst = { overall: actual.overall, predicted: topPick.player, actual: actual.playerName, predictedProb: missScore }
      }

      if (topPick.probability >= 15) {
        const { reason, scorecardInsight } = inferMissReason(topPick, actual, pred.topTargets)
        biggestMisses.push({
          overall: actual.overall,
          round: actual.round,
          pick: actual.pick,
          manager,
          predicted: topPick.player,
          predictedPosition: topPick.position,
          predictedProb: topPick.probability,
          actual: actual.playerName,
          actualPosition: actual.position,
          reason,
          scorecardInsight,
        })
      }
    }
  }

  const managerAccuracy: ManagerAccuracy[] = Array.from(managerStats.entries()).map(([manager, s]) => ({
    manager,
    totalPicks: s.total,
    exactHits: s.exactHits,
    top3Hits: s.top3Hits,
    exactHitRate: s.total > 0 ? Math.round((s.exactHits / s.total) * 100) : 0,
    top3HitRate: s.total > 0 ? Math.round((s.top3Hits / s.total) * 100) : 0,
    avgPredictedProbOfActual: s.total > 0 ? Math.round(s.probSum / s.total) : 0,
    bestPrediction: s.best,
    worstMiss: s.worst,
  })).sort((a, b) => b.exactHitRate - a.exactHitRate)

  const totalPicks = actuals.length
  const totalExactHits = managerAccuracy.reduce((s, m) => s + m.exactHits, 0)
  const totalTop3Hits = managerAccuracy.reduce((s, m) => s + m.top3Hits, 0)
  const overallAccuracy = totalPicks > 0 ? Math.round((totalExactHits / totalPicks) * 100) : 0
  const overallTop3Rate = totalPicks > 0 ? Math.round((totalTop3Hits / totalPicks) * 100) : 0

  biggestMisses.sort((a, b) => b.predictedProb - a.predictedProb)
  const topMisses = biggestMisses.slice(0, 10)

  const calDeltas = computeCalibrationDeltas(predictions, actuals)

  const league = await prisma.league.findFirst({
    where: { OR: [{ id: leagueId }, { platformLeagueId }] },
    select: { sport: true },
  })
  const sportType = league?.sport ?? null

  const existingCal = await prisma.leagueDraftCalibration.findUnique({
    where: { leagueId_season: { leagueId, season } },
  })

  const ema = 0.7
  const newWeights = {
    adpWeight: clamp((existingCal?.adpWeight ?? 1) * ema + (1 + calDeltas.adp) * (1 - ema), 0.6, 1.6),
    needWeight: clamp((existingCal?.needWeight ?? 1) * ema + (1 + calDeltas.need) * (1 - ema), 0.6, 1.6),
    tendencyWeight: clamp((existingCal?.tendencyWeight ?? 1) * ema + (1 + calDeltas.tendency) * (1 - ema), 0.6, 1.6),
    newsWeight: clamp((existingCal?.newsWeight ?? 1) * ema + (1 + calDeltas.news) * (1 - ema), 0.6, 1.6),
    rookieWeight: clamp((existingCal?.rookieWeight ?? 1) * ema + (1 + calDeltas.rookie) * (1 - ema), 0.6, 1.6),
  }

  const updatedCal = await prisma.leagueDraftCalibration.upsert({
    where: { leagueId_season: { leagueId, season } },
    create: {
      leagueId,
      sportType,
      season,
      ...newWeights,
      sampleSize: totalPicks,
    },
    update: {
      sportType,
      ...newWeights,
      sampleSize: (existingCal?.sampleSize || 0) + totalPicks,
      lastUpdatedAt: new Date(),
    },
  })

  const retro = await prisma.draftRetrospective.create({
    data: {
      leagueId,
      sportType,
      userId,
      season,
      draftId,
      snapshotId: snapshot.id,
      actualDraftJson: actuals as unknown as any,
      managerAccuracyJson: managerAccuracy as unknown as any,
      biggestMissesJson: topMisses as unknown as any,
      calibrationDeltaJson: calDeltas as unknown as any,
      overallAccuracy,
      top3HitRate: overallTop3Rate,
    },
  })

  return {
    retrospective: {
      id: retro.id,
      overallAccuracy,
      top3HitRate: overallTop3Rate,
      totalPicks,
      managerAccuracy,
      biggestMisses: topMisses,
      draftId,
    },
    calibration: {
      ...newWeights,
      sampleSize: updatedCal.sampleSize,
      deltas: calDeltas,
    },
  }
}
