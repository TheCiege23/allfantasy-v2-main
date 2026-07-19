import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { openaiChatJson } from '@/lib/openai-client'
import { resolveLegacyLeagueAccess } from '@/lib/legacy/assertLegacyLeagueAccess'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { recordLlmUsage } from '@/lib/telemetry/llm-usage'

const PSYCHOLOGY_MAX_TOKENS = 600

interface ManagerData {
  username: string
  rosterId: number
  record: { wins: number; losses: number; ties: number }
  pointsFor: number
  pointsAgainst: number
  trades: {
    total: number
    playersGiven: number
    playersReceived: number
    picksGiven: number
    picksReceived: number
    avgValueDiff: number | null
    tradingStyle: any
    favoriteTargets: any
  }
  rosterSize: number
  isChampion: boolean
  playoffSeed: number | null
  finalStanding: number | null
}

interface ArchetypeDefinition {
  archetype: string
  emoji: string
  summaryTemplate: (name: string, record: string, trades: number) => string
  riskProfile: 'LOW' | 'MEDIUM' | 'HIGH'
  decisionSpeed: 'IMPULSIVE' | 'DELIBERATE' | 'REACTIVE'
  blindSpot: string
  negotiationStyle: string
  tendencies: string[]
  traitBases: { risk: number; patience: number; aggression: number; adaptability: number }
}

const ARCHETYPE_CATALOG: ArchetypeDefinition[] = [
  {
    archetype: 'The Shark',
    emoji: '🦈',
    summaryTemplate: (n, r, t) => `${n} (${r}) is a ruthless competitor with ${t} trades, always hunting for the next edge. They target undervalued assets and strike fast when opportunity presents itself.`,
    riskProfile: 'HIGH', decisionSpeed: 'IMPULSIVE',
    blindSpot: 'Overconfidence can lead to overpaying in trades when emotions run high.',
    negotiationStyle: 'Aggressive opener who anchors high and pushes for quick deals.',
    tendencies: ['Targets buy-low candidates aggressively', 'Floods trade offers to multiple managers', 'Willing to overpay for perceived edges'],
    traitBases: { risk: 78, patience: 25, aggression: 82, adaptability: 65 },
  },
  {
    archetype: 'The Architect',
    emoji: '🏗️',
    summaryTemplate: (n, r, t) => `${n} (${r}) is a methodical dynasty builder with ${t} trades, constructing rosters with long-term vision. Every move serves the blueprint.`,
    riskProfile: 'MEDIUM', decisionSpeed: 'DELIBERATE',
    blindSpot: 'Can be too patient, missing win-now windows while building for a future that may not come.',
    negotiationStyle: 'Analytical and prepared — comes with spreadsheets and projections.',
    tendencies: ['Acquires young upside players consistently', 'Stockpiles draft picks for future leverage', 'Rarely makes panic moves after losses'],
    traitBases: { risk: 45, patience: 80, aggression: 35, adaptability: 55 },
  },
  {
    archetype: 'The Gambler',
    emoji: '🎲',
    summaryTemplate: (n, r, t) => `${n} (${r}) thrives on high-variance plays with ${t} trades. They embrace boom-or-bust strategies and are never afraid to roll the dice.`,
    riskProfile: 'HIGH', decisionSpeed: 'IMPULSIVE',
    blindSpot: 'Chases upside at the expense of roster stability and floor production.',
    negotiationStyle: 'Unpredictable — makes offers that seem wild but occasionally land gems.',
    tendencies: ['Swings for home runs on unproven talent', 'Frequently changes roster strategy mid-season', 'High waiver wire activity on speculative adds'],
    traitBases: { risk: 85, patience: 20, aggression: 70, adaptability: 75 },
  },
  {
    archetype: 'The Fortress',
    emoji: '🏰',
    summaryTemplate: (n, r, t) => `${n} (${r}) plays not to lose with ${t} trades. They build rosters with elite floors and refuse to give up proven producers for uncertain upside.`,
    riskProfile: 'LOW', decisionSpeed: 'DELIBERATE',
    blindSpot: 'Reluctance to trade proven assets means they may ride declining players too long.',
    negotiationStyle: 'Hard to move — demands overpays and rarely initiates offers.',
    tendencies: ['Holds elite players through slumps', 'Avoids trades unless heavily favored', 'Prioritizes floor over ceiling in roster decisions'],
    traitBases: { risk: 20, patience: 85, aggression: 15, adaptability: 30 },
  },
  {
    archetype: 'The Sniper',
    emoji: '🎯',
    summaryTemplate: (n, r, t) => `${n} (${r}) makes few but surgical moves with ${t} trades. When they pull the trigger, it's precise and calculated for maximum impact.`,
    riskProfile: 'MEDIUM', decisionSpeed: 'DELIBERATE',
    blindSpot: 'Waits too long for the "perfect" deal and can miss good-enough opportunities.',
    negotiationStyle: 'Patient and precise — waits for the right moment then strikes decisively.',
    tendencies: ['Low trade volume but high impact per trade', 'Targets specific positional needs', 'Rarely engages in speculative trades'],
    traitBases: { risk: 50, patience: 75, aggression: 55, adaptability: 45 },
  },
  {
    archetype: 'The Tinkerer',
    emoji: '🔧',
    summaryTemplate: (n, r, t) => `${n} (${r}) can't sit still with ${t} trades. They're constantly adjusting, tweaking, and optimizing their roster in pursuit of marginal gains.`,
    riskProfile: 'MEDIUM', decisionSpeed: 'REACTIVE',
    blindSpot: 'Over-optimization can destabilize a roster — sometimes the best move is no move.',
    negotiationStyle: 'Always open to discussion — sends and receives many trade offers.',
    tendencies: ['High transaction volume on waivers and trades', 'Frequently adjusts lineup based on matchups', 'Quick to react to weekly news and injuries'],
    traitBases: { risk: 55, patience: 30, aggression: 50, adaptability: 80 },
  },
  {
    archetype: 'The General',
    emoji: '⚔️',
    summaryTemplate: (n, r, t) => `${n} (${r}) commands their roster like a battlefield with ${t} trades. Win-now is the only mode — they maximize every season at any cost.`,
    riskProfile: 'HIGH', decisionSpeed: 'DELIBERATE',
    blindSpot: 'Win-now mentality can mortgage the future, leaving little draft capital or youth.',
    negotiationStyle: 'Bold and direct — makes strong offers and expects quick responses.',
    tendencies: ['Trades future picks for proven veterans', 'Aggressive at the trade deadline', 'Prioritizes championship windows over rebuilds'],
    traitBases: { risk: 70, patience: 35, aggression: 80, adaptability: 50 },
  },
  {
    archetype: 'The Collector',
    emoji: '🗃️',
    summaryTemplate: (n, r, t) => `${n} (${r}) stockpiles assets with ${t} trades. They hoard draft picks and young players, always preparing for the next big move.`,
    riskProfile: 'LOW', decisionSpeed: 'DELIBERATE',
    blindSpot: 'Accumulating assets without deploying them means potential championship windows pass by.',
    negotiationStyle: 'Always buying, rarely selling — looks for quantity deals.',
    tendencies: ['Acquires extra draft picks whenever possible', 'Prefers getting more pieces in trades', 'Builds deep rosters over top-heavy ones'],
    traitBases: { risk: 30, patience: 80, aggression: 25, adaptability: 45 },
  },
  {
    archetype: 'The Opportunist',
    emoji: '🦊',
    summaryTemplate: (n, r, t) => `${n} (${r}) is a shrewd deal-maker with ${t} trades. They exploit market inefficiencies and capitalize when others are desperate.`,
    riskProfile: 'MEDIUM', decisionSpeed: 'REACTIVE',
    blindSpot: 'Can come across as predatory, making other managers reluctant to trade with them.',
    negotiationStyle: 'Reads the room expertly and tailors offers to each manager\'s psychology.',
    tendencies: ['Buys low on injured or underperforming players', 'Sells high at peak value windows', 'Monitors other managers\' roster needs to create leverage'],
    traitBases: { risk: 60, patience: 55, aggression: 65, adaptability: 78 },
  },
  {
    archetype: 'The Loyalist',
    emoji: '🛡️',
    summaryTemplate: (n, r, t) => `${n} (${r}) rides or dies with their guys. With ${t} trades, they build through the draft and commit to their players through thick and thin.`,
    riskProfile: 'LOW', decisionSpeed: 'DELIBERATE',
    blindSpot: 'Emotional attachment to players leads to holding declining assets past their sell window.',
    negotiationStyle: 'Hard to pry players from — needs to be convinced a trade truly helps.',
    tendencies: ['Rarely trades drafted players', 'Values team chemistry and stability', 'Prefers incremental improvement over wholesale changes'],
    traitBases: { risk: 25, patience: 82, aggression: 20, adaptability: 35 },
  },
  {
    archetype: 'The Wildcard',
    emoji: '🃏',
    summaryTemplate: (n, r, t) => `${n} (${r}) keeps everyone guessing with ${t} trades. Their unpredictable style makes them dangerous — you never know what move is coming next.`,
    riskProfile: 'HIGH', decisionSpeed: 'IMPULSIVE',
    blindSpot: 'Lack of consistent strategy can lead to roster incoherence and missed synergies.',
    negotiationStyle: 'Chaotic energy — makes surprising offers that can be brilliant or baffling.',
    tendencies: ['Alternates between aggressive and conservative phases', 'Makes unexpected position pivots', 'High variance in trade quality'],
    traitBases: { risk: 75, patience: 30, aggression: 60, adaptability: 70 },
  },
  {
    archetype: 'The Closer',
    emoji: '🏆',
    summaryTemplate: (n, r, t) => `${n} (${r}) gets it done when it matters. With ${t} trades and a winning record, they have an instinct for making the right move at crunch time.`,
    riskProfile: 'MEDIUM', decisionSpeed: 'REACTIVE',
    blindSpot: 'Regular-season complacency — relies on playoff-time adjustments rather than sustained excellence.',
    negotiationStyle: 'Calm under pressure — makes their best deals when stakes are highest.',
    tendencies: ['Peaks during the fantasy playoffs', 'Times trades around the deadline', 'Clutch waiver pickups in key weeks'],
    traitBases: { risk: 55, patience: 60, aggression: 55, adaptability: 72 },
  },
]

function computeDeterministicArchetype(
  managerName: string,
  rosterId: number,
  record: { wins: number; losses: number; ties: number },
  tradeData: { total: number; playersGiven: number; playersReceived: number; picksGiven: number; picksReceived: number; avgValueDiff: number | null; youthCount: number; vetCount: number },
  teamData: any,
): ArchetypeDefinition & { traitOverrides: { risk: number; patience: number; aggression: number; adaptability: number } } {
  const totalGames = record.wins + record.losses + record.ties
  const winPct = totalGames > 0 ? record.wins / totalGames : 0.5
  const isWinning = winPct > 0.55
  const isLosing = winPct < 0.4
  const highScorer = (teamData?.pointsFor || 0) > (teamData?.pointsAgainst || 0) * 1.05
  const lowScorer = (teamData?.pointsFor || 0) < (teamData?.pointsAgainst || 0) * 0.95
  const compositeScore = teamData?.composite || 50
  const managerSkill = teamData?.managerSkillScore || 50
  const luckDelta = teamData?.luckDelta || 0
  const phase = (teamData?.phase || '').toLowerCase()
  const isContender = phase.includes('contend') || phase.includes('win')
  const isRebuilder = phase.includes('rebuild') || phase.includes('tank')

  const tradeVol = tradeData.total
  const netPicks = tradeData.picksReceived - tradeData.picksGiven
  const netPlayers = tradeData.playersReceived - tradeData.playersGiven
  const avgVal = tradeData.avgValueDiff ?? 0
  const youthBias = tradeData.youthCount - tradeData.vetCount

  let scores: { idx: number; score: number }[] = ARCHETYPE_CATALOG.map((a, idx) => ({ idx, score: 0 }))

  // The Shark: high trades, winning, positive value diff
  scores[0].score += tradeVol >= 8 ? 30 : tradeVol >= 4 ? 15 : 0
  scores[0].score += avgVal > 5 ? 20 : avgVal > 0 ? 10 : 0
  scores[0].score += isWinning ? 15 : 0
  scores[0].score += managerSkill >= 60 ? 10 : 0

  // The Architect: youth bias, pick accumulator, rebuilder
  scores[1].score += youthBias > 2 ? 25 : youthBias > 0 ? 12 : 0
  scores[1].score += netPicks > 2 ? 20 : netPicks > 0 ? 10 : 0
  scores[1].score += isRebuilder ? 20 : 0
  scores[1].score += tradeVol >= 3 && tradeVol <= 8 ? 10 : 0

  // The Gambler: high trade vol, mixed results, high variance
  scores[2].score += tradeVol >= 8 ? 20 : 0
  scores[2].score += Math.abs(luckDelta) > 2 ? 15 : 0
  scores[2].score += avgVal < -3 ? 15 : 0
  scores[2].score += !isWinning && !isLosing ? 10 : 0

  // The Fortress: low trades, winning, high points
  scores[3].score += tradeVol <= 2 ? 25 : tradeVol <= 4 ? 10 : 0
  scores[3].score += isWinning ? 20 : 0
  scores[3].score += highScorer ? 15 : 0
  scores[3].score += compositeScore >= 65 ? 10 : 0

  // The Sniper: low-medium trades, positive value diff
  scores[4].score += tradeVol >= 1 && tradeVol <= 5 ? 20 : 0
  scores[4].score += avgVal > 3 ? 25 : avgVal > 0 ? 12 : 0
  scores[4].score += managerSkill >= 55 ? 10 : 0
  scores[4].score += isWinning ? 10 : 0

  // The Tinkerer: high trade volume, moderate results
  scores[5].score += tradeVol >= 6 ? 30 : tradeVol >= 4 ? 15 : 0
  scores[5].score += netPlayers > 2 ? 15 : 0
  scores[5].score += !isWinning && !isLosing ? 10 : 0
  scores[5].score += Math.abs(avgVal) < 3 ? 10 : 0

  // The General: contender, trades vets, win-now
  scores[6].score += isContender ? 25 : 0
  scores[6].score += tradeData.vetCount > tradeData.youthCount ? 20 : 0
  scores[6].score += netPicks < -1 ? 15 : 0
  scores[6].score += isWinning ? 10 : 0

  // The Collector: accumulates picks and players
  scores[7].score += netPicks > 3 ? 25 : netPicks > 1 ? 12 : 0
  scores[7].score += netPlayers > 2 ? 20 : netPlayers > 0 ? 10 : 0
  scores[7].score += isRebuilder ? 15 : 0
  scores[7].score += tradeVol >= 3 ? 10 : 0

  // The Opportunist: positive value diff, moderate volume, reactive
  scores[8].score += avgVal > 5 ? 25 : avgVal > 2 ? 12 : 0
  scores[8].score += tradeVol >= 3 && tradeVol <= 8 ? 15 : 0
  scores[8].score += managerSkill >= 55 ? 10 : 0
  scores[8].score += luckDelta > 1 ? 10 : 0

  // The Loyalist: very low trades, stable
  scores[9].score += tradeVol === 0 ? 35 : tradeVol <= 1 ? 20 : 0
  scores[9].score += !isLosing ? 15 : 0
  scores[9].score += compositeScore >= 45 ? 10 : 0

  // The Wildcard: unpredictable, mixed value, medium-high trades
  scores[10].score += tradeVol >= 4 ? 15 : 0
  scores[10].score += Math.abs(avgVal) > 5 ? 20 : 0
  scores[10].score += isLosing ? 15 : 0
  scores[10].score += Math.abs(luckDelta) > 1.5 ? 10 : 0

  // The Closer: winning, high composite, clutch factor
  scores[11].score += isWinning ? 20 : 0
  scores[11].score += compositeScore >= 60 ? 20 : 0
  scores[11].score += luckDelta < -1 ? 15 : 0 // winning despite bad luck
  scores[11].score += managerSkill >= 60 ? 10 : 0

  // Use rosterId as tiebreaker seed for variety
  scores.forEach((s, i) => { s.score += ((rosterId * 7 + i * 13) % 5) })

  scores.sort((a, b) => b.score - a.score)
  const best = ARCHETYPE_CATALOG[scores[0].idx]

  // Compute trait overrides based on actual data
  const traitOverrides = {
    risk: Math.min(100, Math.max(5, best.traitBases.risk + (tradeVol >= 6 ? 10 : tradeVol <= 1 ? -10 : 0) + (avgVal < -3 ? 8 : avgVal > 5 ? -5 : 0))),
    patience: Math.min(100, Math.max(5, best.traitBases.patience + (tradeVol <= 2 ? 10 : tradeVol >= 8 ? -10 : 0) + (youthBias > 2 ? 8 : -3))),
    aggression: Math.min(100, Math.max(5, best.traitBases.aggression + (isWinning ? 8 : isLosing ? -5 : 0) + (tradeVol >= 6 ? 5 : -3))),
    adaptability: Math.min(100, Math.max(5, best.traitBases.adaptability + (tradeVol >= 4 ? 8 : -5) + (Math.abs(luckDelta) > 2 ? 5 : 0))),
  }

  return { ...best, traitOverrides }
}

function buildFallbackProfile(
  managerName: string,
  rosterId: number,
  record: { wins: number; losses: number; ties: number },
  tradeData: { total: number; playersGiven: number; playersReceived: number; picksGiven: number; picksReceived: number; avgValueDiff: number | null; youthCount: number; vetCount: number },
  teamData: any,
) {
  const arch = computeDeterministicArchetype(managerName, rosterId, record, tradeData, teamData)
  const rec = `${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ''}`

  return {
    archetype: arch.archetype,
    emoji: arch.emoji,
    summary: arch.summaryTemplate(managerName, rec, tradeData.total),
    traits: [
      { trait: 'Risk Tolerance', score: arch.traitOverrides.risk, description: arch.traitOverrides.risk >= 65 ? 'Embraces uncertainty and high-variance moves.' : arch.traitOverrides.risk >= 40 ? 'Balanced approach to risk — takes calculated chances.' : 'Strongly prefers safe, proven assets over upside.' },
      { trait: 'Patience', score: arch.traitOverrides.patience, description: arch.traitOverrides.patience >= 65 ? 'Willing to wait for long-term payoffs.' : arch.traitOverrides.patience >= 40 ? 'Can wait but gets antsy when the roster underperforms.' : 'Wants results now and acts quickly when things go wrong.' },
      { trait: 'Aggression', score: arch.traitOverrides.aggression, description: arch.traitOverrides.aggression >= 65 ? 'Plays to dominate — makes bold, assertive moves.' : arch.traitOverrides.aggression >= 40 ? 'Competitive but measured in approach.' : 'Passive manager who avoids confrontation in deals.' },
      { trait: 'Adaptability', score: arch.traitOverrides.adaptability, description: arch.traitOverrides.adaptability >= 65 ? 'Quickly pivots strategy when circumstances change.' : arch.traitOverrides.adaptability >= 40 ? 'Can adjust but prefers sticking to the plan.' : 'Rigid in approach — sticks to one strategy regardless.' },
    ],
    tendencies: arch.tendencies,
    blindSpot: arch.blindSpot,
    negotiationStyle: arch.negotiationStyle,
    riskProfile: arch.riskProfile,
    decisionSpeed: arch.decisionSpeed,
    fallback: true,
  }
}

export const POST = withApiUsage({ endpoint: "/api/rankings/manager-psychology", tool: "ManagerPsychology" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { leagueId, rosterId, username, teamData } = body

    if (!leagueId || rosterId == null) {
      return NextResponse.json({ error: 'leagueId and rosterId required' }, { status: 400 })
    }

    // `leagueId` is a Sleeper league id (it keys leagueTradeHistory.sleeperLeagueId below), so
    // membership resolves through the legacy import graph, not prisma.league. Without this gate any
    // caller could read another league's trade history by guessing a league id + username pair.
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    const access = await resolveLegacyLeagueAccess(leagueId, session?.user?.id)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 401 ? 'Authentication required' : 'Forbidden' },
        { status: access.status },
      )
    }
    const userId = session!.user!.id as string

    // Was `{scope:'legacy', action:'manager_psychology', ip, maxRequests:10}` with no user key and
    // no includeIpInKey, which resolves to the single key `legacy:manager_psychology:user:anonymous`
    // — one global 10/min bucket shared by every caller, so one user could lock out everyone else
    // while a distributed caller was barely slowed. Now bucketed per user AND per IP, matching the
    // other two LLM routes in this directory.
    const rl = consumeRateLimit({
      scope: 'rankings',
      action: 'manager_psychology',
      sleeperUsername: userId,
      ip: getClientIp(request),
      maxRequests: 10,
      windowMs: 60_000,
      includeIpInKey: true,
    })
    if (!rl.success) {
      return NextResponse.json(
        buildRateLimit429({ message: 'Too many requests. Please wait a moment and try again.', rl }),
        { status: 429 },
      )
    }

    const managerName = username || teamData?.displayName || teamData?.username || `Manager #${rosterId}`

    let tradeData = {
      total: 0,
      playersGiven: 0,
      playersReceived: 0,
      picksGiven: 0,
      picksReceived: 0,
      avgValueDiff: null as number | null,
      tradingStyle: null as any,
      favoriteTargets: null as any,
      positionsAcquired: {} as Record<string, number>,
      positionsTraded: {} as Record<string, number>,
      youthCount: 0,
      vetCount: 0,
    }

    if (username) {
      const tradeHistory = await prisma.leagueTradeHistory.findFirst({
        where: {
          sleeperLeagueId: leagueId,
          sleeperUsername: username,
        },
        include: {
          trades: {
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      })

      if (tradeHistory) {
        let totalValueDiff = 0
        let valuedTrades = 0
        for (const trade of tradeHistory.trades) {
          const pGiven = trade.playersGiven as any[] || []
          const pReceived = trade.playersReceived as any[] || []
          const dkGiven = trade.picksGiven as any[] || []
          const dkReceived = trade.picksReceived as any[] || []
          tradeData.playersGiven += pGiven.length
          tradeData.playersReceived += pReceived.length
          tradeData.picksGiven += dkGiven.length
          tradeData.picksReceived += dkReceived.length

          for (const p of pReceived) {
            if (p.position) tradeData.positionsAcquired[p.position] = (tradeData.positionsAcquired[p.position] || 0) + 1
            if (p.age && p.age < 25) tradeData.youthCount++
            if (p.age && p.age >= 28) tradeData.vetCount++
          }
          for (const p of pGiven) {
            if (p.position) tradeData.positionsTraded[p.position] = (tradeData.positionsTraded[p.position] || 0) + 1
          }

          if (trade.valueDifferential != null) {
            totalValueDiff += trade.valueDifferential
            valuedTrades++
          }
        }

        tradeData.total = tradeHistory.trades.length
        tradeData.avgValueDiff = valuedTrades > 0 ? totalValueDiff / valuedTrades : null
        tradeData.tradingStyle = tradeHistory.tradingStyle
        tradeData.favoriteTargets = tradeHistory.favoriteTargets
      }
    }

    const record = teamData?.record || { wins: 0, losses: 0, ties: 0 }
    const totalGames = record.wins + record.losses + record.ties
    const winPct = totalGames > 0 ? (record.wins / totalGames * 100).toFixed(1) : '0'

    const posAcqSummary = Object.entries(tradeData.positionsAcquired)
      .sort((a, b) => b[1] - a[1])
      .map(([pos, ct]) => `${pos}: ${ct}`)
      .join(', ')

    const posTrdSummary = Object.entries(tradeData.positionsTraded)
      .sort((a, b) => b[1] - a[1])
      .map(([pos, ct]) => `${pos}: ${ct}`)
      .join(', ')

    const prompt = `You are a fantasy sports psychologist. Analyze this manager's behavior and create a psychological profile. Be insightful, specific, and grounded in the data. Never invent stats.

MANAGER: ${managerName}
RECORD: ${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ''} (${winPct}% win rate)
POINTS FOR: ${teamData?.pointsFor?.toFixed(1) || 'N/A'}
POINTS AGAINST: ${teamData?.pointsAgainst?.toFixed(1) || 'N/A'}
EXPECTED WINS: ${teamData?.expectedWins?.toFixed(1) || 'N/A'}
LUCK DELTA: ${teamData?.luckDelta || 'N/A'} wins
STREAK: ${teamData?.streak > 0 ? `${teamData.streak}W streak` : teamData?.streak < 0 ? `${Math.abs(teamData.streak)}L streak` : 'No streak'}
COMPOSITE SCORE: ${teamData?.composite || 'N/A'}/100
POWER SCORE: ${teamData?.powerScore || 'N/A'}/100
MANAGER SKILL SCORE: ${teamData?.managerSkillScore || 'N/A'}/100

TRADE ACTIVITY:
- Total trades: ${tradeData.total}
- Players given: ${tradeData.playersGiven} | Players received: ${tradeData.playersReceived}
- Picks given: ${tradeData.picksGiven} | Picks received: ${tradeData.picksReceived}
- Avg value differential: ${tradeData.avgValueDiff !== null ? (tradeData.avgValueDiff > 0 ? '+' : '') + tradeData.avgValueDiff.toFixed(1) : 'N/A'}
- Positions acquired: ${posAcqSummary || 'None'}
- Positions traded away: ${posTrdSummary || 'None'}
- Youth acquisitions (under 25): ${tradeData.youthCount}
- Veteran acquisitions (28+): ${tradeData.vetCount}
${tradeData.tradingStyle ? `- Trading style: ${JSON.stringify(tradeData.tradingStyle)}` : ''}
${tradeData.favoriteTargets ? `- Favorite targets: ${JSON.stringify(tradeData.favoriteTargets)}` : ''}

TEAM PHASE: ${teamData?.phase || 'Unknown'}

Respond with JSON matching this exact structure:
{
  "archetype": "short 2-3 word archetype name — MUST be unique and data-driven. Choose from: 'The Shark', 'The Architect', 'The Gambler', 'The Fortress', 'The Sniper', 'The Tinkerer', 'The General', 'The Collector', 'The Opportunist', 'The Loyalist', 'The Wildcard', 'The Closer', or create your own based on the data. NEVER default to 'The Observer' — pick the archetype that best fits this specific manager's behavior.",
  "emoji": "single emoji that represents the archetype",
  "summary": "2-3 sentence psychological summary of this manager's approach to fantasy football",
  "traits": [
    { "trait": "trait name", "score": 0-100, "description": "one sentence about this trait" }
  ],
  "tendencies": ["tendency 1", "tendency 2", "tendency 3"],
  "blindSpot": "one sentence about a potential blind spot or weakness in their approach",
  "negotiationStyle": "one sentence about how they likely approach trade negotiations",
  "riskProfile": "LOW" | "MEDIUM" | "HIGH",
  "decisionSpeed": "IMPULSIVE" | "DELIBERATE" | "REACTIVE"
}

Include exactly 4 traits. Make traits from these categories: Risk Tolerance, Patience, Aggression, Adaptability. Scores should be 0-100.`

    const result = await openaiChatJson({
      messages: [
        { role: 'system', content: 'You are AllFantasy AI Psychology Engine. Respond with valid JSON only. No markdown, no code blocks. Be honest and data-driven.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      maxTokens: PSYCHOLOGY_MAX_TOKENS,
    })

    // openaiChatJson returns the raw completion, so the provider's usage block is available here.
    await recordLlmUsage({
      endpoint: '/api/rankings/manager-psychology',
      tool: 'ManagerPsychology',
      userId,
      model: result.model,
      usage: result.ok ? (result.json as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })?.usage : null,
      maxTokens: PSYCHOLOGY_MAX_TOKENS,
      ok: result.ok,
    })

    if (!result.ok) {
      return NextResponse.json(buildFallbackProfile(managerName, rosterId, record, tradeData, teamData))
    }

    let parsed: any
    try {
      const content = result.json?.choices?.[0]?.message?.content
      if (typeof content === 'string') {
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        parsed = JSON.parse(cleaned)
      } else {
        parsed = result.json
      }
    } catch {
      parsed = null
    }

    if (parsed?.archetype) {
      return NextResponse.json(parsed)
    }

    return NextResponse.json(buildFallbackProfile(managerName, rosterId, record, tradeData, teamData))
  } catch (err: any) {
    console.error('[Manager Psychology] Error:', err?.message || err)
    return NextResponse.json(
      { error: 'Failed to generate psychology profile' },
      { status: 500 },
    )
  }
})
