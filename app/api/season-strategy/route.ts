import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { authOptions } from '@/lib/auth'
import {
  getLeagueInfo,
  getLeagueMatchups,
  getLeagueRosters,
  getLeagueUsers,
  getSleeperUser,
  getTradedDraftPicks,
  getAllPlayers,
  type SleeperLeague,
  type SleeperMatchup,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperUser,
} from '@/lib/sleeper-client'
import { findPlayerByName } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { calculateDynastyScore, findPlayerTier } from '@/lib/dynasty-tiers'
import { fetchPlayerNewsFromGrok, getManagerProfiles } from '@/lib/ai-gm-intelligence'
import { analyzeUserTradingProfile } from '@/lib/smart-trade-recommendations'
import { buildLeagueDecisionContext, summarizeLeagueDecisionContext } from '@/lib/league-decision-context'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { DEFAULT_SPORT, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const openai = getOpenAIRouteClient()

const API_SPORTS = ['nfl', 'nhl', 'nba', 'mlb', 'ncaaf', 'ncaab', 'soccer'] as const
type ApiSport = (typeof API_SPORTS)[number]

const REQUEST_SCHEMA = z.object({
  username: z.string().trim().min(1).max(40),
  leagueId: z.string().trim().min(1),
  sport: z.enum(API_SPORTS).optional(),
  week: z.number().int().min(1).max(18).optional(),
  forceRefresh: z.boolean().optional().default(false),
})

const WIN_WINDOW_SCHEMA = z
  .object({
    classification: z.enum(['CONTENDER', 'FRINGE_CONTENDER', 'REBUILDER', 'TRANSITION']).catch('TRANSITION'),
    confidence: z.number().min(0).max(100).catch(60),
    rationale: z.string().catch('The roster sits between competing priorities and needs a more targeted plan.'),
    timeframe: z.string().catch('This season'),
  })
  .catch({
    classification: 'TRANSITION',
    confidence: 60,
    rationale: 'The roster sits between competing priorities and needs a more targeted plan.',
    timeframe: 'This season',
  })

const POSITION_GRADE_SCHEMA = z
  .object({
    grade: z.string().catch('C'),
    depth: z.string().catch('solid'),
    note: z.string().catch('Depth and weekly reliability are mixed at this position.'),
  })
  .catch({
    grade: 'C',
    depth: 'solid',
    note: 'Depth and weekly reliability are mixed at this position.',
  })

const TRADE_TARGET_SCHEMA = z
  .object({
    playerName: z.string().catch('Unknown target'),
    position: z.string().catch('Flex'),
    currentOwner: z.string().catch('Unknown manager'),
    askPrice: z.string().catch('Open a fair-value conversation based on current market value.'),
    urgency: z.enum(['high', 'medium', 'low']).catch('medium'),
    why: z.string().catch('The target improves a real roster need without forcing a bad fit.'),
  })
  .catch({
    playerName: 'Unknown target',
    position: 'Flex',
    currentOwner: 'Unknown manager',
    askPrice: 'Open a fair-value conversation based on current market value.',
    urgency: 'medium',
    why: 'The target improves a real roster need without forcing a bad fit.',
  })

const SELL_CANDIDATE_SCHEMA = z
  .object({
    playerName: z.string().catch('Unknown player'),
    sellReason: z.string().catch('Monitor the market and consider moving this asset at the right price.'),
    targetManagers: z.array(z.string()).catch([]),
    valueWindow: z.string().catch('peak now'),
  })
  .catch({
    playerName: 'Unknown player',
    sellReason: 'Monitor the market and consider moving this asset at the right price.',
    targetManagers: [],
    valueWindow: 'peak now',
  })

const STASH_TARGET_SCHEMA = z
  .object({
    type: z.enum(['handcuff', 'breakout_candidate', 'injured_starter']).catch('breakout_candidate'),
    playerDescription: z.string().catch('Depth asset'),
    reason: z.string().catch('This bench spot can be used for upside instead of replacement-level depth.'),
  })
  .catch({
    type: 'breakout_candidate',
    playerDescription: 'Depth asset',
    reason: 'This bench spot can be used for upside instead of replacement-level depth.',
  })

const WEEKLY_ACTION_SCHEMA = z
  .object({
    timeframe: z.string().catch('Next stretch'),
    focus: z.string().catch('Tighten the lineup and keep improving weak spots.'),
    actions: z.array(z.string()).catch([]),
    watchList: z.array(z.string()).catch([]),
  })
  .catch({
    timeframe: 'Next stretch',
    focus: 'Tighten the lineup and keep improving weak spots.',
    actions: [],
    watchList: [],
  })

const OPPONENT_INTEL_SCHEMA = z
  .object({
    managerName: z.string().catch('Unknown manager'),
    threat: z.enum(['high', 'medium', 'low']).catch('medium'),
    theirStrategy: z.string().catch('Their roster direction is still developing.'),
    howToExploit: z.string().catch('Look for positional leverage and time your offers carefully.'),
    tradeOpportunity: z.string().catch('Monitor this roster for a future trade window.'),
  })
  .catch({
    managerName: 'Unknown manager',
    threat: 'medium',
    theirStrategy: 'Their roster direction is still developing.',
    howToExploit: 'Look for positional leverage and time your offers carefully.',
    tradeOpportunity: 'Monitor this roster for a future trade window.',
  })

const PLAN_SCHEMA = z.object({
  winWindow: WIN_WINDOW_SCHEMA,
  rosterGrade: z
    .object({
      overall: z.string().catch('B'),
      byPosition: z.record(z.string(), POSITION_GRADE_SCHEMA).catch({}),
      strengths: z.array(z.string()).catch([]),
      weaknesses: z.array(z.string()).catch([]),
    })
    .catch({
      overall: 'B',
      byPosition: {},
      strengths: [],
      weaknesses: [],
    }),
  seasonGoal: z
    .object({
      primary: z.string().catch('Make playoffs'),
      secondary: z.string().optional(),
      keyMilestone: z.string().catch('Turn one roster strength into a weekly edge.'),
    })
    .catch({
      primary: 'Make playoffs',
      keyMilestone: 'Turn one roster strength into a weekly edge.',
    }),
  tradeStrategy: z
    .object({
      priority: z.string().catch('mixed'),
      immediateTargets: z.array(TRADE_TARGET_SCHEMA).catch([]),
      sellCandidates: z.array(SELL_CANDIDATE_SCHEMA).catch([]),
      holdList: z.array(z.string()).catch([]),
      tradeDeadlineAdvice: z.string().catch('Stay flexible and only pay up when the roster truly needs it.'),
    })
    .catch({
      priority: 'mixed',
      immediateTargets: [],
      sellCandidates: [],
      holdList: [],
      tradeDeadlineAdvice: 'Stay flexible and only pay up when the roster truly needs it.',
    }),
  waiverStrategy: z
    .object({
      streamingPositions: z.array(z.string()).catch([]),
      stashTargets: z.array(STASH_TARGET_SCHEMA).catch([]),
      faabPhilosophy: z.string().catch('strategic'),
      faabAdvice: z.string().catch('Protect flexibility while still attacking true difference-makers.'),
    })
    .catch({
      streamingPositions: [],
      stashTargets: [],
      faabPhilosophy: 'strategic',
      faabAdvice: 'Protect flexibility while still attacking true difference-makers.',
    }),
  scheduleAnalysis: z
    .object({
      playoffWeeks: z.string().catch('Playoff timing was not available.'),
      peakWeeks: z.string().catch('Plan to peak once the roster core is healthy and aligned.'),
      riskWeeks: z.string().catch('Watch injury clusters, byes, and thin positions.'),
      advice: z.string().catch('Use early weeks to gather data, then shift into matchup-driven aggression.'),
    })
    .catch({
      playoffWeeks: 'Playoff timing was not available.',
      peakWeeks: 'Plan to peak once the roster core is healthy and aligned.',
      riskWeeks: 'Watch injury clusters, byes, and thin positions.',
      advice: 'Use early weeks to gather data, then shift into matchup-driven aggression.',
    }),
  weeklyActionPlan: z.array(WEEKLY_ACTION_SCHEMA).catch([]),
  opponentIntelligence: z.array(OPPONENT_INTEL_SCHEMA).catch([]),
  draftPickStrategy: z
    .object({
      currentCapital: z.string().catch('Pick capital appears balanced relative to the rest of the league.'),
      recommendation: z.string().catch('hold'),
      advice: z.string().catch('Use picks as leverage only when the roster direction is clear.'),
    })
    .catch({
      currentCapital: 'Pick capital appears balanced relative to the rest of the league.',
      recommendation: 'hold',
      advice: 'Use picks as leverage only when the roster direction is clear.',
    }),
  confidenceScore: z.number().min(0).max(100).catch(70),
  topInsight: z.string().catch('The next few roster moves should follow one consistent direction instead of mixing timelines.'),
  generatedAt: z.string().optional(),
})

type EnrichedPlayer = {
  id: string
  name: string
  position: string
  team: string
  age: number | null
  value: number
  tier: number | null
  dynastyScore: number
  status: string | null
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function resolvePpr(scoringSettings: Record<string, number> | undefined): 0 | 0.5 | 1 {
  const receptionPoints = numberFromUnknown(scoringSettings?.rec) ?? 0
  if (receptionPoints >= 1) return 1
  if (receptionPoints >= 0.5) return 0.5
  return 0
}

function toApiSport(sport: SupportedSport): ApiSport {
  switch (sport) {
    case 'NFL':
      return 'nfl'
    case 'NHL':
      return 'nhl'
    case 'NBA':
      return 'nba'
    case 'MLB':
      return 'mlb'
    case 'NCAAF':
      return 'ncaaf'
    case 'NCAAB':
      return 'ncaab'
    case 'SOCCER':
      return 'soccer'
    default:
      return 'nfl'
  }
}

function formatManagerName(user: SleeperUser | undefined, fallbackRosterId: number): string {
  return user?.display_name || user?.username || `Manager ${fallbackRosterId}`
}

async function fetchSleeperPlayersForSport(sport: ApiSport): Promise<Record<string, SleeperPlayer>> {
  if (sport === 'nfl') {
    return getAllPlayers()
  }

  const dbSportMap: Record<ApiSport, string> = {
    nfl: 'NFL',
    nba: 'NBA',
    nhl: 'NHL',
    mlb: 'MLB',
    ncaaf: 'NCAAF',
    ncaab: 'NCAAB',
    soccer: 'SOCCER',
  }

  const dbSport = dbSportMap[sport]
  const rows = await prisma.sportsPlayerRecord.findMany({
    where: { sport: dbSport },
    select: {
      id: true,
      name: true,
      position: true,
      team: true,
      injuryStatus: true,
      stats: true,
    },
    take: 8000,
    orderBy: { lastUpdated: 'desc' },
  })

  if (!rows.length) {
    return {}
  }

  const out: Record<string, SleeperPlayer> = {}
  for (const row of rows) {
    const fullName = row.name?.trim() || row.id
    const parts = fullName.split(/\s+/)
    const firstName = parts[0] || fullName
    const lastName = parts.slice(1).join(' ') || ''
    const stats = row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats)
      ? (row.stats as Record<string, unknown>)
      : null
    const ageValue = stats?.age
    const age = typeof ageValue === 'number' ? ageValue : typeof ageValue === 'string' ? Number(ageValue) || undefined : undefined

    const player: SleeperPlayer = {
      player_id: row.id,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      position: row.position || 'FLEX',
      team: row.team || null,
      status: row.injuryStatus || 'active',
      ...(typeof age === 'number' && Number.isFinite(age) ? { age } : {}),
    }

    out[row.id] = player
    const fallbackId = row.id.includes(':') ? row.id.split(':').pop() || row.id : row.id
    if (!out[fallbackId]) {
      out[fallbackId] = { ...player, player_id: fallbackId }
    }
  }

  return out
}

function formatRecord(roster: SleeperRoster): string {
  const wins = roster.settings.wins ?? 0
  const losses = roster.settings.losses ?? 0
  const ties = roster.settings.ties ?? 0
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`
}

function buildPlayoffWeeksSummary(leagueInfo: SleeperLeague): string {
  const settings = recordFromUnknown(leagueInfo.settings)
  const start = numberFromUnknown(settings?.playoff_week_start)
  if (!start) {
    return 'Playoff weeks were not exposed by the league settings.'
  }

  const endWeek = Math.min(start + 2, 18)
  return `Playoffs project to start in Week ${start} and run through Week ${endWeek}.`
}

async function buildScheduleSnapshot(
  leagueId: string,
  userRosterId: number,
  startWeek: number | undefined,
  managerNameByRosterId: Map<number, string>,
): Promise<string[]> {
  if (!startWeek) return []

  const weeks = [startWeek, startWeek + 1, startWeek + 2].filter((week) => week <= 18)
  const matchupWindows = await Promise.all(
    weeks.map(async (week) => ({
      week,
      matchups: await getLeagueMatchups(leagueId, week).catch(() => [] as SleeperMatchup[]),
    })),
  )

  const lines: string[] = []
  for (const { week, matchups } of matchupWindows) {
    const userMatchup = matchups.find((entry) => entry.roster_id === userRosterId)
    if (!userMatchup) continue

    const opponent = matchups.find(
      (entry) => entry.matchup_id === userMatchup.matchup_id && entry.roster_id !== userRosterId,
    )

    if (!opponent) {
      lines.push(`Week ${week}: No opponent data was available.`)
      continue
    }

    const opponentName = managerNameByRosterId.get(opponent.roster_id) || `Roster ${opponent.roster_id}`
    lines.push(`Week ${week}: vs ${opponentName}`)
  }

  return lines
}

const SEASON_STRATEGY_SYSTEM_PROMPT = `
You are AllFantasy's elite season strategy planner for fantasy sports.

You support NFL, NHL, NBA, MLB, NCAA Football, NCAA Basketball, and Soccer.
Your job is to analyze one specific team inside one specific league and return a complete season blueprint.

CRITICAL RULES:
1. Only mention players, managers, and teams that appear in the provided data.
2. Never invent values, draft picks, records, or schedule facts.
3. Real-time news should override stale market assumptions when it is provided.
4. Align every recommendation with the roster's likely win window and league market context.
5. Trade ideas must stay realistic and value-aware.
6. Keep the output actionable, concise, and specific to this league.
7. For roster grades, use the position keys that actually matter for the sport and roster composition in the provided data.

Return JSON only.
`

export async function POST(request: NextRequest) {
  const session = (await getServerSession(authOptions)) as { user?: { id?: string | null } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ip = getClientIp(request)
  const rateLimit = consumeRateLimit({
    scope: 'ai',
    action: 'season_strategy',
    ip,
    maxRequests: 3,
    windowMs: 60_000,
    includeIpInKey: true,
  })

  if (!rateLimit.success) {
    return NextResponse.json(
      {
        error: 'Rate limited',
        retryAfterSec: rateLimit.retryAfterSec,
      },
      { status: 429 },
    )
  }

  let body: z.infer<typeof REQUEST_SCHEMA>
  try {
    body = REQUEST_SCHEMA.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { username, leagueId, week, sport: requestedSport } = body

  try {
    const [sleeperUser, leagueInfo, rosters, tradedPicks, leagueUsers, userProfile] = await Promise.all([
      getSleeperUser(username),
      getLeagueInfo(leagueId),
      getLeagueRosters(leagueId),
      getTradedDraftPicks(leagueId),
      getLeagueUsers(leagueId),
      analyzeUserTradingProfile(username).catch(() => null),
    ])

    if (!sleeperUser) {
      return NextResponse.json({ error: 'Sleeper user not found' }, { status: 404 })
    }

    if (!leagueInfo) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    if (!rosters.length) {
      return NextResponse.json({ error: 'No rosters found in this league' }, { status: 404 })
    }

    const supportedSport = normalizeToSupportedSport(leagueInfo.sport || requestedSport || DEFAULT_SPORT)
    const apiSport = toApiSport(supportedSport)
    const isDynasty = numberFromUnknown(recordFromUnknown(leagueInfo.settings)?.type) === 2
    const isSuperFlex = Array.isArray(leagueInfo.roster_positions) && leagueInfo.roster_positions.includes('SUPER_FLEX')
    const totalTeams = rosters.length || leagueInfo.total_rosters || 12

    const [allPlayers, fantasyCalcValues, decisionContext, managerProfiles] = await Promise.all([
      fetchSleeperPlayersForSport(apiSport),
      getFantasyCalcValuesDbFirst({
        isDynasty,
        numQbs: isSuperFlex ? 2 : 1,
        numTeams: totalTeams,
        ppr: resolvePpr(leagueInfo.scoring_settings),
      }),
      buildLeagueDecisionContext({
        league: leagueInfo,
        rosters,
        tradedPicks,
        userRosterId: rosters.find((roster) => roster.owner_id === sleeperUser.user_id)?.roster_id,
        isSuperFlex,
      }).catch(() => null),
      getManagerProfiles(
        leagueId,
        rosters
          .map((roster) => roster.owner_id)
          .filter((ownerId): ownerId is string => typeof ownerId === 'string' && ownerId.length > 0),
      ).catch(() => []),
    ])

    const userRoster = rosters.find((roster) => roster.owner_id === sleeperUser.user_id)
    if (!userRoster) {
      return NextResponse.json({ error: 'User not found in this league' }, { status: 404 })
    }

    const userById = new Map(leagueUsers.map((user) => [user.user_id, user]))
    const managerProfileById = new Map(managerProfiles.map((profile) => [profile.managerId, profile]))
    const managerNameByRosterId = new Map<number, string>()

    for (const roster of rosters) {
      managerNameByRosterId.set(
        roster.roster_id,
        formatManagerName(userById.get(roster.owner_id), roster.roster_id),
      )
    }

    const enrichPlayer = (playerId: string): EnrichedPlayer | null => {
      const sleeperPlayer = allPlayers[playerId]
      if (!sleeperPlayer) return null

      const name =
        sleeperPlayer.full_name ||
        [sleeperPlayer.first_name, sleeperPlayer.last_name].filter(Boolean).join(' ').trim() ||
        playerId
      const position = sleeperPlayer.position || 'FLEX'
      const fantasyCalcPlayer = findPlayerByName(fantasyCalcValues, name)
      const tieredPlayer = findPlayerTier(name)
      const value = fantasyCalcPlayer?.value ?? 0
      const age = sleeperPlayer.age ?? tieredPlayer?.age ?? fantasyCalcPlayer?.player.maybeAge ?? null
      const tier = tieredPlayer?.tier ?? null
      const dynastyScore = value > 0
        ? calculateDynastyScore(value, position, age ?? undefined, tier, isSuperFlex, false).score
        : 0

      return {
        id: playerId,
        name,
        position,
        team: sleeperPlayer.team || 'FA',
        age,
        value,
        tier,
        dynastyScore,
        status: sleeperPlayer.status || null,
      }
    }

    const userPlayers = (userRoster.players || [])
      .map(enrichPlayer)
      .filter((player): player is EnrichedPlayer => player != null)
      .sort((left, right) => right.value - left.value)

    if (!userPlayers.length) {
      return NextResponse.json(
        { error: 'Could not resolve enough player data for this league and sport.' },
        { status: 422 },
      )
    }

    const leagueRosters = rosters
      .filter((roster) => roster.roster_id !== userRoster.roster_id)
      .map((roster) => {
        const managerName = managerNameByRosterId.get(roster.roster_id) || `Manager ${roster.roster_id}`
        const managerProfile = managerProfileById.get(roster.owner_id)
        const partnerFit = decisionContext?.partnerFit[String(roster.roster_id)]

        return {
          rosterId: roster.roster_id,
          managerId: roster.owner_id,
          managerName,
          record: formatRecord(roster),
          teamSituation: managerProfile?.teamSituation ?? 'middle',
          recentTradeActivity: managerProfile?.recentTradeActivity ?? 0,
          tradePreferences: managerProfile?.tradingPreferences ?? null,
          fitScore: partnerFit?.fitScore ?? null,
          fitReasons: partnerFit?.reasons ?? [],
          players: (roster.players || [])
            .map(enrichPlayer)
            .filter((player): player is EnrichedPlayer => player != null)
            .sort((left, right) => right.value - left.value)
            .slice(0, 18),
        }
      })

    const playerNamesForNews = Array.from(
      new Set(
        [
          ...userPlayers.slice(0, 15).map((player) => player.name),
          ...leagueRosters.flatMap((roster) => roster.players.slice(0, 4).map((player) => player.name)),
        ].filter(Boolean),
      ),
    ).slice(0, 30)

    const playerNews =
      (apiSport === 'nfl' || apiSport === 'nba') && playerNamesForNews.length > 0
        ? await fetchPlayerNewsFromGrok(playerNamesForNews, apiSport)
        : []

    const rosterValue = userPlayers.reduce((sum, player) => sum + player.value, 0)
    const agedPlayers = userPlayers.filter((player) => typeof player.age === 'number')
    const avgAge =
      agedPlayers.length > 0
        ? Number((agedPlayers.reduce((sum, player) => sum + (player.age ?? 0), 0) / agedPlayers.length).toFixed(1))
        : null

    const userRecord = formatRecord(userRoster)
    const userPointsFor =
      (userRoster.settings.fpts ?? 0) + ((userRoster.settings.fpts_decimal ?? 0) / 100)
    const decisionContextSummary = decisionContext ? summarizeLeagueDecisionContext(decisionContext) : 'Unavailable'
    const scheduleSnapshot = await buildScheduleSnapshot(
      leagueId,
      userRoster.roster_id,
      week,
      managerNameByRosterId,
    )
    const playoffWeeksSummary = buildPlayoffWeeksSummary(leagueInfo)

    const prompt = `
## TEAM SNAPSHOT
User: ${username}
League: ${leagueInfo.name || 'Unknown League'}
Sport: ${supportedSport}
Format: ${isDynasty ? 'Dynasty' : 'Redraft'} | SuperFlex: ${isSuperFlex ? 'Yes' : 'No'} | Teams: ${totalTeams}
Current Record: ${userRecord}
Points For: ${userPointsFor.toFixed(2)}
Current Week: ${week ? `Week ${week}` : 'Pre-season / Offseason'}
Roster Positions: ${(leagueInfo.roster_positions || []).join(', ')}
Scoring Summary: ${Object.entries(leagueInfo.scoring_settings || {})
        .slice(0, 12)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')}

## USER ROSTER
Total Roster Value: ${rosterValue}
Average Age: ${avgAge ?? 'N/A'}
${userPlayers.slice(0, 30).map((player) => `- ${player.name} | ${player.position} | ${player.team} | Age: ${player.age ?? '?'} | Value: ${player.value} | Tier: ${player.tier ?? 'N/A'} | Dynasty Score: ${player.dynastyScore} | Status: ${player.status ?? 'active'}`).join('\n')}

## OTHER LEAGUE TEAMS
${leagueRosters.map((roster) => `### ${roster.managerName}
Record: ${roster.record}
Team Situation: ${roster.teamSituation}
Recent Trade Activity: ${roster.recentTradeActivity}
Partner Fit Score: ${roster.fitScore ?? 'N/A'}
Fit Reasons: ${roster.fitReasons.join(', ') || 'None'}
Trade Preferences: ${roster.tradePreferences ? `Youth=${roster.tradePreferences.prefersYouth ? 'Yes' : 'No'}, Depth=${roster.tradePreferences.prefersDepth ? 'Yes' : 'No'}, Favorite Positions=${roster.tradePreferences.favoritePositions.join(', ') || 'None'}` : 'Unknown'}
Top Players:
${roster.players.map((player) => `- ${player.name} | ${player.position} | Value: ${player.value} | Tier: ${player.tier ?? 'N/A'} | Age: ${player.age ?? '?'}`).join('\n')}`).join('\n\n')}

## USER TRADING PROFILE
${userProfile ? `Total Trades: ${userProfile.totalTrades}
Win Rate: ${userProfile.winRate}%
Youth vs Production: ${userProfile.tradingStyle.youthVsProduction}%
Consolidation vs Depth: ${userProfile.tradingStyle.consolidationVsDepth}%
Picks vs Players: ${userProfile.tradingStyle.picksVsPlayers}%
Risk Tolerance: ${userProfile.tradingStyle.riskTolerance}%
Position Preferences: ${userProfile.positionPreferences.slice(0, 6).map((entry) => `${entry.position} (${entry.netAcquired > 0 ? '+' : ''}${entry.netAcquired})`).join(', ') || 'None'}
Favorite Partners: ${userProfile.favoriteTradePartners.slice(0, 4).map((entry) => `${entry.managerName} (${entry.tradeCount})`).join(', ') || 'None'}
Recent Activity: ${userProfile.recentTrends.tradesLast30Days} trades in last 30 days` : 'No historical trading profile was available for this user.'}

## LEAGUE DECISION CONTEXT
${decisionContextSummary}

## DRAFT PICKS / CAPITAL
${tradedPicks.length > 0 ? tradedPicks.slice(0, 25).map((pick) => `- ${pick.season} Round ${pick.round} | Current Owner Roster ${pick.owner_id} | Previous Owner Roster ${pick.previous_owner_id}`).join('\n') : 'No traded picks were returned for this league.'}

## REAL-TIME PLAYER NEWS
${playerNews.length > 0
        ? playerNews
            .filter((entry) => entry.news.length > 0 || entry.buzz)
            .slice(0, 20)
            .map((entry) => `${entry.playerName} (${entry.sentiment}): ${entry.news.slice(0, 2).join(' | ')}${entry.buzz ? ` | Buzz: ${entry.buzz}` : ''}`)
            .join('\n')
        : `No real-time news source was used for ${supportedSport}.`}

## SCHEDULE SNAPSHOT
${playoffWeeksSummary}
${scheduleSnapshot.length > 0 ? scheduleSnapshot.map((line) => `- ${line}`).join('\n') : '- No upcoming matchup snapshot was available.'}

## TASK
Generate a complete season strategy blueprint for this team.

Requirements:
- Tie the win-window classification to the roster, record, and league context.
- Use rosterGrade.byPosition keys that match the actual sport/roster.
- Reference real managers and players from this data when proposing trades or opponent intelligence.
- Keep trade suggestions realistic and value-aware.
- Put draft-pick guidance inside draftPickStrategy.
- Keep weeklyActionPlan focused on the next important phases of the season.
- Return valid JSON only.
`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SEASON_STRATEGY_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.55,
      max_tokens: 4000,
    })

    const raw = completion.choices[0]?.message?.content
    if (!raw) {
      throw new Error('No AI response returned.')
    }

    const parsed = PLAN_SCHEMA.parse(JSON.parse(raw))
    const plan = {
      ...parsed,
      generatedAt: new Date().toISOString(),
    }

    return NextResponse.json({
      success: true,
      plan,
      meta: {
        username,
        leagueId,
        leagueName: leagueInfo.name || 'Unknown League',
        sport: supportedSport,
        isDynasty,
        isSuperFlex,
        totalTeams,
        rosterValue,
        avgAge,
        playerCount: userPlayers.length,
        currentRecord: userRecord,
        pointsFor: Number(userPointsFor.toFixed(2)),
        playoffWeeks: playoffWeeksSummary,
        scheduleSnapshot,
        contextCompleteness: decisionContext?.metadata.snapshotCompleteness ?? 'PARTIAL',
      },
    })
  } catch (error: unknown) {
    console.error('[season-strategy]', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Strategy generation failed',
      },
      { status: 500 },
    )
  }
}
