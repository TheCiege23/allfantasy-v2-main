import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getPickValue, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { computeTradeDrivers, computeBestLineupBySlot, type SlotAssignment } from '@/lib/trade-engine/trade-engine'
import { computeManagerTendencies, computeAcceptProbability, type ManagerTendencyProfile, type AcceptProbabilityResult } from '@/lib/trade-engine/manager-tendency-engine'
import { getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import type { Asset } from '@/lib/trade-engine/types'
import { buildBaselineMeta } from '@/lib/engine/response-guard'
import { fetchPlayerNewsFromGrok } from '@/lib/ai-gm-intelligence'
import { computeNewsValueAdjustments, type PlayerNewsData } from '@/lib/news-value-adjustment'

export const dynamic = 'force-dynamic'

interface QuickAsset {
  type: 'player' | 'pick' | 'faab'
  name?: string
  pos?: string
  team?: string
  id?: string
  year?: number
  round?: number
  pickNumber?: number
  amount?: number
}

const fcCache: { at: number; data: FantasyCalcPlayer[] | null; sf: boolean } = { at: 0, data: null, sf: false }
const FC_TTL = 10 * 60 * 1000

const newsCache: Map<string, { at: number; alerts: Array<{ playerName: string; sentiment: string; severity: string; reason: string; headlines: string[] }>; multipliers: Record<string, number> }> = new Map()
const NEWS_TTL = 3 * 60 * 1000

async function getFcPlayers(isSF: boolean, numTeams: number): Promise<FantasyCalcPlayer[]> {
  const now = Date.now()
  if (fcCache.data && now - fcCache.at < FC_TTL && fcCache.sf === isSF) return fcCache.data
  try {
    const players = await getFantasyCalcValuesDbFirst({
      isDynasty: true,
      numQbs: isSF ? 2 : 1,
      numTeams,
      ppr: 1,
    })
    fcCache.at = now
    fcCache.data = players
    fcCache.sf = isSF
    return players
  } catch {
    return fcCache.data || []
  }
}

function findFcPlayer(fcPlayers: FantasyCalcPlayer[], name: string): FantasyCalcPlayer | null {
  const lower = name.toLowerCase().trim()
  return fcPlayers.find(p => {
    const pName = (p.player?.name || '').toLowerCase().trim()
    return pName === lower
  }) || fcPlayers.find(p => {
    const pName = (p.player?.name || '').toLowerCase().trim()
    return pName.includes(lower) || lower.includes(pName)
  }) || null
}

function assetToTradeAsset(a: QuickAsset, fcPlayers: FantasyCalcPlayer[], isDynasty: boolean, numTeams: number = 12): Asset | null {
  if (a.type === 'player') {
    const fc = findFcPlayer(fcPlayers, a.name || '')
    const value = fc?.value || 0
    return {
      id: a.id || a.name || '',
      type: 'PLAYER',
      value,
      marketValue: value,
      impactValue: fc?.redraftValue || Math.round(value * 0.7),
      vorpValue: Math.round(value * 0.6),
      volatility: 0.2,
      name: a.name,
      pos: (a.pos || fc?.player?.position || '').toUpperCase(),
      team: a.team,
    }
  }
  if (a.type === 'pick') {
    const value = getPickValue(a.year || new Date().getFullYear(), a.round || 1, isDynasty, a.pickNumber || undefined, numTeams)
    return {
      id: `${a.year}_${a.round}_${a.pickNumber || ''}`,
      type: 'PICK',
      value,
      marketValue: value,
      round: a.round as 1 | 2 | 3 | 4 | undefined,
      pickSeason: a.year,
    }
  }
  if (a.type === 'faab') {
    return {
      id: `faab_${a.amount}`,
      type: 'FAAB',
      value: Math.round((a.amount || 0) * 2),
      marketValue: Math.round((a.amount || 0) * 2),
    }
  }
  return null
}

function rosterToAssets(players: any[], fcPlayers: FantasyCalcPlayer[], starterIds?: string[]): Asset[] {
  const starterSet = new Set(starterIds || [])
  return players
    .filter((p: any) => p.name && p.pos)
    .map((p: any) => {
      const fc = findFcPlayer(fcPlayers, p.name)
      const value = fc?.value || 0
      return {
        id: p.id || p.name,
        type: 'PLAYER' as const,
        value,
        marketValue: value,
        impactValue: fc?.redraftValue || Math.round(value * 0.7),
        vorpValue: Math.round(value * 0.6),
        volatility: 0.2,
        name: p.name,
        pos: (p.pos || '').toUpperCase(),
        team: p.team,
        slot: starterSet.has(p.id) ? 'Starter' as const : 'Bench' as const,
      }
    })
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/quick-evaluate", tool: "LegacyTradeQuickEvaluate" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const {
      assetsYouGet = [],
      assetsYouGive = [],
      yourRoster = [],
      theirRoster = [],
      yourStarters = [],
      theirStarters = [],
      rosterPositions = [],
      format = 'dynasty',
      numTeams = 12,
      leagueId,
      opponentUsername,
      leagueContext,
      suggestSweetener = false,
      sweetenerCandidates = [],
    } = body

    const isSF = leagueContext?.settings?.qbFormat === 'superflex' || leagueContext?.settings?.qbFormat === '2qb' || (rosterPositions.some((p: string) =>
      p === 'SUPER_FLEX' || p === 'QB'
    ) && rosterPositions.filter((p: string) => p === 'SUPER_FLEX' || p === 'QB').length >= 2)

    const isTEP = leagueContext?.settings?.tep?.enabled ?? false
    const isDynasty = format === 'dynasty'

    const fcPlayers = await getFcPlayers(isSF, numTeams)

    const involvedPlayerNames = [
      ...(assetsYouGet as QuickAsset[]).filter(a => a.type === 'player' && a.name).map(a => a.name!),
      ...(assetsYouGive as QuickAsset[]).filter(a => a.type === 'player' && a.name).map(a => a.name!),
    ]

    let newsMultipliers: Record<string, number> = {}
    let newsAlerts: Array<{ playerName: string; sentiment: string; severity: string; reason: string; headlines: string[] }> = []
    if (involvedPlayerNames.length > 0) {
      const cacheKey = [...involvedPlayerNames].sort().map(n => n.toLowerCase()).join('|')
      const cached = newsCache.get(cacheKey)
      const now = Date.now()

      if (cached && now - cached.at < NEWS_TTL) {
        newsMultipliers = cached.multipliers
        newsAlerts = cached.alerts
      } else {
        try {
          const playerNews = await fetchPlayerNewsFromGrok(involvedPlayerNames, 'nfl')
          if (playerNews && playerNews.length > 0) {
            const dummyMap = new Map<string, { value: number }>()
            involvedPlayerNames.forEach(n => {
              const fc = findFcPlayer(fcPlayers, n)
              if (fc) dummyMap.set(n.toLowerCase(), { value: fc.value })
            })
            const adjustments = computeNewsValueAdjustments(playerNews as PlayerNewsData[], dummyMap)
            for (const adj of adjustments) {
              if (adj.severity !== 'none') {
                newsMultipliers[adj.playerName.toLowerCase()] = adj.multiplier
                newsAlerts.push({
                  playerName: adj.playerName,
                  sentiment: adj.sentiment,
                  severity: adj.severity,
                  reason: adj.reason,
                  headlines: adj.newsHeadlines,
                })
              }
            }
          }
          newsCache.set(cacheKey, { at: now, alerts: newsAlerts, multipliers: newsMultipliers })
          if (newsCache.size > 50) {
            const oldest = [...newsCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
            if (oldest) newsCache.delete(oldest[0])
          }
        } catch (e) {
          console.warn('[quick-evaluate] News fetch failed (non-fatal):', (e as Error)?.message)
        }
      }
    }

    const receiveAssets = (assetsYouGet as QuickAsset[])
      .map(a => {
        const asset = assetToTradeAsset(a, fcPlayers, isDynasty, numTeams)
        if (asset && a.type === 'player' && a.name) {
          const mult = newsMultipliers[a.name.toLowerCase()]
          if (mult && mult !== 1.0) {
            asset.value = Math.round(asset.value * mult)
            asset.marketValue = Math.round((asset.marketValue ?? asset.value) * mult)
            if (asset.impactValue) asset.impactValue = Math.round(asset.impactValue * mult)
            if (asset.vorpValue) asset.vorpValue = Math.round(asset.vorpValue * mult)
          }
        }
        return asset
      })
      .filter(Boolean) as Asset[]
    const giveAssets = (assetsYouGive as QuickAsset[])
      .map(a => {
        const asset = assetToTradeAsset(a, fcPlayers, isDynasty, numTeams)
        if (asset && a.type === 'player' && a.name) {
          const mult = newsMultipliers[a.name.toLowerCase()]
          if (mult && mult !== 1.0) {
            asset.value = Math.round(asset.value * mult)
            asset.marketValue = Math.round((asset.marketValue ?? asset.value) * mult)
            if (asset.impactValue) asset.impactValue = Math.round(asset.impactValue * mult)
            if (asset.vorpValue) asset.vorpValue = Math.round(asset.vorpValue * mult)
          }
        }
        return asset
      })
      .filter(Boolean) as Asset[]

    if (receiveAssets.length === 0 && giveAssets.length === 0) {
      return NextResponse.json({ error: 'No assets provided' }, { status: 400 })
    }

    const allZero = [...receiveAssets, ...giveAssets].every(a => a.value === 0)
    if (allZero) {
      return NextResponse.json({
        success: true,
        verdict: "insufficient_data",
        fairnessScore: 0,
        acceptProbability: 0,
        drivers: [],
        meta: buildBaselineMeta(
          "insufficient_assets",
          "Unable to evaluate trade due to missing player valuation data."
        ),
      })
    }

    const yourRosterAssets = rosterToAssets(yourRoster, fcPlayers, yourStarters)
    const theirRosterAssets = rosterToAssets(theirRoster, fcPlayers, theirStarters)

    const rosterCtx = yourRosterAssets.length > 0 && rosterPositions.length > 0
      ? { yourRoster: yourRosterAssets, theirRoster: theirRosterAssets, rosterPositions }
      : undefined

    const calWeights = await getCalibratedWeights()

    const drivers = computeTradeDrivers(
      giveAssets, receiveAssets,
      null, null,
      isSF, isTEP,
      rosterCtx,
      undefined, undefined, undefined, undefined,
      calWeights,
    )

    let slotMap: { before: SlotAssignment[]; after: SlotAssignment[]; deltas: { slot: string; beforePlayer?: string; afterPlayer?: string; beforePPG: number; afterPPG: number; delta: number }[] } | null = null
    if (rosterPositions.length > 0 && yourRosterAssets.length > 0) {
      const giveIds = new Set(giveAssets.map(a => a.id))
      const yourRosterAfter = [
        ...yourRosterAssets.filter(a => !giveIds.has(a.id)),
        ...receiveAssets,
      ]
      const before = computeBestLineupBySlot(yourRosterAssets, rosterPositions)
      const after = computeBestLineupBySlot(yourRosterAfter, rosterPositions)
      const deltas = before.map((b, i) => ({
        slot: b.slot,
        beforePlayer: b.playerName,
        afterPlayer: after[i]?.playerName,
        beforePPG: Math.round(b.ppg * 100) / 100,
        afterPPG: Math.round((after[i]?.ppg ?? 0) * 100) / 100,
        delta: Math.round(((after[i]?.ppg ?? 0) - b.ppg) * 100) / 100,
      }))
      slotMap = { before, after, deltas }
    }

    let opponentTendency: ManagerTendencyProfile | null = null
    if (opponentUsername && leagueId) {
      try {
        opponentTendency = await computeManagerTendencies(opponentUsername, leagueId)
      } catch { /* ignore */ }
    }

    let sweeteners: { asset: QuickAsset; acceptDelta: number; fairnessImpact: number; ratio: number }[] = []
    if (suggestSweetener && sweetenerCandidates.length > 0) {
      const baseAccept = drivers.acceptProbability
      const baseFairness = drivers.fairnessDelta

      const candidates = (sweetenerCandidates as QuickAsset[]).slice(0, 20)
      const results: typeof sweeteners = []

      for (const candidate of candidates) {
        const candidateAsset = assetToTradeAsset(candidate, fcPlayers, isDynasty, numTeams)
        if (!candidateAsset || candidateAsset.value < 50) continue

        const newGiveAssets = [...giveAssets, candidateAsset]
        const newDrivers = computeTradeDrivers(
          newGiveAssets, receiveAssets,
          null, null,
          isSF, isTEP,
          rosterCtx,
          undefined, undefined, undefined, undefined,
          calWeights,
        )

        const acceptDelta = Math.round((newDrivers.acceptProbability - baseAccept) * 100) / 100
        const fairnessImpact = Math.round(newDrivers.fairnessDelta - baseFairness)

        if (acceptDelta > 0.02 && fairnessImpact > -15) {
          const ratio = acceptDelta / Math.max(1, Math.abs(fairnessImpact))
          results.push({ asset: candidate, acceptDelta, fairnessImpact, ratio })
        }
      }

      results.sort((a, b) => b.ratio - a.ratio)
      sweeteners = results.slice(0, 3)
    }

    return NextResponse.json({
      success: true,
      acceptProbability: Math.round(drivers.acceptProbability * 100),
      acceptLabel: drivers.labels[0] || '',
      totalScore: Math.round(drivers.totalScore * 100),
      fairnessDelta: drivers.fairnessDelta,
      verdict: drivers.verdict,
      lean: drivers.lean,
      confidence: drivers.confidenceScore,

      scores: {
        lineupImpact: Math.round(drivers.lineupImpactScore * 100),
        vorp: Math.round(drivers.vorpScore * 100),
        market: Math.round(drivers.marketScore * 100),
        behavior: Math.round(drivers.behaviorScore * 100),
      },
      scoringMode: drivers.scoringMode,

      lineupDelta: drivers.lineupDelta ? {
        deltaYou: drivers.lineupDelta.deltaYou,
        deltaThem: drivers.lineupDelta.deltaThem,
        beforeYou: drivers.lineupDelta.beforeYou,
        afterYou: drivers.lineupDelta.afterYou,
      } : null,

      slotMap,
      acceptDrivers: drivers.acceptDrivers,
      riskFlags: drivers.riskFlags,
      dominantDriver: drivers.dominantDriver,
      driverNarrative: drivers.driverNarrative,
      marketDeltaPct: drivers.marketDeltaPct,

      opponentTendency: opponentTendency ? {
        positionBias: opponentTendency.positionBias,
        overpayThreshold: opponentTendency.overpayThreshold,
        riskTolerance: opponentTendency.riskTolerance,
        consolidationBias: opponentTendency.consolidationBias,
        fairnessTolerance: opponentTendency.fairnessTolerance,
        starterPremium: opponentTendency.starterPremium,
        sampleSize: opponentTendency.sampleSize,
      } : null,

      sweeteners,

      newsAlerts: newsAlerts.length > 0 ? newsAlerts : undefined,

      assetValues: {
        youGet: receiveAssets.map(a => ({ id: a.id, name: a.name || a.id, value: a.value, pos: a.pos })),
        youGive: giveAssets.map(a => ({ id: a.id, name: a.name || a.id, value: a.value, pos: a.pos })),
        youGetTotal: receiveAssets.reduce((s, a) => s + a.value, 0),
        youGiveTotal: giveAssets.reduce((s, a) => s + a.value, 0),
      },
    })
  } catch (e) {
    console.error('quick-evaluate error:', e)
    return NextResponse.json({ error: 'Failed to evaluate trade' }, { status: 500 })
  }
})
