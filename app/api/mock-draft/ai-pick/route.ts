import { NextRequest, NextResponse } from 'next/server'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchNewsContext } from '@/lib/upstream-apis'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getStrategyMetaReports } from '@/lib/strategy-meta'
import { getInsightBundle } from '@/lib/ai-simulation-integration'
import { computeDraftRecommendation } from '@/lib/draft-helper/RecommendationEngine'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'
import { aiCostGate, evaluateAiCostGate } from '@/lib/ai-protection/costGate'
// Grok news was fetched on EVERY pick with no cache — see lib/mock-draft/grokNewsCache.ts.
import { fetchPlayerNewsCached } from '@/lib/mock-draft/grokNewsCache'

const openai = getOpenAIRouteClient()

type Mode = 'needs' | 'bpa'

type ScoutPlayer = {
  name: string
  position: string
  team?: string | null
  adp?: number | null
  value?: number | null
  isRookie?: boolean
  sleeperId?: string | null
}

type LeagueContextInput = {
  rosterPositions?: string[]
  scoringSettings?: Record<string, number>
}

type StrategyMetaContextRow = {
  strategyType: string
  strategyLabel?: string
  usageRate: number
  successRate: number
  trendingDirection: string
}

const FLEX_SLOT_NAMES = new Set(['FLEX', 'SUPER_FLEX', 'SUPERFLEX', 'OP', 'UTIL', 'BENCH', 'BN', 'IR', 'TAXI'])

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function normalizeName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[.'-]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function defaultTargetsForSport(sport: string): Record<string, { starter: number; ideal: number }> {
  switch (normalizeToSupportedSport(sport)) {
    case 'NBA':
    case 'NCAAB':
      return {
        PG: { starter: 1, ideal: 2 },
        SG: { starter: 1, ideal: 2 },
        SF: { starter: 1, ideal: 2 },
        PF: { starter: 1, ideal: 2 },
        C: { starter: 1, ideal: 2 },
      }
    case 'MLB':
      return {
        C: { starter: 1, ideal: 1 },
        '1B': { starter: 1, ideal: 2 },
        '2B': { starter: 1, ideal: 2 },
        '3B': { starter: 1, ideal: 2 },
        SS: { starter: 1, ideal: 2 },
        OF: { starter: 3, ideal: 5 },
        P: { starter: 3, ideal: 6 },
      }
    case 'NHL':
      return {
        C: { starter: 2, ideal: 3 },
        LW: { starter: 2, ideal: 3 },
        RW: { starter: 2, ideal: 3 },
        D: { starter: 2, ideal: 4 },
        G: { starter: 1, ideal: 2 },
      }
    case 'SOCCER':
      return {
        GKP: { starter: 1, ideal: 1 },
        DEF: { starter: 4, ideal: 6 },
        MID: { starter: 4, ideal: 6 },
        FWD: { starter: 2, ideal: 4 },
      }
    case 'NCAAF':
    case 'NFL':
    default:
      return {
        QB: { starter: 1, ideal: 2 },
        RB: { starter: 2, ideal: 5 },
        WR: { starter: 2, ideal: 5 },
        TE: { starter: 1, ideal: 2 },
        K: { starter: 1, ideal: 1 },
        DEF: { starter: 1, ideal: 1 },
      }
  }
}

function normalizePositionForSport(position: string, sport: string): string {
  const normalized = String(position || '').toUpperCase().trim()
  const normalizedSport = normalizeToSupportedSport(sport)
  if (!normalized) return ''

  if (['NFL', 'NCAAF'].includes(normalizedSport) && (normalized === 'DST' || normalized === 'D/ST')) {
    return 'DEF'
  }

  if (normalizedSport === 'MLB') {
    if (normalized === 'SP' || normalized === 'RP') return 'P'
    if (normalized === 'LF' || normalized === 'CF' || normalized === 'RF') return 'OF'
  }

  return normalized
}

function buildScoringProfile(args: {
  rosterSlots: string[]
  scoringSettings?: Record<string, number>
  isSF?: boolean
}): { isSuperflex: boolean; isTEP: boolean } {
  const slots = (args.rosterSlots || []).map((slot) => String(slot || '').toUpperCase())
  const scoring = args.scoringSettings || {}
  const isSuperflex =
    Boolean(args.isSF) ||
    slots.includes('SUPER_FLEX') ||
    slots.includes('SUPERFLEX') ||
    slots.includes('OP') ||
    slots.filter((s) => s === 'QB').length >= 2
  const rec = Number(scoring.rec || 1)
  const teBonus = Number(scoring.bonus_rec_te || 0)
  const isTEP = teBonus >= 0.5 || rec >= 1.5
  return { isSuperflex, isTEP }
}

function buildPositionTargetsFromRosterSlots(
  rosterSlots: string[],
  sport: string,
): Record<string, { starter: number; ideal: number }> {
  const normalizedSport = normalizeToSupportedSport(sport)
  const defaults = defaultTargetsForSport(normalizedSport)
  const targets: Record<string, { starter: number; ideal: number }> = {}

  for (const rawSlot of rosterSlots || []) {
    const slot = normalizePositionForSport(rawSlot, normalizedSport)
    if (!slot || FLEX_SLOT_NAMES.has(slot)) continue
    if (['NBA', 'NCAAB'].includes(normalizedSport) && (slot === 'G' || slot === 'F')) continue
    if (normalizedSport === 'MLB' && slot === 'DH') continue
    if (['NFL', 'NCAAF'].includes(normalizedSport) && ['DL', 'DB', 'IDP_FLEX'].includes(slot)) continue

    const existing = targets[slot] || { starter: 0, ideal: 0 }
    existing.starter += 1
    existing.ideal = Math.max(existing.starter + 1, defaults[slot]?.ideal ?? existing.ideal)
    targets[slot] = existing
  }

  if (Object.keys(targets).length === 0) {
    return { ...defaults }
  }

  for (const [position, config] of Object.entries(defaults)) {
    if (!targets[position]) continue
    targets[position].ideal = Math.max(targets[position].ideal, config.ideal)
  }

  return targets
}

function computeTeamNeeds(
  roster: { position: string }[],
  rosterSlots: string[],
  sport: string,
  isSF: boolean,
): Record<string, number> {
  const normalizedSport = normalizeToSupportedSport(sport)
  const counts: Record<string, number> = {}
  for (const p of roster) {
    const pos = normalizePositionForSport(p.position, normalizedSport)
    if (!pos) continue
    counts[pos] = (counts[pos] || 0) + 1
  }

  const targetsByPosition = buildPositionTargetsFromRosterSlots(rosterSlots, normalizedSport)
  const needs: Record<string, number> = {}
  for (const [pos, targets] of Object.entries(targetsByPosition)) {
    const count = counts[pos] || 0
    if (count < targets.starter) {
      needs[pos] = clamp(88 + (targets.starter - count) * 10, 0, 100)
    } else if (count < targets.ideal) {
      needs[pos] = clamp(42 + (targets.ideal - count) * 12, 0, 100)
    } else {
      needs[pos] = 10
    }
  }

  if (isSF && ['NFL', 'NCAAF'].includes(normalizedSport)) {
    needs.QB = clamp((needs.QB || 50) + 18, 0, 100)
  }

  for (const rawSlot of rosterSlots) {
    const slot = normalizePositionForSport(rawSlot, normalizedSport)
    if (!slot) continue

    if (slot === 'FLEX') {
      needs.RB = clamp((needs.RB || 20) + 8, 0, 100)
      needs.WR = clamp((needs.WR || 20) + 8, 0, 100)
      needs.TE = clamp((needs.TE || 20) + 4, 0, 100)
    }

    if (slot === 'SUPER_FLEX' || slot === 'SUPERFLEX' || slot === 'OP') {
      needs.QB = clamp((needs.QB || 50) + 12, 0, 100)
    }

    if (['NBA', 'NCAAB'].includes(normalizedSport) && slot === 'G') {
      needs.PG = clamp((needs.PG || 20) + 8, 0, 100)
      needs.SG = clamp((needs.SG || 20) + 8, 0, 100)
    }

    if (['NBA', 'NCAAB'].includes(normalizedSport) && slot === 'F') {
      needs.SF = clamp((needs.SF || 20) + 8, 0, 100)
      needs.PF = clamp((needs.PF || 20) + 8, 0, 100)
    }

    if (['NBA', 'NCAAB'].includes(normalizedSport) && slot === 'UTIL') {
      for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
        needs[pos] = clamp((needs[pos] || 20) + 4, 0, 100)
      }
    }

    if (normalizedSport === 'MLB' && (slot === 'DH' || slot === 'UTIL')) {
      for (const pos of ['C', '1B', '2B', '3B', 'SS', 'OF']) {
        needs[pos] = clamp((needs[pos] || 20) + 4, 0, 100)
      }
    }

    if (normalizedSport === 'NHL' && slot === 'UTIL') {
      for (const pos of ['C', 'LW', 'RW', 'D']) {
        needs[pos] = clamp((needs[pos] || 20) + 4, 0, 100)
      }
    }

    if (['NFL', 'NCAAF'].includes(normalizedSport) && slot === 'DL') {
      needs.DE = clamp((needs.DE || 20) + 8, 0, 100)
      needs.DT = clamp((needs.DT || 20) + 8, 0, 100)
    }

    if (['NFL', 'NCAAF'].includes(normalizedSport) && slot === 'DB') {
      needs.CB = clamp((needs.CB || 20) + 8, 0, 100)
      needs.S = clamp((needs.S || 20) + 8, 0, 100)
    }

    if (['NFL', 'NCAAF'].includes(normalizedSport) && slot === 'IDP_FLEX') {
      for (const pos of ['DE', 'DT', 'LB', 'CB', 'S']) {
        needs[pos] = clamp((needs[pos] || 20) + 5, 0, 100)
      }
    }
  }

  return needs
}

function buildNewsSignalMap(args: {
  available: ScoutPlayer[]
  newsContext: Awaited<ReturnType<typeof fetchNewsContext>> | null
  grokNews: Array<{ playerName: string; sentiment: string; news: string[]; buzz: string }>
}): Map<string, { score: number; signals: string[] }> {
  const byPlayer = new Map<string, { score: number; signals: string[] }>()

  const add = (name: string, score: number, signal: string) => {
    const key = normalizeName(name)
    if (!key) return
    const existing = byPlayer.get(key) || { score: 0, signals: [] }
    existing.score += score
    if (signal) existing.signals.push(signal)
    byPlayer.set(key, existing)
  }

  const knownNames = new Map(args.available.map((p) => [normalizeName(p.name), p.name]))

  for (const item of args.newsContext?.items || []) {
    const title = String(item.title || '')
    const low = title.toLowerCase()
    for (const [k, originalName] of knownNames.entries()) {
      if (!k) continue
      const first = k.split(' ')[0]
      if (low.includes(k) || (first && low.includes(first))) {
        if (item.isInjury || /out|ir|injury|doubtful|questionable|suspension/.test(low)) {
          add(originalName, -12, 'Injury/availability risk in recent news')
        } else if (/starter|promoted|breakout|impressed|surge|extension/.test(low)) {
          add(originalName, 7, 'Positive usage/momentum signal')
        } else {
          add(originalName, 2, 'Recent relevant news mention')
        }
      }
    }
  }

  for (const item of args.grokNews || []) {
    const s = String(item.sentiment || 'neutral').toLowerCase()
    const topHeadline = item.news?.[0] || ''
    if (s === 'bullish') add(item.playerName, 8, topHeadline || 'Bullish X/Twitter sentiment')
    else if (s === 'bearish') add(item.playerName, -8, topHeadline || 'Bearish X/Twitter sentiment')
    else if (s === 'injury_concern') add(item.playerName, -12, topHeadline || 'Injury concern from X/Twitter')
    else add(item.playerName, 1, topHeadline || 'Neutral X/Twitter sentiment')
  }

  return byPlayer
}

function scoreCandidates(args: {
  available: ScoutPlayer[]
  teamRoster: { position: string }[]
  rosterSlots: string[]
  sport: string
  isRookieDraft: boolean
  isDynasty: boolean
  mode: Mode
  round: number
  pick: number
  totalTeams: number
  scoringProfile: { isSuperflex: boolean; isTEP: boolean }
  newsSignals: Map<string, { score: number; signals: string[] }>
}) {
  const normalizedSport = normalizeToSupportedSport(args.sport)
  const needs = computeTeamNeeds(args.teamRoster, args.rosterSlots, normalizedSport, args.scoringProfile.isSuperflex)
  const overall = (args.round - 1) * args.totalTeams + args.pick

  const ranked = args.available.slice(0, 80).map((p) => {
    const pos = normalizePositionForSport(p.position, normalizedSport)
    const needScore = needs[pos] || 20
    const adp = Number(p.adp || 999)
    const adpEdge = clamp((overall - adp) * 1.4, -20, 25)
    const valueScore = clamp(Number(p.value || 2000) / 2500, 0.4, 2.4) * 18

    let formatBoost = 0
    if (['NFL', 'NCAAF'].includes(normalizedSport) && args.scoringProfile.isSuperflex && pos === 'QB') formatBoost += 14
    if (['NFL', 'NCAAF'].includes(normalizedSport) && args.scoringProfile.isTEP && pos === 'TE') formatBoost += 10
    if (args.isRookieDraft && p.isRookie) formatBoost += 18
    if (args.isDynasty && p.isRookie) formatBoost += 8

    if (['NFL', 'NCAAF'].includes(normalizedSport) && args.round <= 2 && !args.scoringProfile.isSuperflex && pos === 'QB') formatBoost -= 10
    if (['NFL', 'NCAAF'].includes(normalizedSport) && args.round >= 5 && (pos === 'K' || pos === 'DEF')) formatBoost -= 6

    const news = args.newsSignals.get(normalizeName(p.name)) || { score: 0, signals: [] }

    const modeAdjustment = args.mode === 'bpa' ? 0 : needScore * 0.55
    const bpaAdjustment = args.mode === 'bpa' ? valueScore * 0.6 + adpEdge * 0.5 : 0

    const totalScore =
      modeAdjustment +
      bpaAdjustment +
      valueScore * 0.5 +
      adpEdge * 0.9 +
      formatBoost +
      news.score

    return {
      player: p,
      totalScore,
      needScore,
      adpEdge,
      formatBoost,
      newsSignals: news.signals,
      confidence: clamp(Math.round(58 + totalScore * 0.7), 45, 96),
    }
  })

  ranked.sort((a, b) => b.totalScore - a.totalScore)
  return { ranked, needs, overall }
}

function buildPickReasoning(args: {
  sport: string
  managerName: string
  chosen: ReturnType<typeof scoreCandidates>['ranked'][number]
  needs: Record<string, number>
  overall: number
  isRookieDraft: boolean
  scoringProfile: { isSuperflex: boolean; isTEP: boolean }
  strategyMetaContext?: StrategyMetaContextRow[]
}): string {
  const c = args.chosen
  const normalizedPosition = normalizePositionForSport(c.player.position, args.sport)
  const posNeed = args.needs[normalizedPosition] || 0
  const tags: string[] = []
  if (posNeed >= 70) tags.push(`fills a critical ${normalizedPosition || c.player.position} need`)
  else if (posNeed >= 45) tags.push(`improves ${normalizedPosition || c.player.position} depth`)

  if ((c.player.adp || 999) < args.overall - 2) tags.push(`value vs ADP (${Number(c.player.adp).toFixed(1)})`)
  if (['NFL', 'NCAAF'].includes(normalizeToSupportedSport(args.sport)) && args.scoringProfile.isSuperflex && normalizedPosition === 'QB') tags.push('Superflex QB premium applied')
  if (['NFL', 'NCAAF'].includes(normalizeToSupportedSport(args.sport)) && args.scoringProfile.isTEP && normalizedPosition === 'TE') tags.push('TE premium scoring boost')
  if (args.isRookieDraft && c.player.isRookie) tags.push('rookie-board priority')
  if (c.newsSignals.length > 0) tags.push(c.newsSignals[0])
  if ((args.strategyMetaContext?.length ?? 0) > 0) {
    const top = args.strategyMetaContext![0]
    tags.push(`aligned with ${top.strategyLabel ?? top.strategyType} meta`)
  }

  const summary = tags.length > 0 ? tags.slice(0, 3).join(', ') : 'fits the current board and roster context'
  return `${args.managerName} selects ${c.player.name}. This pick ${summary}.`
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Burst limit only — a daily cap here would cut a mock off mid-draft (see mock_ai_pick).
    const burst = await aiCostGate(req, 'mock_ai_pick', session.user.id)
    if (burst) return burst

    const body = await req.json()
    const {
      action = 'pick',
      available = [],
      teamRoster = [],
      rosterSlots = [],
      round = 1,
      pick = 1,
      totalTeams = 12,
      managerName = 'AI Manager',
      sport = 'NFL',
      isDynasty = true,
      isSF = false,
      isRookieDraft = false,
      mode = 'needs',
      leagueContext,
      leagueId,
      nextManagers = [],
    } = body as {
      action?: 'pick' | 'dm-suggestion' | 'trade-proposal' | 'predict-next'
      available?: ScoutPlayer[]
      teamRoster?: { position: string }[]
      rosterSlots?: string[]
      round?: number
      pick?: number
      totalTeams?: number
      managerName?: string
      sport?: string
      isDynasty?: boolean
      isSF?: boolean
      isRookieDraft?: boolean
      mode?: Mode
      leagueContext?: LeagueContextInput
      leagueId?: string
      nextManagers?: string[]
    }

    const safeAvailable = Array.isArray(available) ? available : []
    if (safeAvailable.length === 0) {
      return NextResponse.json({ error: 'No available players' }, { status: 400 })
    }

    const effectiveRosterSlots = Array.isArray(rosterSlots) && rosterSlots.length > 0
      ? rosterSlots
      : ((leagueContext?.rosterPositions || []) as string[])
    const scoringProfile = buildScoringProfile({
      rosterSlots: effectiveRosterSlots,
      scoringSettings: leagueContext?.scoringSettings,
      isSF,
    })

    const normalizedSport = normalizeToSupportedSport(sport)
    const strategyMetaContextPromise = getStrategyMetaReports({
      sport: normalizedSport,
      timeframe: '30d',
    }).catch(() => [] as StrategyMetaContextRow[])
    const insightBundlePromise =
      typeof leagueId === 'string' && leagueId.trim().length > 0
        ? getInsightBundle(leagueId, 'draft', {
            sport: normalizedSport,
          }).catch(() => null)
        : Promise.resolve(null)

    const topCandidateNames = safeAvailable.slice(0, 25).map((p) => p.name).filter(Boolean)

    const shouldUseNflNewsOverlay = normalizedSport === 'NFL'

    const [newsContext, grokNews, strategyMetaRows, insightBundle] = shouldUseNflNewsOverlay
      ? await Promise.all([
          fetchNewsContext(
            { prisma, newsApiKey: process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY },
            {
              playerNames: topCandidateNames,
              sport: 'NFL',
              hoursBack: 120,
              limit: 30,
            },
          ).catch(() => null),
          fetchPlayerNewsCached(topCandidateNames.slice(0, 15)).catch(() => []),
          strategyMetaContextPromise,
          insightBundlePromise,
        ])
      : [
          null,
          [] as Array<{ playerName: string; sentiment: string; news: string[]; buzz: string }>,
          await strategyMetaContextPromise,
          await insightBundlePromise,
        ]

    const strategyMetaContext = (strategyMetaRows ?? []).slice(0, 4).map((row) => ({
      strategyType: row.strategyType,
      strategyLabel: row.strategyLabel,
      usageRate: row.usageRate,
      successRate: row.successRate,
      trendingDirection: row.trendingDirection,
    }))

    const newsSignals = buildNewsSignalMap({
      available: safeAvailable,
      newsContext,
      grokNews,
    })

    const scored = scoreCandidates({
      available: safeAvailable,
      teamRoster,
      rosterSlots: effectiveRosterSlots,
      sport: normalizedSport,
      isRookieDraft,
      isDynasty,
      mode: mode === 'bpa' ? 'bpa' : 'needs',
      round,
      pick,
      totalTeams,
      scoringProfile,
      newsSignals,
    })

    const legacyMeta = {
        status: 'ok',
        screen: 'draft_war_room',
        meta: {
          confidence: Math.max(0.45, Math.min(0.96, (scored.ranked[0]?.confidence || 72) / 100)),
          usedLiveNewsOverlay: shouldUseNflNewsOverlay,
          usedSimulation: action === 'predict-next',
          strategyMetaSignals: strategyMetaContext.slice(0, 3).map((row) => ({
            strategyType: row.strategyType,
            usageRate: row.usageRate,
            successRate: row.successRate,
            trendingDirection: row.trendingDirection,
          })),
          generatedAt: new Date().toISOString(),
          requestId: `req_${Date.now()}_mock_ai_pick`,
          aiStack: {
            orchestrator: 'openai',
            structuredEvaluator: 'deepseek',
            liveNewsOverlay: shouldUseNflNewsOverlay ? 'grok' : 'none',
          },
        },
      errors: [],
    }

    if (action === 'pick') {
      const selected = scored.ranked[0]
      return NextResponse.json({
        legacyEnvelope: legacyMeta,
        pick: {
          playerName: selected.player.name,
          position: selected.player.position,
          team: selected.player.team || null,
          adp: selected.player.adp,
          sleeperId: selected.player.sleeperId || null,
          isRookie: Boolean(selected.player.isRookie),
        },
        scorecard: {
          totalScore: Number(selected.totalScore.toFixed(2)),
          confidence: selected.confidence,
          needScore: selected.needScore,
          adpEdge: Number(selected.adpEdge.toFixed(2)),
          formatBoost: selected.formatBoost,
          newsSignals: selected.newsSignals.slice(0, 2),
        },
        reasoning: buildPickReasoning({
          managerName,
          chosen: selected,
          sport: normalizedSport,
          needs: scored.needs,
          overall: scored.overall,
          isRookieDraft,
          scoringProfile,
          strategyMetaContext,
        }),
        strategyMetaContext,
      })
    }

    if (action === 'predict-next') {
      const managers = Array.isArray(nextManagers) && nextManagers.length > 0
        ? nextManagers.slice(0, 8)
        : ['Manager 2', 'Manager 3', 'Manager 4']

      const predictions = managers.map((m, idx) => {
        const candidate = scored.ranked[Math.min(idx, scored.ranked.length - 1)]
        return {
          manager: m,
          predictedPlayer: candidate.player.name,
          position: candidate.player.position,
          probability: clamp(72 - idx * 9, 36, 90),
          reason: `${candidate.player.position} need + ADP board fit`,
        }
      })

      return NextResponse.json({
        legacyEnvelope: legacyMeta,
        predictions,
        context: {
          overall: scored.overall,
          scoringProfile,
          strategyMetaContext,
          topNeeds: Object.entries(scored.needs)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3),
        },
      })
    }

    if (action === 'dm-suggestion') {
      const deterministic = computeDraftRecommendation({
        available: safeAvailable.map((p) => ({
          name: p.name,
          position: p.position,
          team: p.team ?? null,
          adp: p.adp ?? null,
          byeWeek: null,
        })),
        teamRoster,
        rosterSlots: effectiveRosterSlots,
        round,
        pick,
        totalTeams,
        sport: normalizedSport,
        isDynasty,
        isSF: scoringProfile.isSuperflex,
        mode: mode === 'bpa' ? 'bpa' : 'needs',
      })
      const deterministicSuggestions = [
        ...(deterministic.recommendation
          ? [{
              player: deterministic.recommendation.player.name,
              position: deterministic.recommendation.player.position,
              team: deterministic.recommendation.player.team ?? null,
              adp: deterministic.recommendation.player.adp ?? null,
              reason: deterministic.recommendation.reason,
              confidence: deterministic.recommendation.confidence,
              type: 'primary' as const,
            }]
          : []),
        ...deterministic.alternatives.map((item, idx) => ({
          player: item.player.name,
          position: item.player.position,
          team: item.player.team ?? null,
          adp: item.player.adp ?? null,
          reason: item.reason,
          confidence: item.confidence,
          type: (idx === 0 ? 'pivot' : 'value') as 'pivot' | 'value',
        })),
      ].slice(0, 3)
      const suggestions = deterministicSuggestions.length > 0
        ? deterministicSuggestions
        : scored.ranked.slice(0, 3).map((item, idx) => ({
            player: item.player.name,
            position: item.player.position,
            team: item.player.team || null,
            adp: item.player.adp,
            reason:
              idx === 0
                ? 'Best blend of roster fit, market value, and current signals'
                : idx === 1
                  ? 'Alternative with strong upside if top option is sniped'
                  : 'Leverage/value fallback with acceptable risk profile',
            confidence: item.confidence,
            type: idx === 0 ? 'primary' : idx === 1 ? 'pivot' : 'value',
          }))

      const topNeeds = Object.entries(scored.needs)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)

      let aiInsight = ''
      // The one per-pick action that calls OpenAI. Over the daily cap the deterministic
      // suggestions above still return; only the written scout note is left out.
      const suggestionGate = await evaluateAiCostGate(req, 'mock_ai_suggestion', session.user.id)
      if (suggestionGate.ok) try {
        const sportLabel = normalizedSport === 'NFL'
          ? 'football'
          : normalizedSport === 'NBA'
            ? 'basketball'
            : normalizedSport === 'MLB'
              ? 'baseball'
              : normalizedSport.toLowerCase()
        const prompt = `You are a fantasy ${sportLabel} draft scout helping a manager pick now.
League profile: ${normalizedSport} ${isDynasty ? 'Dynasty' : 'Redraft'}${isRookieDraft ? ', Rookie Draft' : ''}${scoringProfile.isSuperflex ? ', Superflex' : ''}${scoringProfile.isTEP ? ', TE Premium' : ''}.
On clock: Round ${round}, Pick ${pick}, Overall ${scored.overall}.
Top roster needs: ${topNeeds.map(([pos, score]) => `${pos} (${score})`).join(', ')}.
Strategy meta context: ${strategyMetaContext.slice(0, 3).map((s) => `${s.strategyLabel ?? s.strategyType} (${Math.round(s.usageRate * 100)}% usage, ${Math.round(s.successRate * 100)}% success)`).join('; ') || 'none'}.
Candidates: ${suggestions.map((s) => `${s.player} (${s.position}, ADP ${Number(s.adp || 999).toFixed(1)})`).join('; ')}.
${insightBundle?.contextText ? `Simulation/Warehouse context: ${insightBundle.contextText}.` : ''}
${insightBundle ? `Model roles: DeepSeek ${insightBundle.modelResponsibilities.deepseek}; Grok ${insightBundle.modelResponsibilities.grok}; OpenAI ${insightBundle.modelResponsibilities.openai}.` : ''}
Return exactly 2 concise sentences with clear action and fallback.`

        const aiResult = await getOrCreateAiResult({
          feature: 'mock-draft-ai-pick-insight',
          scopeType: 'league',
          scopeId: (typeof leagueId === 'string' && leagueId.trim().length > 0) ? leagueId.trim() : `user:${session.user.id}`,
          provider: 'openai',
          model: 'gpt-4o-mini',
          ttlSeconds: 30 * 60,
          payload: {
            mockDraftSessionId:
              (typeof (body as any)?.mockDraftSessionId === 'string' && (body as any).mockDraftSessionId.trim()) ||
              (typeof (body as any)?.draftId === 'string' && (body as any).draftId.trim()) ||
              null,
            leagueId: (typeof leagueId === 'string' && leagueId.trim()) || null,
            userId: session.user.id,
            sport: normalizedSport,
            season: String((body as any)?.season || ''),
            draftType: String((body as any)?.draftType || ''),
            scoringFormat: String((body as any)?.scoringFormat || ''),
            currentPick: {
              round: Number(round || 0),
              pick: Number(pick || 0),
              overall: Number(scored.overall || 0),
            },
            teamNeeds: Object.entries(scored.needs)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([pos, score]) => ({ pos, score })),
            availablePlayerIds: safeAvailable
              .map((p) => p.sleeperId || normalizeName(p.name))
              .filter(Boolean)
              .slice(0, 150),
            priorPickIds: Array.isArray((body as any)?.priorPickIds) ? (body as any).priorPickIds.slice(0, 400) : [],
            suggestions: suggestions.map((s) => ({
              player: s.player,
              position: s.position,
              adp: s.adp ?? null,
              confidence: s.confidence,
              type: s.type,
            })),
            strategyMetaContext,
            promptVersion: 'v1',
          },
          onCacheMiss: async () => {
            const resp = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 120,
              temperature: 0.4,
            })

            return {
              resultText: resp.choices[0]?.message?.content || '',
              resultJson: null,
              tokenPrompt: null,
              tokenOutput: null,
            }
          },
        })

        if (aiResult.cacheHit) {
          console.log(`[mock-draft/ai-pick] AI cache hit { leagueId: '${(typeof leagueId === 'string' && leagueId.trim()) || 'none'}', action: 'dm-suggestion' }`)
        } else {
          console.log(`[mock-draft/ai-pick] AI cache miss { leagueId: '${(typeof leagueId === 'string' && leagueId.trim()) || 'none'}', action: 'dm-suggestion', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
          console.log(`[mock-draft/ai-pick] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
        }

        aiInsight = aiResult.row.resultText || ''
      } catch {
        aiInsight = ''
      }

      return NextResponse.json({
        legacyEnvelope: legacyMeta,
        suggestions,
        recommendation: deterministic.recommendation,
        alternatives: deterministic.alternatives,
        reachWarning: deterministic.reachWarning,
        valueWarning: deterministic.valueWarning,
        scarcityInsight: deterministic.scarcityInsight,
        stackInsight: deterministic.stackInsight,
        correlationInsight: deterministic.correlationInsight,
        formatInsight: deterministic.formatInsight,
        byeNote: deterministic.byeNote,
        evidence: deterministic.evidence,
        caveats: deterministic.caveats,
        uncertainty: deterministic.uncertainty,
        needs: Object.fromEntries(topNeeds),
        rosterCounts: teamRoster.reduce((acc: Record<string, number>, p: { position: string }) => {
          const pos = normalizePositionForSport(p.position, normalizedSport)
          if (!pos) return acc
          acc[pos] = (acc[pos] || 0) + 1
          return acc
        }, {}),
        aiInsight,
        nextPickPredictions: scored.ranked.slice(0, 3).map((item, idx) => ({
          player: item.player.name,
          probability: clamp(62 - idx * 13, 25, 85),
        })),
        strategyMetaContext,
        insightContext: insightBundle
          ? {
              sources: insightBundle.sources,
              sport: insightBundle.sport,
            }
          : undefined,
        round,
        pick,
        overall: scored.overall,
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use: pick, dm-suggestion, predict-next' }, { status: 400 })
  } catch (err: any) {
    console.error('[mock-draft/ai-pick] Error:', err)
    return NextResponse.json({ error: err.message || 'AI pick failed' }, { status: 500 })
  }
}
