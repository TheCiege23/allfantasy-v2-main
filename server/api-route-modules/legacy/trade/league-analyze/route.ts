import { withApiUsage } from "@/lib/telemetry/usage"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { NextRequest, NextResponse } from 'next/server'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { prisma } from '@/lib/prisma'
import { preferencesToPrompt } from '@/lib/trade-quiz-data'
import { pricePlayer, ValuationContext } from '@/lib/hybrid-valuation'
import { fetchFantasyCalcValues } from '@/lib/fantasycalc'
import { getComprehensiveLearningContext } from '@/lib/comprehensive-trade-learning'
import { getPreAnalysisStatus } from '@/lib/trade-pre-analysis'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { runTradeEngine, runAssistOrchestrator } from '@/lib/trade-engine'
import { applyOtbTagsToAssetsByRosterId } from '@/lib/trade-engine/otb-persistence'
import { writeSnapshot } from '@/lib/trade-engine/snapshot-store'
import { getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import { autoLogDecision } from '@/lib/decision-log'
import { computeConfidenceRisk, getHistoricalHitRate } from '@/lib/analytics/confidence-risk-engine'
import { buildLeagueDecisionContext, leagueContextToIntelligence } from '@/lib/trade-engine/league-context-assembler'
import { getLeagueInfo, getLeagueRosters, getLeagueUsers, getPlayersBySport } from '@/lib/sleeper-client'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'

// Production hardening: Timeout guard and max duration
export const maxDuration = 120 // 2 minutes for multi-API orchestration

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`[${label}] Timeout after ${timeoutMs}ms`)),
      timeoutMs
    )
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
  }
}

type Sport = 'nfl' | 'nba'
type RosterSlot = 'Starter' | 'Bench' | 'IR' | 'Taxi'

type RosteredPlayer = {
  id: string
  name: string
  pos: string
  team?: string
  slot: RosterSlot
  isIdp?: boolean
  age?: number
}

type SleeperUser = {
  user_id: string
  display_name?: string
  username?: string
  avatar?: string
}

type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  co_owners?: string[] | null
  players?: string[] | null
  starters?: string[] | null
  reserve?: string[] | null
  taxi?: string[] | null
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
    fpts_against?: number
    fpts_against_decimal?: number
  }
}

type SleeperPlayer = {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string
  age?: number
}

type ManagerRoster = {
  rosterId: number
  userId: string
  username: string
  displayName: string
  avatar?: string
  record: string
  pointsFor: number
  players: RosteredPlayer[]
}

type TradeSuggestion = {
  targetManager: string
  targetDisplayName: string
  targetAvatar?: string
  theirNeeds: string[]
  yourSurplus: string[]
  suggestedTrades: Array<{
    youGive: string[]
    youReceive: string[]
    whyTheyAccept: string
    whyYouWin: string
    tradeGrade: string
    detailedReasoning?: string
    riskFlags?: string[]
    playerAnalysis?: Array<{
      name: string
      injuryHistory?: string
      injuryRisk?: 'Low' | 'Moderate' | 'High' | 'Extreme'
      qbSituation?: string
      offensiveLine?: string
      valueReasoning?: string
    }>
    isMultiTeam?: boolean
  }>
  overallFit: string
}

const playersCache: Record<
  Sport,
  { at: number; data: Record<string, SleeperPlayer> | null }
> = {
  nfl: { at: 0, data: null },
  nba: { at: 0, data: null },
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

async function getSleeperPlayers(sport: Sport) {
  const now = Date.now()
  const cached = playersCache[sport]
  if (cached.data && now - cached.at < CACHE_TTL_MS) return cached.data

  const dict = await getPlayersBySport(sport)
  if (!dict || Object.keys(dict).length === 0) {
    throw new Error(`Failed to fetch Sleeper players (${sport}).`)
  }

  playersCache[sport] = { at: now, data: dict as Record<string, SleeperPlayer> }
  return playersCache[sport].data!
}

function normalizeName(s?: string) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function isIdpPos(pos?: string) {
  const p = (pos || '').toUpperCase()
  return p === 'DL' || p === 'LB' || p === 'DB' || p === 'EDGE' || p === 'IDP'
}

function buildRosterFromPlayers(
  playerIds: string[],
  starters: Set<string>,
  reserve: Set<string>,
  taxi: Set<string>,
  dict: Record<string, SleeperPlayer>,
  sport: Sport
): RosteredPlayer[] {
  const out: RosteredPlayer[] = playerIds.map((pid) => {
    const meta = dict[pid] || {}
    const name =
      meta.full_name ||
      [meta.first_name, meta.last_name].filter(Boolean).join(' ') ||
      pid

    const pos = (meta.position || '').toUpperCase()
    const team = (meta.team || '').toUpperCase() || undefined

    let slot: RosterSlot = 'Bench'
    if (starters.has(pid)) slot = 'Starter'
    else if (reserve.has(pid)) slot = 'IR'
    else if (taxi.has(pid)) slot = 'Taxi'

    return {
      id: pid,
      name,
      pos: pos || 'UNK',
      team,
      slot,
      isIdp: sport === 'nfl' ? isIdpPos(pos) : false,
      age: meta.age,
    }
  })

  const slotOrder: Record<RosterSlot, number> = { Starter: 1, Bench: 2, IR: 3, Taxi: 4 }
  out.sort((a, b) => {
    const s = slotOrder[a.slot] - slotOrder[b.slot]
    if (s !== 0) return s
    return a.name.localeCompare(b.name)
  })

  return out
}

type LeagueContextShape = {
  leagueName: string
  scoringType: string
  numTeams: number
  isTEP: boolean
  tepBonus: number
  isSF: boolean
  starterSlots: number
  benchSlots: number
  taxiSlots: number
  rosterPositions: string[]
}

function buildLeagueAnalysisPrompt(
  userRoster: ManagerRoster,
  otherRosters: ManagerRoster[],
  ctx: LeagueContextShape
): string {
  const formatPlayerWithAge = (p: RosteredPlayer) => {
    const ageStr = p.age && p.age >= 30 ? `, age ${p.age}` : ''
    return `${p.name} (${p.pos}, ${p.slot}${ageStr})`
  }

  const userRosterSummary = userRoster.players
    .map(formatPlayerWithAge)
    .join(', ')

  const otherRostersSummary = otherRosters
    .map((r) => {
      const players = r.players
        .filter((p) => p.slot === 'Starter' || p.slot === 'Bench')
        .slice(0, 15)
        .map((p) => {
          const ageStr = p.age && p.age >= 30 ? `, ${p.age}` : ''
          return `${p.name} (${p.pos}${ageStr})`
        })
        .join(', ')
      return `**${r.displayName}** (${r.record}, ${r.pointsFor.toFixed(1)} pts): ${players}`
    })
    .join('\n')

  const currentDate = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return `You are THE MOST ELITE dynasty fantasy football trade analyst in existence.
## CURRENT DATE: ${currentDate}

## League: ${ctx.leagueName}
## Teams: ${ctx.numTeams}
## Format: ${ctx.scoringType}${ctx.isTEP ? ` + TEP (+${ctx.tepBonus} per TE rec)` : ''}${ctx.isSF ? ' | SUPERFLEX' : ' | 1QB'}
## Roster: ${ctx.starterSlots} starters, ${ctx.benchSlots} bench${ctx.taxiSlots > 0 ? `, ${ctx.taxiSlots} taxi` : ''}
## Positions: ${ctx.rosterPositions.filter((p: string) => p !== 'BN' && p !== 'IR').join(', ')}

## USER'S TEAM (${userRoster.displayName}, ${userRoster.record})
${userRosterSummary}

## OTHER MANAGERS IN LEAGUE
${otherRostersSummary}

Find trades that give the USER a ~10% edge while still being acceptable.`
}

function safeStr(v: any) {
  const s = String(v ?? '').trim()
  return s ? s : ''
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/league-analyze", tool: "LegacyTradeLeagueAnalyze" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const leagueId = safeStr(body.league_id)
    const sportRaw = safeStr(body.sport || 'nfl').toLowerCase()

    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: safeStr(body.sleeper_username) || null,
      rateLimit: { action: 'trade_league_analyze', maxRequests: 10, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeperUsername = gate.identity.sleeperUsername.toLowerCase()

    if (!leagueId) return NextResponse.json({ error: 'Missing league_id' }, { status: 400 })

    const sport: Sport = sportRaw === 'nba' ? 'nba' : 'nfl'

    // 1) Fetch league info
    const leagueInfo = await getLeagueInfo(leagueId)
    if (!leagueInfo) {
      return NextResponse.json({ error: 'Failed to fetch league info' }, { status: 502 })
    }

    const leagueName = leagueInfo.name || 'Dynasty League'
    const scoringSettings = leagueInfo.scoring_settings || {}
    const leagueSettings = leagueInfo.settings || {}
    const rosterPositions = leagueInfo.roster_positions || []

    // Parse scoring format (Sleeper: rec 1 = PPR, 0.5 = half, else standard)
    const scoringType =
      scoringSettings.rec === 1 ? 'PPR' :
      scoringSettings.rec === 0.5 ? 'Half PPR' :
      'Standard'

    // TEP is NOT inferred from having TE slots; use bonus_rec_te only
    const tepBonus = Number(scoringSettings.bonus_rec_te || 0)
    const isTEP = tepBonus > 0

    // Superflex detection: presence of SUPER_FLEX or SF slot
    const isSF = rosterPositions.some((p: string) => {
      const up = String(p || '').toUpperCase()
      return up === 'SUPER_FLEX' || up === 'SF'
    })

    // Parse roster structure
    const parsedNumTeams = Number(leagueInfo.total_rosters ?? leagueSettings.num_teams)
    const numTeams = Number.isFinite(parsedNumTeams) && parsedNumTeams > 0 ? parsedNumTeams : 12
    const taxiSlots = Number(leagueSettings.taxi_slots || 0)
    const benchSlots = rosterPositions.filter((p: string) => String(p).toUpperCase() === 'BN').length
    const starterSlots = rosterPositions.filter((p: string) => {
      const up = String(p).toUpperCase()
      return up !== 'BN' && up !== 'IR'
    }).length

    // 2) Fetch all users in the league
    const users = await getLeagueUsers(leagueId) as unknown as SleeperUser[]
    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: 'Failed to load league users' }, { status: 502 })
    }
    const userMap = new Map(users.map((u) => [u.user_id, u]))

    // Find the current user
    const target = normalizeName(sleeperUsername)
    const currentUser = users.find(
      (u) => normalizeName(u.display_name) === target || normalizeName(u.username) === target
    )
    if (!currentUser?.user_id) {
      return NextResponse.json({ error: `User not found in league: ${sleeperUsername}` }, { status: 404 })
    }

    // 3) Fetch all rosters
    const rosters = await getLeagueRosters(leagueId) as unknown as SleeperRoster[]
    if (!Array.isArray(rosters) || rosters.length === 0) {
      return NextResponse.json({ error: 'Failed to load league rosters' }, { status: 502 })
    }

    // Early exit: Cannot analyze trades if league has no rosters
    if (rosters.length < 2) {
      return NextResponse.json(
        { error: 'League must have at least 2 rosters to analyze trades' },
        { status: 400 }
      )
    }

    // 4) Load player dictionary
    const dict = await getSleeperPlayers(sport)

    // 5) Build roster objects for all managers
    const managerRosters: ManagerRoster[] = []
    let userRoster: ManagerRoster | null = null

    for (const roster of rosters) {
      if (!roster.owner_id) continue
      const user = userMap.get(roster.owner_id)
      if (!user) continue

      const playerIds = (roster.players || []).filter(Boolean)
      const starters = new Set((roster.starters || []).filter(Boolean))
      const reserve = new Set((roster.reserve || []).filter(Boolean))
      const taxi = new Set((roster.taxi || []).filter(Boolean))

      const players = buildRosterFromPlayers(playerIds, starters, reserve, taxi, dict, sport)

      const wins = roster.settings?.wins ?? 0
      const losses = roster.settings?.losses ?? 0
      const ties = roster.settings?.ties ?? 0
      const fpts = (roster.settings?.fpts ?? 0) + (roster.settings?.fpts_decimal ?? 0) / 100

      const managerRosterObj: ManagerRoster = {
        rosterId: roster.roster_id,
        userId: roster.owner_id,
        username: user.username || '',
        displayName: user.display_name || user.username || 'Unknown',
        avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : undefined,
        record: `${wins}-${losses}${ties > 0 ? `-${ties}` : ''}`,
        pointsFor: fpts,
        players,
      }

      const isCurrentUser =
        roster.owner_id === currentUser.user_id ||
        (Array.isArray(roster.co_owners) && roster.co_owners.map(String).includes(currentUser.user_id))
      if (isCurrentUser) userRoster = managerRosterObj
      else managerRosters.push(managerRosterObj)
    }

    if (!userRoster) {
      return NextResponse.json({ error: 'Could not find your roster in this league' }, { status: 404 })
    }

    // 6) Load helpful contexts (feedback, prefs, fantasycalc, history, pre-analysis)
    let feedbackExamples = ''
    try {
      const highRated = await prisma.tradeFeedback.findMany({
        where: { rating: { gte: 4 } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
      const lowRated = await prisma.tradeFeedback.findMany({
        where: { rating: { lte: 2 } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })

      if (highRated.length > 0 || lowRated.length > 0) {
        feedbackExamples = `\n\n## USER FEEDBACK ON PAST SUGGESTIONS\nLearn from what users liked and disliked:\n`

        if (highRated.length > 0) {
          feedbackExamples += `\n**HIGHLY RATED (users loved these - suggest similar):**\n`
          highRated.forEach((fb) => {
            feedbackExamples += `- Give: ${fb.youGive.join(' + ')} → Receive: ${fb.youReceive.join(' + ')} (AI Grade: ${fb.aiGrade}, User: ${fb.rating}/5)\n`
          })
        }

        if (lowRated.length > 0) {
          feedbackExamples += `\n**POORLY RATED (users disliked these - avoid similar):**\n`
          lowRated.forEach((fb) => {
            feedbackExamples += `- Give: ${fb.youGive.join(' + ')} → Receive: ${fb.youReceive.join(' + ')} (AI Grade: ${fb.aiGrade}, User: ${fb.rating}/5)\n`
          })
        }
      }
    } catch (e) {
      console.error('Failed to fetch feedback:', e)
    }

    let preferencesPrompt = ''
    try {
      const userPrefs = await prisma.tradePreferences.findUnique({ where: { sleeperUsername } })
      if (userPrefs?.quizCompleted) {
        preferencesPrompt = preferencesToPrompt({
          youthVsProduction: userPrefs.youthVsProduction,
          consolidationVsDepth: userPrefs.consolidationVsDepth,
          picksVsPlayers: userPrefs.picksVsPlayers,
          riskTolerance: userPrefs.riskTolerance,
          qbPriority: userPrefs.qbPriority,
          tePriority: userPrefs.tePriority,
        })
      }
    } catch (e) {
      console.error('Failed to fetch preferences:', e)
    }

    // FantasyCalc market values map (also used to power the deterministic engine values)
    const fantasyCalcValueMap: Record<string, { value: number; marketValue?: number; impactValue?: number; vorpValue?: number; volatility?: number }> = {}
    let fantasyCalcContext = ''
    try {
      let fcPlayers: any[] = []
      try {
        const fcIsDynasty = leagueSettings.type === 2
        const fcNumQbs: 1 | 2 = isSF ? 2 : 1
        const fcNumTeams = Number.isFinite(Number(numTeams)) && Number(numTeams) > 0 ? Number(numTeams) : 12
        const recSetting = Number(scoringSettings.rec ?? 1)
        const fcPpr: 0 | 0.5 | 1 = recSetting >= 1 ? 1 : recSetting >= 0.5 ? 0.5 : 0

        fcPlayers = await fetchFantasyCalcValues({
          isDynasty: fcIsDynasty,
          numQbs: fcNumQbs,
          numTeams: fcNumTeams,
          ppr: fcPpr,
        })
      } catch { fcPlayers = [] }

      const ctx: ValuationContext = {
        asOfDate: new Date().toISOString().slice(0, 10),
        isSuperFlex: isSF,
        fantasyCalcPlayers: fcPlayers,
        numTeams,
      }

      const allRosters = [userRoster, ...managerRosters]
      const allPlayerNames = new Set<string>()
      for (const r of allRosters) {
        for (const p of r.players) {
          if (p.name && !p.isIdp) allPlayerNames.add(p.name)
        }
      }

      const uniqueNames = Array.from(allPlayerNames)
      const batchSize = 50
      for (let i = 0; i < uniqueNames.length; i += batchSize) {
        // Stagger batch requests to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        const batch = uniqueNames.slice(i, i + batchSize)
        const pricedBatch = await Promise.all(
          batch.map(name => pricePlayer(name, ctx))
        )
        for (const priced of pricedBatch) {
          if (priced.value > 0) {
            fantasyCalcValueMap[priced.name] = {
              value: priced.value,
              marketValue: priced.assetValue.marketValue,
              impactValue: priced.assetValue.impactValue,
              vorpValue: priced.assetValue.vorpValue,
              volatility: priced.assetValue.volatility,
            }
          }
        }
      }

      const userPlayerValues: string[] = []
      for (const p of userRoster.players.slice(0, 20)) {
        const fc = fantasyCalcValueMap[p.name]
        if (fc && fc.value > 0) {
          userPlayerValues.push(`${p.name}: ${fc.value}`)
        }
      }

      fantasyCalcContext = `\n\n## MARKET VALUES (hybrid: Excel historical + FantasyCalc fallback)
User's Roster Values:
${userPlayerValues.join('\n') || 'No matches found'}`
    } catch (e) {
      console.error('Failed to fetch market values:', e)
    }

    let tradeHistoryContext = ''
    try {
      const history = await prisma.leagueTradeHistory.findUnique({
        where: {
          sleeperLeagueId_sleeperUsername: { sleeperLeagueId: leagueId, sleeperUsername },
        },
        include: { trades: { orderBy: { tradeDate: 'desc' }, take: 10 } },
      })

      if (history && history.tradesLoaded > 0) {
        const style = history.tradingStyle as { prefers_picks?: boolean; pick_balance?: number; consolidation_tendency?: string; total_trades?: number } | null
        const targets = history.favoriteTargets as { top_positions?: Array<{ position: string; count: number }>; frequent_targets?: Array<{ name: string; count: number }> } | null

        let styleDesc = ''
        if (style) {
          styleDesc = `Trading Style: ${style.prefers_picks ? 'Pick accumulator' : 'Pick spender'} | ${style.consolidation_tendency || 'balanced'} (${style.total_trades || 0} trades analyzed)`
        }

        let positionPrefs = ''
        if (targets?.top_positions && targets.top_positions.length > 0) {
          positionPrefs = `Position Preferences: ${targets.top_positions.map(p => `${p.position} (${p.count}x)`).join(', ')}`
        }

        let recentTrades = ''
        if (history.trades.length > 0) {
          const tradeLines = history.trades.slice(0, 5).map(t => {
            const given = (t.playersGiven as Array<{ name: string }>).map(p => p.name).join(' + ')
            const received = (t.playersReceived as Array<{ name: string }>).map(p => p.name).join(' + ')
            const picksGiven = (t.picksGiven as Array<{ season: string; round: number }>).map(p => `${p.season} ${p.round}rd`).join(' + ')
            const picksReceived = (t.picksReceived as Array<{ season: string; round: number }>).map(p => `${p.season} ${p.round}rd`).join(' + ')
            const giveStr = [given, picksGiven].filter(Boolean).join(' + ') || 'nothing'
            const getStr = [received, picksReceived].filter(Boolean).join(' + ') || 'nothing'
            return `- Gave: ${giveStr} → Got: ${getStr} (vs ${t.partnerName || 'Unknown'})`
          })
          recentTrades = `Recent Trades:\n${tradeLines.join('\n')}`
        }

        tradeHistoryContext = `\n\n## USER'S TRADE HISTORY IN THIS LEAGUE
${styleDesc}
${positionPrefs}
Trade Frequency: ${history.tradeFrequency || 'unknown'}

${recentTrades}`
      }
    } catch (e) {
      console.error('Failed to fetch trade history:', e)
    }

    let preAnalysisContext = ''
    let cachedTendencies: Record<number, any> | undefined
    try {
      const preAnalysis = await getPreAnalysisStatus(sleeperUsername, leagueId)
      if (preAnalysis.status === 'ready' && preAnalysis.cache) {
        preAnalysisContext += `\n\n## AI GM INTELLIGENCE
(Loaded from pre-analysis cache)`
        if (preAnalysis.cache.managerTendencies) {
          const tendencyByRosterId: Record<number, any> = {}
          const allRosters = [userRoster, ...managerRosters]
          for (const [managerId, tendency] of Object.entries(preAnalysis.cache.managerTendencies)) {
            const matchedRoster = allRosters.find(r => r.userId === managerId)
            if (matchedRoster) {
              tendencyByRosterId[matchedRoster.rosterId] = tendency
            }
          }
          cachedTendencies = tendencyByRosterId
        }
      }
    } catch (e) {
      console.error('Failed to fetch pre-analysis cache:', e)
    }

    // 6e) Run deterministic trade engine via unified LeagueDecisionContext
    let deterministicTrades: ReturnType<typeof runTradeEngine> | null = null
    let assetsByRosterId: any = null
    let managerProfiles: any = null
    let unifiedLeagueCtx: any = null

    try {
      unifiedLeagueCtx = await buildLeagueDecisionContext({ leagueId, username: sleeperUsername })
      const { intelligence: unifiedIntelligence } = leagueContextToIntelligence(unifiedLeagueCtx)

      assetsByRosterId = unifiedIntelligence.assetsByRosterId
      managerProfiles = unifiedIntelligence.managerProfiles

      if (cachedTendencies) {
        unifiedIntelligence.managerTendencies = cachedTendencies
      }

      await applyOtbTagsToAssetsByRosterId({ leagueId, assetsByRosterId })

      const calWeights = await getCalibratedWeights()
      deterministicTrades = runTradeEngine(userRoster.rosterId, unifiedIntelligence, undefined, calWeights)
      console.log(`[TradeEngine] Generated ${deterministicTrades.validTrades.length} deterministic trade candidates (unified context: ${unifiedLeagueCtx.contextId})`)

      deterministicTrades = await runAssistOrchestrator(deterministicTrades, {
        userRosterId: userRoster.rosterId,
        grok: {
          leagueMeta: {
            leagueName,
            format: leagueSettings.type === 2 ? 'dynasty' : 'redraft',
            superflex: isSF,
            tep: isTEP,
            idp: rosterPositions.some((p: string) => ['DL', 'LB', 'DB', 'IDP'].includes(String(p).toUpperCase())),
          },
        },
      })
      console.log(`[AssistOrchestrator] AI enrichment complete`)
    } catch (e) {
      console.error('Failed to run trade engine:', e)
    }

    // Optional AI "target ranking notes"
    if (deterministicTrades && deterministicTrades.validTrades.length > 0) {
      try {
        const aiPrompt = `You are an assistant reviewing PRE-VALIDATED fantasy football trade candidates.
You may NOT change players, values, or fairness scores.

Your job is to:
1. Rank which managers are best to target
2. Explain risk and timing for each trade
3. Suggest messaging tone for approaching each manager

League Context:
- Scoring: ${scoringType}
- Superflex: ${isSF ? 'Yes' : 'No'}
- TEP: ${isTEP ? 'Yes (bonus: ' + tepBonus + ')' : 'No'}
- Teams: ${numTeams}

Pre-Validated Trade Candidates (DO NOT MODIFY VALUES):
${JSON.stringify(deterministicTrades.validTrades.slice(0, 8).map(t => ({
  targetRosterId: t.toRosterId,
  fairnessScore: t.fairnessScore,
  label: t.acceptanceLabel,
  give: t.give.map(a => ({ name: a.name, pos: a.pos, value: a.value })),
  receive: t.receive.map(a => ({ name: a.name, pos: a.pos, value: a.value })),
})), null, 2)}

Respond in JSON format:
{
  "rankedTargets": [
    {
      "targetRosterId": number,
      "priority": 1-8,
      "reasoning": "Why this manager is a good target",
      "timing": "Best time to approach",
      "messagingTone": "How to pitch the trade",
      "riskLevel": "Low/Medium/High"
    }
  ],
  "overallStrategy": "Brief summary of best approach"
}`

        const aiNotesPayload = {
          feature: 'legacy-trade-league-analyze-targeting-notes',
          leagueId,
          userId: sleeperUsername,
          sport,
          scoringType,
          isSF,
          isTEP,
          numTeams,
          topCandidates: deterministicTrades.validTrades.slice(0, 8).map((t) => ({
            targetRosterId: t.toRosterId,
            fairnessScore: t.fairnessScore,
            acceptanceLabel: t.acceptanceLabel,
            give: t.give.map((a) => ({ id: a.id || a.name, pos: a.pos, value: a.value })),
            receive: t.receive.map((a) => ({ id: a.id || a.name, pos: a.pos, value: a.value })),
          })),
          promptVersion: 'v1',
        }

        const aiNotesResult = await getOrCreateAiResult({
          feature: 'legacy-trade-league-analyze-targeting-notes',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o',
          payload: aiNotesPayload,
          ttlSeconds: 2 * 60 * 60,
          onCacheMiss: async () => {
            const openai = getOpenAIRouteClient()
            const aiResponse = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [{ role: 'user', content: aiPrompt }],
              temperature: 0.3,
            })

            const content = aiResponse.choices[0]?.message?.content || '{}'
            return {
              resultText: content,
              resultJson: { content },
              tokenPrompt: aiResponse.usage?.prompt_tokens ?? null,
              tokenOutput: aiResponse.usage?.completion_tokens ?? null,
            }
          },
        })

        if (aiNotesResult.cacheHit) {
          console.log(`[legacy-trade/league-analyze] AI cache hit { leagueId: '${leagueId}', type: 'targeting-notes' }`)
        } else {
          console.log(`[legacy-trade/league-analyze] AI cache miss { leagueId: '${leagueId}', type: 'targeting-notes', modelCallMs: ${aiNotesResult.modelDurationMs ?? -1} }`)
          console.log(`[legacy-trade/league-analyze] saved AiResult { id: '${aiNotesResult.row.id}', resultKey: '${aiNotesResult.row.resultKey}' }`)
        }

        console.log('[AI Layer] Generated targeting notes')
      } catch (e) {
        console.error('Failed to get AI notes:', e)
      }
    }

    // 7) Call AI to analyze league and suggest trades
    const leagueCtx: LeagueContextShape = {
      leagueName,
      scoringType,
      numTeams,
      isTEP,
      tepBonus,
      isSF,
      starterSlots,
      benchSlots,
      taxiSlots,
      rosterPositions,
    }
    const prompt = buildLeagueAnalysisPrompt(userRoster, managerRosters, leagueCtx)

    const learningContext = await getComprehensiveLearningContext()

    // Main AI analysis call with timeout and graceful degradation
    let tradeSuggestions: TradeSuggestion[] = []
    let parseWarning: string | undefined
    let aiDegraded = false

    try {
      const aiSuggestionsPayload = {
        feature: 'legacy-trade-league-analyze',
        leagueId,
        userId: sleeperUsername,
        sport,
        scoringType,
        isSF,
        isTEP,
        numTeams,
        userRosterId: userRoster.rosterId,
        managerRosters: [userRoster, ...managerRosters].map((r) => ({
          rosterId: r.rosterId,
          userId: r.userId,
          username: r.username,
          record: r.record,
          pointsFor: Number(r.pointsFor.toFixed(2)),
          players: r.players.map((p) => ({ id: p.id, pos: p.pos, slot: p.slot })),
        })),
        fantasyCalcContext,
        feedbackExamples,
        preferencesPrompt,
        tradeHistoryContext,
        preAnalysisContext,
        promptVersion: 'v1',
      }

      const aiSuggestionsResult = await getOrCreateAiResult({
        feature: 'legacy-trade-league-analyze',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'openai',
        model: 'gpt-4o',
        payload: aiSuggestionsPayload,
        ttlSeconds: 2 * 60 * 60,
        onCacheMiss: async () => {
          const openai = getOpenAIRouteClient()
          const completion = await withTimeout(
            openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content: `You are the #1 dynasty fantasy football trade expert. Your valuations are BASED ON FANTASYCALC DATA (from ~1 million real fantasy trades). Return valid JSON only.
${learningContext}

YOUR GOAL: Find trades that give the USER a ~10% edge while still being acceptable to the other manager.

FANTASYCALC VALUES ARE YOUR SOURCE OF TRUTH:
- The fantasyCalcContext section contains REAL market values from crowdsourced trade data
- Reference specific values when explaining trades
- Higher value = more valuable player. Aim for USER to receive ~10% more value than they give.
- Use 30-day trends to identify buy-low and sell-high opportunities.
${feedbackExamples}${preferencesPrompt}${fantasyCalcContext}${tradeHistoryContext}${preAnalysisContext}

Each object must have:
{
  "targetManager": "username",
  "targetDisplayName": "Display Name",
  "theirNeeds": ["what their roster is missing"],
  "yourSurplus": ["USER's assets that address their needs"],
  "suggestedTrades": [
    {
      "youGive": ["Player A", "2026 2nd"],
      "youReceive": ["Player B", "2026 1st"],
      "whyTheyAccept": "How this fixes THEIR roster problem",
      "whyYouWin": "The edge you're getting",
      "tradeGrade": "A/B/C",
      "detailedReasoning": "Full explanation of value analysis",
      "riskFlags": ["Any concerns"]
    }
  ],
  "overallFit": "High/Medium/Low"
}

Return JSON array of TradeSuggestion objects. Skip managers with no trade fit. Find the 2-5 BEST opportunities.`,
                },
                { role: 'user', content: prompt },
              ],
              temperature: 0.4,
            }),
            30000,
            'OpenAI_TradeAnalysis'
          )

          const aiResponse = completion.choices[0]?.message?.content || '[]'
          return {
            resultText: aiResponse,
            resultJson: { content: aiResponse },
            tokenPrompt: completion.usage?.prompt_tokens ?? null,
            tokenOutput: completion.usage?.completion_tokens ?? null,
          }
        },
      })

      if (aiSuggestionsResult.cacheHit) {
        console.log(`[legacy-trade/league-analyze] AI cache hit { leagueId: '${leagueId}', userId: '${sleeperUsername}' }`)
      } else {
        console.log(`[legacy-trade/league-analyze] AI cache miss { leagueId: '${leagueId}', userId: '${sleeperUsername}', modelCallMs: ${aiSuggestionsResult.modelDurationMs ?? -1} }`)
        console.log(`[legacy-trade/league-analyze] saved AiResult { id: '${aiSuggestionsResult.row.id}', resultKey: '${aiSuggestionsResult.row.resultKey}' }`)
      }

      const aiResponse =
        (typeof aiSuggestionsResult.row.resultText === 'string' && aiSuggestionsResult.row.resultText.trim()) ||
        ((aiSuggestionsResult.row.resultJson as any)?.content as string | undefined) ||
        '[]'

      try {
        const cleaned = aiResponse.replace(/```json\n?|```\n?/g, '').trim()
        const parsed = JSON.parse(cleaned)
        const arr = Array.isArray(parsed) ? parsed : (parsed.tradeSuggestions || parsed.suggestions || [parsed])

        for (const suggestion of arr) {
          if (!suggestion?.targetManager && !suggestion?.targetDisplayName) continue

          const manager = managerRosters.find(
            (m) =>
              m.username === suggestion.targetManager ||
              m.displayName === suggestion.targetDisplayName
          )

          tradeSuggestions.push({
            targetManager: suggestion.targetManager || suggestion.targetDisplayName || 'Unknown',
            targetDisplayName: suggestion.targetDisplayName || suggestion.targetManager || 'Unknown',
            targetAvatar: manager?.avatar,
            theirNeeds: Array.isArray(suggestion.theirNeeds) ? suggestion.theirNeeds : [],
            yourSurplus: Array.isArray(suggestion.yourSurplus) ? suggestion.yourSurplus : [],
            suggestedTrades: Array.isArray(suggestion.suggestedTrades) ? suggestion.suggestedTrades : [],
            overallFit: suggestion.overallFit || 'Medium',
          })
        }
      } catch (e) {
        parseWarning = 'AI response parsing failed - retrying may help'
        console.error('Failed to parse AI response:', e, aiResponse)
        aiDegraded = true
      }
    } catch (e) {
      // Graceful degradation: OpenAI failure should not fail entire request
      console.error('[TradeLeagueAnalyze] OpenAI API failure:', e)
      aiDegraded = true
      parseWarning = `AI analysis unavailable: ${e instanceof Error ? e.message : 'Service error'}. Returning basic league context.`
    }

    // Track tool usage
    trackLegacyToolUsage('trade_finder', null, null, { leagueId, managerCount: managerRosters.length + 1 })

    // 9) Cache to SleeperImportCache for downstream tools (OTB packages, etc.)
    try {
      await (prisma as any).sleeperImportCache.upsert({
        where: {
          sleeperUsername_sleeperLeagueId: {
            sleeperUsername,
            sleeperLeagueId: leagueId,
          },
        },
        create: {
          sleeperUsername,
          sleeperLeagueId: leagueId,
          leagueName,
          leagueContext: {
            league: leagueInfo,
            profilesByRosterId: managerProfiles,
            userRosterId: userRoster.rosterId,
          },
          managerRosters: { assetsByRosterId },
          fantasyCalcValueMap,
        },
        update: {
          leagueName,
          leagueContext: {
            league: leagueInfo,
            profilesByRosterId: managerProfiles,
            userRosterId: userRoster.rosterId,
          },
          managerRosters: { assetsByRosterId },
          fantasyCalcValueMap,
          updatedAt: new Date(),
        },
      })
    } catch (e) {
      console.error('Failed to update SleeperImportCache:', e)
    }

    const responsePayload = {
      success: true,
      leagueName,
      scoringType,
      userTeam: {
        displayName: userRoster.displayName,
        record: userRoster.record,
        pointsFor: userRoster.pointsFor,
        rosterSize: userRoster.players.length,
      },
      tradeSuggestions,
      managerCount: managerRosters.length + 1,
      ...(parseWarning ? { warning: parseWarning } : {}),
      ...(aiDegraded ? { aiDegraded: true, dataQuality: 'degraded' } : {}),
      ...(unifiedLeagueCtx ? {
        contextId: unifiedLeagueCtx.contextId,
        sourceFreshness: unifiedLeagueCtx.sourceFreshness,
      } : {}),
    }

    writeSnapshot({
      leagueId,
      sleeperUsername,
      snapshotType: 'league_analyze',
      payload: responsePayload,
      season: leagueInfo?.season ? parseInt(leagueInfo.season, 10) : undefined,
      ttlHours: 24,
    }).catch(() => {})

    const hitRate = await getHistoricalHitRate(sleeperUsername, 'trade_finder', leagueId).catch(() => null)

    const crResult = computeConfidenceRisk({
      category: 'trade_finder',
      userId: sleeperUsername,
      leagueId,
      dataCompleteness: {
        hasHistoricalData: true,
        dataPointCount: tradeSuggestions.length * 20,
        playerCoverage: 0.85,
        isCommonScenario: true,
      },
      tradeContext: {
        assetCount: tradeSuggestions.reduce((sum: number, s: any) => sum + (s.suggestedTrades?.length || 0), 0),
      },
      historicalHitRate: hitRate,
    })

    if (tradeSuggestions.length > 0) {
      autoLogDecision({
        userId: sleeperUsername,
        leagueId,
        decisionType: 'trade_finder',
        aiRecommendation: {
          summary: `Trade Finder: ${tradeSuggestions.length} opportunities found`,
          suggestionCount: tradeSuggestions.length,
          topTarget: tradeSuggestions[0]?.targetManager,
          topGrade: tradeSuggestions[0]?.suggestedTrades?.[0]?.tradeGrade,
        },
        confidenceScore: crResult.confidenceScore01,
        riskProfile: crResult.riskProfile,
        contextSnapshot: { leagueId, scoringType },
        confidenceRisk: crResult,
      })
    }

    ;(responsePayload as any).confidenceRisk = {
      confidence: crResult.numericConfidence,
      level: crResult.confidenceLevel,
      volatility: crResult.volatilityLevel,
      riskProfile: crResult.riskProfile,
      riskTags: crResult.riskTags,
      explanation: crResult.explanation,
    }

    return NextResponse.json(responsePayload)
  } catch (e) {
    console.error('league-analyze error', e)
    return NextResponse.json(
      { error: 'Failed to analyze league', details: String(e) },
      { status: 500 }
    )
  }
})
