import { NextResponse } from 'next/server'
import { type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { readFantasyCalcValuesFromDb } from '@/lib/fantasycalc-db'
import { prisma } from '@/lib/prisma'
import { computeAllDevyIntelMetrics } from '@/lib/devy-intel'
import { getCFBPlayerStats } from '@/lib/cfb-player-data'
import { hasCfbdApiKey } from '@/lib/cfbd-env'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import type { MarketSignal, MarketAlert, MarketAlertResponse } from '@/lib/types/market-alerts'

type CrowdTrendRow = {
  playerName: string | null
  addCount: number
  dropCount: number
  netTrend: number
  crowdSignal: string
  crowdScore: number
  addRank: number | null
  dropRank: number | null
}

const openai = getOpenAIRouteClient()

let narrativeCache: { data: Map<string, { headline: string; reasoning: string }>; ts: number } | null = null
const NARRATIVE_CACHE_TTL = 1000 * 60 * 15

let cfbdStatsCache: { data: Map<string, { passingYards: number; passingTDs: number; rushingYards: number; rushingTDs: number; receivingYards: number; receivingTDs: number; receptions: number }>; ts: number } | null = null
const CFBD_CACHE_TTL = 1000 * 60 * 60 * 6

async function fetchCFBDStatsForDevyPlayers(schools: string[]): Promise<Map<string, { passingYards: number; passingTDs: number; rushingYards: number; rushingTDs: number; receivingYards: number; receivingTDs: number; receptions: number }>> {
  if (cfbdStatsCache && Date.now() - cfbdStatsCache.ts < CFBD_CACHE_TTL) {
    return cfbdStatsCache.data
  }

  const statsMap = new Map<string, { passingYards: number; passingTDs: number; rushingYards: number; rushingTDs: number; receivingYards: number; receivingTDs: number; receptions: number }>()

  if (!hasCfbdApiKey()) return statsMap

  const season = new Date().getFullYear() - 1
  const uniqueSchools = [...new Set(schools)].slice(0, 30)

  for (const school of uniqueSchools) {
    try {
      const stats = await getCFBPlayerStats(season, school)
      for (const s of stats) {
        if (!s.playerName) continue
        const key = s.playerName.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
        statsMap.set(key, {
          passingYards: s.passingYards,
          passingTDs: s.passingTDs,
          rushingYards: s.rushingYards,
          rushingTDs: s.rushingTDs,
          receivingYards: s.receivingYards,
          receivingTDs: s.receivingTDs,
          receptions: s.receptions,
        })
      }
      await new Promise(r => setTimeout(r, 100))
    } catch {
    }
  }

  cfbdStatsCache = { data: statsMap, ts: Date.now() }
  return statsMap
}

function computeNFLSignal(p: FantasyCalcPlayer): { signal: MarketSignal; strength: number; tags: string[] } {
  const trend = p.trend30Day
  const value = p.value
  const volatility = p.maybeMovingStandardDeviationPerc ?? 0
  const dynastyGap = p.redraftDynastyValuePercDifference

  let score = 0
  const tags: string[] = []

  if (trend > 0) {
    score += Math.min(40, trend / (value || 1) * 300)
    if (trend / (value || 1) > 0.1) tags.push('Rising Fast')
  } else if (trend < 0) {
    score -= Math.min(40, Math.abs(trend) / (value || 1) * 300)
    if (Math.abs(trend) / (value || 1) > 0.1) tags.push('Falling')
  }

  if (volatility > 15) {
    tags.push('High Volatility')
    score *= 0.85
  } else if (volatility < 5 && Math.abs(trend) > 50) {
    tags.push('Steady Move')
  }

  if (dynastyGap > 20) {
    score += 8
    tags.push('Dynasty Premium')
  } else if (dynastyGap < -20) {
    score -= 5
    tags.push('Redraft Discount')
  }

  if (p.player.maybeAge != null) {
    if (p.player.maybeAge <= 24 && trend > 0) {
      score += 5
      tags.push('Young & Rising')
    } else if (p.player.maybeAge >= 30 && trend < 0) {
      score -= 5
      tags.push('Age Concern')
    }
  }

  let signal: MarketSignal
  const absScore = Math.abs(score)

  if (score >= 20) signal = 'STRONG_BUY'
  else if (score >= 8) signal = 'BUY'
  else if (score <= -20) signal = 'STRONG_SELL'
  else if (score <= -8) signal = 'SELL'
  else signal = 'HOLD'

  return { signal, strength: Math.min(100, absScore * 2.5), tags }
}

interface CFBDStatLine {
  passingYards: number; passingTDs: number; rushingYards: number; rushingTDs: number
  receivingYards: number; receivingTDs: number; receptions: number
}

function computeDevySignal(player: any, cfbdStats?: CFBDStatLine): { signal: MarketSignal; strength: number; tags: string[]; projectedRound: number | null; volatility: number; cfbdStats?: CFBDStatLine } {
  const metrics = computeAllDevyIntelMetrics(player)
  const projectedRound = metrics.projectedDraftRound
  const dps = metrics.draftProjectionScore
  const volatility = metrics.volatilityScore
  const tags: string[] = []

  let score = 0

  // A null projection contributes nothing. "Elite Prospect" is a claim, and an
  // unscored player has not earned it — nor its opposite.
  if (dps != null) {
    if (dps >= 80) {
      score += 25
      tags.push('Elite Prospect')
    } else if (dps >= 65) {
      score += 15
      tags.push('Top Prospect')
    } else if (dps >= 50) {
      score += 5
    }
  }

  if (projectedRound != null) {
    if (projectedRound <= 2) {
      score += 10
      tags.push(`Projected Rd ${projectedRound}`)
    } else if (projectedRound <= 4) {
      score += 3
    }
  }

  if (volatility >= 60) {
    score *= 0.7
    tags.push('High Volatility')
  } else if (volatility <= 25) {
    tags.push('Stable Profile')
  }

  if (player.transferStatus) tags.push('Transfer Portal')

  const yearsOut = Math.max(0, (player.draftEligibleYear || 2028) - new Date().getFullYear())
  if (yearsOut <= 1) {
    tags.push('Draft Eligible')
    score += 5
  } else if (yearsOut >= 3) {
    tags.push(`${yearsOut}yr Away`)
    score *= 0.8
  }

  if (cfbdStats) {
    tags.push('CFBD Stats')
    const pos = player.position
    if (pos === 'QB' && cfbdStats.passingYards >= 3000) {
      score += 8
      tags.push(`${cfbdStats.passingYards} Pass Yds`)
    } else if (pos === 'QB' && cfbdStats.passingYards >= 2000) {
      score += 4
    }
    if (pos === 'RB' && cfbdStats.rushingYards >= 1000) {
      score += 8
      tags.push(`${cfbdStats.rushingYards} Rush Yds`)
    } else if (pos === 'RB' && cfbdStats.rushingYards >= 600) {
      score += 4
    }
    if ((pos === 'WR' || pos === 'TE') && cfbdStats.receivingYards >= 800) {
      score += 8
      tags.push(`${cfbdStats.receivingYards} Rec Yds`)
    } else if ((pos === 'WR' || pos === 'TE') && cfbdStats.receivingYards >= 500) {
      score += 4
    }
    const totalTDs = (cfbdStats.passingTDs || 0) + (cfbdStats.rushingTDs || 0) + (cfbdStats.receivingTDs || 0)
    if (totalTDs >= 15) {
      score += 5
      tags.push(`${totalTDs} TDs`)
    }
  }

  let signal: MarketSignal
  if (score >= 20) signal = 'STRONG_BUY'
  else if (score >= 10) signal = 'BUY'
  else if (score <= -20) signal = 'STRONG_SELL'
  else if (score <= -8) signal = 'SELL'
  else signal = 'HOLD'

  return { signal, strength: Math.min(100, Math.abs(score) * 3), tags, projectedRound, volatility, cfbdStats }
}

async function generateAlertNarratives(alerts: MarketAlert[]): Promise<MarketAlert[]> {
  if (narrativeCache && Date.now() - narrativeCache.ts < NARRATIVE_CACHE_TTL) {
    return alerts.map(a => {
      const cached = narrativeCache!.data.get(a.name.toLowerCase())
      if (cached) return { ...a, headline: cached.headline, reasoning: cached.reasoning }
      return a
    })
  }

  const topAlerts = alerts
    .filter(a => a.signal !== 'HOLD')
    .sort((a, b) => b.signalStrength - a.signalStrength)
    .slice(0, 30)

  if (topAlerts.length === 0) return alerts

  const playerSummaries = topAlerts.map(a => {
    const cat = a.category === 'devy' ? `(College - ${a.school || 'Unknown'})` : `(${a.team || 'FA'})`
    return `${a.name} ${a.position} ${cat}: Signal=${a.signal}, Value=${a.dynastyValue}, Trend30d=${a.trend30Day > 0 ? '+' : ''}${a.trend30Day}, Tags=[${a.tags.join(', ')}]${a.projectedRound ? `, ProjRd=${a.projectedRound}` : ''}`
  }).join('\n')

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 2000,
      messages: [{
        role: 'system',
        content: `You are an expert fantasy football market analyst. Generate concise, actionable market alert headlines and reasoning for each player. Be specific about WHY the signal exists - reference the data points provided. Keep headlines under 12 words. Keep reasoning under 30 words. Be direct and confident.

Return a JSON array: [{"name": "Player Name", "headline": "...", "reasoning": "..."}]
Only return the JSON array, no other text.`
      }, {
        role: 'user',
        content: `Generate market alert headlines and reasoning for these players:\n${playerSummaries}`
      }]
    })

    const content = res.choices[0]?.message?.content || '[]'
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let narratives: { name: string; headline: string; reasoning: string }[] = []
    try {
      narratives = JSON.parse(cleaned)
    } catch {
      console.warn('[Market Alerts] AI returned non-JSON, using defaults')
      return alerts
    }

    const narrativeMap = new Map(narratives.map(n => [n.name.toLowerCase(), { headline: n.headline, reasoning: n.reasoning }]))

    narrativeCache = { data: narrativeMap, ts: Date.now() }

    return alerts.map(a => {
      const match = narrativeMap.get(a.name.toLowerCase())
      if (match) return { ...a, headline: match.headline, reasoning: match.reasoning }
      return a
    })
  } catch (e) {
    console.error('[Market Alerts] AI narrative generation failed:', e)
    return alerts
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const filter = url.searchParams?.get('filter') || 'all'
  const position = url.searchParams?.get('position') || 'all'
  const limit = Math.min(100, parseInt(url.searchParams?.get('limit') || '50'))

  try {
    const alerts: MarketAlert[] = []

    let crowdMap = new Map<string, CrowdTrendRow>()
    try {
      const trendingRows = await prisma.trendingPlayer.findMany({
        where: {
          sport: 'nfl',
          expiresAt: { gt: new Date() },
          playerName: { not: null },
        },
      })
      for (const row of trendingRows) {
        if (row.playerName) {
          crowdMap.set(row.playerName.toLowerCase(), row as CrowdTrendRow)
        }
      }
    } catch { /* trending data is optional */ }

    if (filter === 'all' || filter === 'nfl') {
      const cached = await readFantasyCalcValuesFromDb({
        isDynasty: true,
        numQbs: 2,
        numTeams: 12,
        ppr: 1,
      }, { allowStale: true })
      const fcPlayers = cached.players

      for (const p of fcPlayers) {
        if (position !== 'all' && p.player.position !== position.toUpperCase()) continue
        if (!['QB', 'RB', 'WR', 'TE'].includes(p.player.position)) continue

        let { signal, strength, tags } = computeNFLSignal(p)

        const crowd = crowdMap.get(p.player.name.toLowerCase())
        if (crowd) {
          if (crowd.crowdSignal === 'hot_add') {
            strength = Math.min(100, strength + 15)
            tags.push(`🔥 ${crowd.addCount.toLocaleString()} adds/24h`)
            if (signal === 'HOLD') signal = 'BUY'
            else if (signal === 'BUY') { signal = 'STRONG_BUY'; strength = Math.min(100, strength + 5) }
          } else if (crowd.crowdSignal === 'rising') {
            strength = Math.min(100, strength + 8)
            tags.push(`📈 Trending add (+${crowd.netTrend})`)
            if (signal === 'HOLD' && strength >= 20) signal = 'BUY'
          } else if (crowd.crowdSignal === 'hot_drop') {
            strength = Math.min(100, strength + 12)
            tags.push(`⚠️ ${crowd.dropCount.toLocaleString()} drops/24h`)
            if (signal === 'HOLD') signal = 'SELL'
            else if (signal === 'SELL') { signal = 'STRONG_SELL'; strength = Math.min(100, strength + 5) }
          } else if (crowd.crowdSignal === 'falling') {
            strength = Math.min(100, strength + 5)
            tags.push(`📉 Trending drop (${crowd.netTrend})`)
            if (signal === 'HOLD' && strength >= 20) signal = 'SELL'
          }
        }

        if (signal === 'HOLD' && strength < 15) continue

        const trendPct = p.value > 0 ? Math.round((p.trend30Day / p.value) * 100) : 0
        const crowdNote = crowd ? ` Crowd: ${crowd.addCount} adds, ${crowd.dropCount} drops.` : ''

        alerts.push({
          id: `nfl-${p.player.sleeperId || p.player.id}`,
          name: p.player.name,
          position: p.player.position,
          team: p.player.maybeTeam || null,
          signal,
          signalStrength: strength,
          category: 'nfl',
          dynastyValue: p.value,
          trend30Day: p.trend30Day,
          trendPercent: trendPct,
          rank: p.overallRank,
          positionRank: p.positionRank,
          volatility: p.maybeMovingStandardDeviationPerc ?? null,
          sleeperId: p.player.sleeperId || null,
          school: null,
          classYear: null,
          projectedRound: null,
          headline: signal === 'STRONG_BUY' ? `${p.player.name} value surging — buy window closing` :
                    signal === 'BUY' ? `${p.player.name} trending up — favorable entry point` :
                    signal === 'STRONG_SELL' ? `${p.player.name} value cratering — sell now` :
                    signal === 'SELL' ? `${p.player.name} declining — consider moving` :
                    `${p.player.name} holding steady`,
          reasoning: `30-day trend: ${trendPct > 0 ? '+' : ''}${trendPct}%. Rank #${p.overallRank}.${crowdNote}`,
          tags,
          updatedAt: new Date().toISOString(),
        })
      }
    }

    if (filter === 'all' || filter === 'devy') {
      try {
        const devyPlayers = await prisma.devyPlayer.findMany({
          where: {
            devyEligible: true,
            graduatedToNFL: false,
            draftStatus: { in: ['college', 'declared', 'returning'] },
            position: position !== 'all' ? position.toUpperCase() : undefined,
          },
          take: 200,
          orderBy: { name: 'asc' },
        })

        const schools = [...new Set(devyPlayers.map(dp => dp.school).filter(Boolean))]
        let cfbdStatsMap = new Map<string, CFBDStatLine>()
        try {
          cfbdStatsMap = await fetchCFBDStatsForDevyPlayers(schools)
        } catch {
        }

        for (const dp of devyPlayers) {
          const normalizedName = dp.name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
          const playerCfbdStats = cfbdStatsMap.get(normalizedName)

          const { signal, strength, tags, projectedRound, volatility } = computeDevySignal(dp, playerCfbdStats)

          const draftStatus = (dp as any).draftStatus || 'college'
          if (draftStatus === 'declared') tags.unshift('Declared for Draft')
          else if (draftStatus === 'returning') tags.unshift('Returning to School')

          if (signal === 'HOLD' && strength < 15) continue

          const devyValue = dp.devyValue || 0
          let statLine = ''
          if (playerCfbdStats) {
            const pos = dp.position
            if (pos === 'QB' && playerCfbdStats.passingYards > 0) {
              statLine = `${playerCfbdStats.passingYards} pass yds, ${playerCfbdStats.passingTDs} TDs`
            } else if (pos === 'RB' && playerCfbdStats.rushingYards > 0) {
              statLine = `${playerCfbdStats.rushingYards} rush yds, ${playerCfbdStats.rushingTDs} TDs`
            } else if ((pos === 'WR' || pos === 'TE') && playerCfbdStats.receivingYards > 0) {
              statLine = `${playerCfbdStats.receptions} rec, ${playerCfbdStats.receivingYards} yds, ${playerCfbdStats.receivingTDs} TDs`
            }
          }

          alerts.push({
            id: `devy-${dp.id}`,
            name: dp.name,
            position: dp.position,
            team: dp.school,
            signal,
            signalStrength: strength,
            category: 'devy',
            dynastyValue: devyValue,
            trend30Day: 0,
            trendPercent: 0,
            rank: 0,
            positionRank: 0,
            volatility,
            sleeperId: dp.sleeperId || null,
            school: dp.school,
            classYear: dp.classYear,
            projectedRound,
            headline: signal === 'STRONG_BUY' ? `${dp.name} is a must-stash devy target` :
                      signal === 'BUY' ? `${dp.name} draft stock rising — acquire now` :
                      `${dp.name} — monitor draft position`,
            // Omit the round entirely when unknown; "Projected Rd null" reached users.
            reasoning: [
              projectedRound != null ? `Projected Rd ${projectedRound}.` : 'Draft position not yet projected.',
              `${dp.school}${dp.classYear ? ` (Yr ${dp.classYear})` : ''}.`,
              statLine ? `${statLine}.` : '',
            ]
              .filter(Boolean)
              .join(' '),
            tags,
            updatedAt: new Date().toISOString(),
          })
        }
      } catch (e) {
        console.error('[Market Alerts] Devy player fetch failed:', String(e))
      }
    }

    alerts.sort((a, b) => {
      const signalOrder: Record<MarketSignal, number> = { STRONG_BUY: 0, BUY: 1, STRONG_SELL: 2, SELL: 3, HOLD: 4 }
      const orderDiff = signalOrder[a.signal] - signalOrder[b.signal]
      if (orderDiff !== 0) return orderDiff
      return b.signalStrength - a.signalStrength
    })

    const limited = alerts.slice(0, limit)

    const enriched = await generateAlertNarratives(limited)

    const strongBuys = enriched.filter(a => a.signal === 'STRONG_BUY').length
    const buys = enriched.filter(a => a.signal === 'BUY').length
    const sells = enriched.filter(a => a.signal === 'SELL').length
    const strongSells = enriched.filter(a => a.signal === 'STRONG_SELL').length
    const bullish = strongBuys + buys
    const bearish = sells + strongSells

    const response: MarketAlertResponse = {
      alerts: enriched,
      summary: {
        totalAlerts: enriched.length,
        strongBuys,
        buys,
        sells,
        strongSells,
        topMover: enriched[0]?.name || null,
        marketSentiment: bullish > bearish * 1.5 ? 'bullish' : bearish > bullish * 1.5 ? 'bearish' : 'neutral',
      },
      generatedAt: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('[Market Alerts] Error:', error)
    return NextResponse.json({ error: 'Failed to generate market alerts', details: error?.message }, { status: 500 })
  }
}

