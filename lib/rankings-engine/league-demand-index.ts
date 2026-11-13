import { prisma } from '@/lib/prisma'
import { pickValue } from '@/lib/pick-valuation'

export interface PositionDemandEntry {
  ldi: number
  meanPremiumPct: number
  sample: number
  stdPremiumPct?: number
}

export interface PositionDemand {
  position: string
  demandScore: number
  avgOverpayPct: number
  tradeVolume: number
  premiumPlayers: string[]
}

export interface PickDemand {
  round: number
  avgClearingValue: number
  premiumPct: number
  tradeCount: number
}

export interface PlayerDemand {
  playerName: string
  position: string
  demandScore: number
  timesTraded: number
  avgValuePaid: number
  avgMarketValue: number
  overpayPct: number
}

export interface LeagueDemandIndex {
  leagueId: string
  tradesAnalyzed: number
  positionDemand: PositionDemand[]
  pickDemand: PickDemand[]
  hotPlayers: PlayerDemand[]
  demandByPosition: Record<string, number>
  demandJson: Record<string, PositionDemandEntry>
  perPlayerDemand: Record<string, number>
  computedAt: number
}

interface TradeAssetInfo {
  name: string
  position: string
  value: number
}

const GLOBAL_POSITION_DEMAND: Record<string, number> = {
  QB: 55,
  RB: 50,
  WR: 50,
  TE: 45,
}

const LDI_SCALE = 0.12

function parseJsonArray(raw: unknown): TradeAssetInfo[] {
  if (!raw) return []
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return []
    return arr.map((item: any) => ({
      name: String(item?.name || item?.player_name || ''),
      position: String(item?.position || item?.pos || '').toUpperCase(),
      value: Number(item?.value || item?.trade_value || item?.fantasyCalcValue || 0),
    })).filter(a => a.name && a.position)
  } catch {
    return []
  }
}

function parsePicksArray(raw: unknown): Array<{ round: number; year: number; value: number }> {
  if (!raw) return []
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return []
    const currentYear = new Date().getFullYear()
    return arr.map((item: any) => {
      const round = Number(item?.round || 0)
      const year = Number(item?.year || item?.season || currentYear)
      const storedValue = Number(item?.value || item?.trade_value || 0)
      const v = storedValue > 0 ? storedValue : pickValue(round, year, currentYear)
      return { round, year, value: v }
    }).filter(p => p.round > 0)
  } catch {
    return []
  }
}

function parseEnrichmentValues(analysisResult: unknown): Map<string, number> {
  const m = new Map<string, number>()
  if (!analysisResult || typeof analysisResult !== 'object') return m
  try {
    const ar = analysisResult as any
    const enriched = ar.playersWithEnrichment
    if (!Array.isArray(enriched)) return m
    for (const e of enriched) {
      const name = String(e?.name || e?.playerName || '')
      const pos = String(e?.position || '').toUpperCase()
      const fcVal = Number(e?.fantasyCalcValue ?? e?.value ?? 0)
      if (name && fcVal > 0) {
        m.set(`${name}|${pos}`, fcVal)
      }
    }
  } catch {}
  return m
}

function premiumPct(given: number, received: number): number {
  return (received - given) / Math.max(1, given)
}

function ldiScore(meanPremiumPct: number, scale: number = LDI_SCALE): number {
  const x = meanPremiumPct / scale
  const s = 50 + 50 * Math.tanh(x)
  return Math.max(0, Math.min(100, Math.round(s)))
}

export function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0
  if (values.length <= 4) {
    return values.reduce((s, v) => s + v, 0) / values.length
  }
  const sorted = [...values].sort((a, b) => a - b)
  const trimCount = Math.floor(sorted.length * 0.1)
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount)
  if (trimmed.length === 0) return 0
  return trimmed.reduce((s, v) => s + v, 0) / trimmed.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const sqDiffs = values.map(v => (v - mean) ** 2)
  return Math.sqrt(sqDiffs.reduce((s, v) => s + v, 0) / (values.length - 1))
}

export function computePlayerDemandScore(
  playerName: string,
  position: string,
  ldi: LeagueDemandIndex,
): number {
  const playerLdi = ldi.perPlayerDemand[playerName]
  if (playerLdi !== undefined) {
    let ds = ldiScore(playerLdi)
    if (ldi.tradesAnalyzed < 10) {
      const pos = position.toUpperCase()
      const globalDs = GLOBAL_POSITION_DEMAND[pos] ?? 50
      ds = Math.round(0.7 * globalDs + 0.3 * ds)
    }
    return ds
  }

  const pos = position.toUpperCase()
  const posDs = ldi.demandByPosition[pos]
  if (posDs !== undefined) {
    return posDs
  }

  return GLOBAL_POSITION_DEMAND[pos] ?? 50
}

interface SideBasket {
  players: TradeAssetInfo[]
  picks: Array<{ round: number; year: number; value: number }>
  totalValue: number
  byPos: Record<string, number>
}

function buildSideBasket(
  players: TradeAssetInfo[],
  picks: Array<{ round: number; year: number; value: number }>,
  enrichmentMap: Map<string, number>,
): SideBasket {
  let total = 0
  const byPos: Record<string, number> = {}

  for (const p of players) {
    const enrichedVal = enrichmentMap.get(`${p.name}|${p.position}`)
    const v = enrichedVal ?? p.value
    total += v
    byPos[p.position] = (byPos[p.position] ?? 0) + v
  }

  for (const pick of picks) {
    total += pick.value
    byPos['PICK'] = (byPos['PICK'] ?? 0) + pick.value
  }

  return { players, picks, totalValue: total, byPos }
}

function addContrib(
  accum: Record<string, { sumContrib: number; n: number; contribs: number[] }>,
  acquiredByPos: Record<string, number>,
  acquiredTotal: number,
  prem: number,
) {
  if (acquiredTotal <= 0) return
  for (const [pos, v] of Object.entries(acquiredByPos)) {
    const w = v / acquiredTotal
    const c = prem * w
    if (!accum[pos]) accum[pos] = { sumContrib: 0, n: 0, contribs: [] }
    accum[pos].sumContrib += c
    accum[pos].n += 1
    accum[pos].contribs.push(c)
  }
}

export async function computeLeagueDemandIndex(
  leagueId: string,
  windowDays?: number,
): Promise<LeagueDemandIndex> {
  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: leagueId },
    select: { id: true },
  })

  const historyIds = histories.map(h => h.id)

  if (historyIds.length === 0) {
    return emptyDemandIndex(leagueId)
  }

  const whereClause: any = { historyId: { in: historyIds } }
  if (windowDays && windowDays < 9000) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - windowDays)
    whereClause.createdAt = { gte: cutoff }
  }

  const trades = await prisma.leagueTrade.findMany({
    where: whereClause,
    select: {
      playersGiven: true,
      picksGiven: true,
      playersReceived: true,
      picksReceived: true,
      valueGiven: true,
      valueReceived: true,
      analysisResult: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  if (trades.length === 0) {
    return emptyDemandIndex(leagueId)
  }

  const posAccum: Record<string, { sumContrib: number; n: number; contribs: number[] }> = {}

  const playerTrades: Map<string, {
    position: string
    overpayPcts: number[]
    totalPaid: number
    totalMarket: number
    count: number
  }> = new Map()
  const perPlayerOverpayPcts: Map<string, number[]> = new Map()
  const pickStats: Record<number, { totalValue: number; count: number }> = {}

  for (const trade of trades) {
    const enrichmentMap = parseEnrichmentValues(trade.analysisResult)

    const givenPlayers = parseJsonArray(trade.playersGiven)
    const receivedPlayers = parseJsonArray(trade.playersReceived)
    const givenPicks = parsePicksArray(trade.picksGiven)
    const receivedPicks = parsePicksArray(trade.picksReceived)

    const sideA_get = buildSideBasket(receivedPlayers, receivedPicks, enrichmentMap)
    const sideA_give = buildSideBasket(givenPlayers, givenPicks, enrichmentMap)

    const sideB_get = buildSideBasket(givenPlayers, givenPicks, enrichmentMap)
    const sideB_give = buildSideBasket(receivedPlayers, receivedPicks, enrichmentMap)

    if (sideA_get.totalValue > 0 && sideA_give.totalValue > 0) {
      const premA = premiumPct(sideA_give.totalValue, sideA_get.totalValue)
      addContrib(posAccum, sideA_get.byPos, sideA_get.totalValue, premA)

      for (const p of receivedPlayers) {
        if (p.value <= 0 && !enrichmentMap.has(`${p.name}|${p.position}`)) continue
        const pVal = enrichmentMap.get(`${p.name}|${p.position}`) ?? p.value
        const share = sideA_get.totalValue > 0 ? pVal / sideA_get.totalValue : 0
        const contrib = premA * share

        if (!perPlayerOverpayPcts.has(p.name)) perPlayerOverpayPcts.set(p.name, [])
        perPlayerOverpayPcts.get(p.name)!.push(contrib)

        const existing = playerTrades.get(p.name)
        if (existing) {
          existing.totalPaid += sideA_give.totalValue * share
          existing.totalMarket += pVal
          existing.count++
          existing.overpayPcts.push(contrib)
        } else {
          playerTrades.set(p.name, {
            position: p.position,
            totalPaid: sideA_give.totalValue * share,
            totalMarket: pVal,
            count: 1,
            overpayPcts: [contrib],
          })
        }
      }
    }

    if (sideB_get.totalValue > 0 && sideB_give.totalValue > 0) {
      const premB = premiumPct(sideB_give.totalValue, sideB_get.totalValue)
      addContrib(posAccum, sideB_get.byPos, sideB_get.totalValue, premB)

      for (const p of givenPlayers) {
        if (p.value <= 0 && !enrichmentMap.has(`${p.name}|${p.position}`)) continue
        const pVal = enrichmentMap.get(`${p.name}|${p.position}`) ?? p.value
        const share = sideB_get.totalValue > 0 ? pVal / sideB_get.totalValue : 0
        const contrib = premB * share

        if (!perPlayerOverpayPcts.has(p.name)) perPlayerOverpayPcts.set(p.name, [])
        perPlayerOverpayPcts.get(p.name)!.push(contrib)

        const existing = playerTrades.get(p.name)
        if (existing) {
          existing.totalPaid += sideB_give.totalValue * share
          existing.totalMarket += pVal
          existing.count++
          existing.overpayPcts.push(contrib)
        } else {
          playerTrades.set(p.name, {
            position: p.position,
            totalPaid: sideB_give.totalValue * share,
            totalMarket: pVal,
            count: 1,
            overpayPcts: [contrib],
          })
        }
      }
    }

    for (const pick of [...givenPicks, ...receivedPicks]) {
      if (!pickStats[pick.round]) pickStats[pick.round] = { totalValue: 0, count: 0 }
      pickStats[pick.round].totalValue += pick.value
      pickStats[pick.round].count++
    }
  }

  const isColdStart = trades.length < 10

  const demandJson: Record<string, PositionDemandEntry> = {}
  const positionDemand: PositionDemand[] = []
  const demandByPosition: Record<string, number> = {}

  const allPositions = ['QB', 'RB', 'WR', 'TE', 'PICK']
  for (const pos of allPositions) {
    const stats = posAccum[pos]
    if (!stats || stats.n === 0) {
      demandJson[pos] = { ldi: 50, meanPremiumPct: 0, sample: 0 }
      if (pos !== 'PICK') {
        const globalScore = isColdStart ? (GLOBAL_POSITION_DEMAND[pos] ?? 50) : 50
        demandByPosition[pos] = globalScore
        positionDemand.push({
          position: pos,
          demandScore: globalScore,
          avgOverpayPct: 0,
          tradeVolume: 0,
          premiumPlayers: [],
        })
      }
      continue
    }

    const meanPrem = stats.sumContrib / stats.n
    const sample = stats.n
    const std = stdDev(stats.contribs)
    let score = ldiScore(meanPrem)

    if (isColdStart && pos !== 'PICK') {
      const globalDs = GLOBAL_POSITION_DEMAND[pos] ?? 50
      score = Math.round(0.7 * globalDs + 0.3 * score)
    }

    demandJson[pos] = {
      ldi: score,
      meanPremiumPct: Math.round(meanPrem * 10000) / 10000,
      sample,
      stdPremiumPct: Math.round(std * 10000) / 10000,
    }

    if (pos !== 'PICK') {
      demandByPosition[pos] = score

      const playerCounts: Map<string, number> = new Map()
      for (const [name, stats] of playerTrades) {
        if (stats.position === pos) {
          playerCounts.set(name, stats.count)
        }
      }
      const premiumPlayers = [...playerCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name)

      positionDemand.push({
        position: pos,
        demandScore: score,
        avgOverpayPct: Math.round(meanPrem * 1000) / 10,
        tradeVolume: sample,
        premiumPlayers,
      })
    }
  }

  positionDemand.sort((a, b) => b.demandScore - a.demandScore)

  const pickDemand: PickDemand[] = Object.entries(pickStats)
    .map(([round, stats]) => ({
      round: Number(round),
      avgClearingValue: stats.count > 0 ? Math.round(stats.totalValue / stats.count) : 0,
      premiumPct: 0,
      tradeCount: stats.count,
    }))
    .sort((a, b) => a.round - b.round)

  const PICK_BASELINE_VALUES: Record<number, number> = { 1: 100, 2: 65, 3: 40, 4: 20 }
  for (const pd of pickDemand) {
    const baseline = PICK_BASELINE_VALUES[pd.round] || 10
    pd.premiumPct = baseline > 0 ? Math.round(((pd.avgClearingValue - baseline) / baseline) * 100) : 0
  }

  const perPlayerDemand: Record<string, number> = {}
  for (const [name, pcts] of perPlayerOverpayPcts) {
    perPlayerDemand[name] = trimmedMean(pcts)
  }

  const hotPlayers: PlayerDemand[] = [...playerTrades.entries()]
    .filter(([, stats]) => stats.count >= 1 && stats.totalMarket > 0)
    .map(([name, stats]) => {
      const rawPrem = perPlayerDemand[name] ?? 0
      let demandScore = ldiScore(rawPrem)
      if (isColdStart) {
        const globalDs = GLOBAL_POSITION_DEMAND[stats.position] ?? 50
        demandScore = Math.round(0.7 * globalDs + 0.3 * demandScore)
      }

      const avgPaid = stats.totalPaid / stats.count
      const avgMarket = stats.totalMarket / stats.count
      const overpayPct = avgMarket > 0 ? ((avgPaid - avgMarket) / avgMarket) * 100 : 0

      return {
        playerName: name,
        position: stats.position,
        demandScore,
        timesTraded: stats.count,
        avgValuePaid: Math.round(avgPaid),
        avgMarketValue: Math.round(avgMarket),
        overpayPct: Math.round(overpayPct * 10) / 10,
      }
    })
    .sort((a, b) => b.demandScore - a.demandScore)
    .slice(0, 15)

  return {
    leagueId,
    tradesAnalyzed: trades.length,
    positionDemand,
    pickDemand,
    hotPlayers,
    demandByPosition,
    demandJson,
    perPlayerDemand,
    computedAt: Date.now(),
  }
}

export interface ManagerPositionLDI {
  position: string
  meanPremiumPct: number
  ldi: number
  sample: number
}

export interface ManagerTendency {
  managerName: string
  totalTrades: number
  positions: ManagerPositionLDI[]
  overallPremiumPct: number
  topOverpayPosition: string | null
  topOverpayPct: number
}

export async function computePerManagerLDI(
  leagueId: string,
  windowDays: number = 90,
): Promise<ManagerTendency[]> {
  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: leagueId },
    select: { id: true },
  })

  const historyIds = histories.map(h => h.id)
  if (historyIds.length === 0) return []

  const whereClause: any = { historyId: { in: historyIds } }
  if (windowDays < 9000) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - windowDays)
    whereClause.createdAt = { gte: cutoff }
  }

  const trades = await prisma.leagueTrade.findMany({
    where: whereClause,
    select: {
      partnerName: true,
      playersGiven: true,
      picksGiven: true,
      playersReceived: true,
      picksReceived: true,
      valueGiven: true,
      valueReceived: true,
      analysisResult: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const managerAccum: Record<string, Record<string, { sumPrem: number; n: number; prems: number[] }>> = {}
  const tradeCountByPartner: Record<string, number> = {}

  for (const trade of trades) {
    const partner = trade.partnerName
    if (!partner) continue

    const enrichmentMap = parseEnrichmentValues(trade.analysisResult)
    const receivedPlayers = parseJsonArray(trade.playersReceived)
    const receivedPicks = parsePicksArray(trade.picksReceived)
    const givenPlayers = parseJsonArray(trade.playersGiven)
    const givenPicks = parsePicksArray(trade.picksGiven)

    const partnerReceived = buildSideBasket(givenPlayers, givenPicks, enrichmentMap)
    const partnerGave = buildSideBasket(receivedPlayers, receivedPicks, enrichmentMap)

    if (partnerReceived.totalValue <= 0 || partnerGave.totalValue <= 0) continue

    const prem = premiumPct(partnerGave.totalValue, partnerReceived.totalValue)

    if (!managerAccum[partner]) managerAccum[partner] = {}
    if (!tradeCountByPartner[partner]) tradeCountByPartner[partner] = 0
    tradeCountByPartner[partner]++

    for (const [pos, v] of Object.entries(partnerReceived.byPos)) {
      const w = v / partnerReceived.totalValue
      const posPrem = prem * w
      if (!managerAccum[partner][pos]) managerAccum[partner][pos] = { sumPrem: 0, n: 0, prems: [] }
      managerAccum[partner][pos].sumPrem += posPrem
      managerAccum[partner][pos].n += 1
      managerAccum[partner][pos].prems.push(posPrem)
    }
  }

  const results: ManagerTendency[] = []

  for (const [managerName, posStats] of Object.entries(managerAccum)) {
    const actualTradeCount = tradeCountByPartner[managerName] ?? 0
    let totalPremSum = 0
    let totalPremN = 0
    let topPos: string | null = null
    let topPct = -Infinity

    const positions: ManagerPositionLDI[] = []

    for (const [pos, stats] of Object.entries(posStats)) {
      const mean = stats.sumPrem / stats.n
      totalPremSum += stats.sumPrem
      totalPremN += stats.n

      const posLdi = ldiScore(mean)
      positions.push({
        position: pos,
        meanPremiumPct: Math.round(mean * 10000) / 100,
        ldi: posLdi,
        sample: stats.n,
      })

      if (mean > topPct) {
        topPct = mean
        topPos = pos
      }
    }

    positions.sort((a, b) => b.meanPremiumPct - a.meanPremiumPct)

    results.push({
      managerName,
      totalTrades: actualTradeCount,
      positions,
      overallPremiumPct: totalPremN > 0 ? Math.round((totalPremSum / totalPremN) * 10000) / 100 : 0,
      topOverpayPosition: topPos,
      topOverpayPct: topPct !== -Infinity ? Math.round(topPct * 10000) / 100 : 0,
    })
  }

  results.sort((a, b) => b.overallPremiumPct - a.overallPremiumPct)
  return results
}

function emptyDemandIndex(leagueId: string): LeagueDemandIndex {
  return {
    leagueId,
    tradesAnalyzed: 0,
    positionDemand: [],
    pickDemand: [],
    hotPlayers: [],
    demandByPosition: {},
    demandJson: {
      QB: { ldi: 50, meanPremiumPct: 0, sample: 0 },
      RB: { ldi: 50, meanPremiumPct: 0, sample: 0 },
      WR: { ldi: 50, meanPremiumPct: 0, sample: 0 },
      TE: { ldi: 50, meanPremiumPct: 0, sample: 0 },
      PICK: { ldi: 50, meanPremiumPct: 0, sample: 0 },
    },
    perPlayerDemand: {},
    computedAt: Date.now(),
  }
}
