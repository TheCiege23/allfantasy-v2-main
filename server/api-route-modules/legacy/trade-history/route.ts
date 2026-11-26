import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import {
  getLeagueTransactions,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueHistory,
  resolveSleeperUser,
} from '@/lib/sleeper-client'
import { getCanonicalPlayerMapForSport } from '@/lib/canonical/getCanonicalPlayer'
import { assertSleeperBoundaryForLeagueId } from '@/lib/legacy/sleeper-boundary'
import { isUserParty } from '@/lib/user-matching'
import { legacySessionUserId } from '@/lib/legacy/legacyOneGrade'
import { gradeLegacyCompletedTrades } from '@/lib/legacy/legacyCompletedTradeGrades'
import { proseNamesAGrade } from '@/lib/legacy/legacyPackageGrade'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'

const openai = getOpenAIRouteClient()

interface TradeParty {
  rosterId: number
  userId: string
  displayName: string
  playersReceived: Array<{ id: string; name: string; position: string; team: string }>
  picksReceived: Array<{ season: string; round: number }>
  faabReceived: number
}

interface ProcessedTrade {
  transactionId: string
  timestamp: number
  week: number
  season: string
  parties: TradeParty[]
  userInvolved: boolean
  userSide: 'gave' | 'received' | null
  userRosterId?: number
}

interface TradesByYear {
  [year: string]: ProcessedTrade[]
}

interface WaiverTransaction {
  playerId: string
  playerName: string
  position: string
  team: string
  type: 'add' | 'drop'
  timestamp: number
  week: number
  season: string
}

interface WaiverActivity {
  adds: WaiverTransaction[]
  drops: WaiverTransaction[]
  totalAdds: number
  totalDrops: number
}

interface WaiverMVPEvent {
  type: 'add' | 'drop'
  teamName: string
  timestamp: number
  date: string
}

interface WaiverMVP {
  playerId: string
  playerName: string
  position: string
  team: string
  timesAdded: number
  timesDropped: number
  totalMoves: number
  journey: WaiverMVPEvent[]
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-history", tool: "LegacyTradeHistory" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const { leagueId, userId, action, trade } = body
    const normalizedLeagueId = String(leagueId || '').trim()

    if (!normalizedLeagueId || !userId) {
      return NextResponse.json({ error: 'Missing leagueId or userId' }, { status: 400 })
    }

    const boundary = await assertSleeperBoundaryForLeagueId(normalizedLeagueId)
    if (!boundary.ok) {
      return NextResponse.json({ error: boundary.message }, { status: boundary.status })
    }

    if (action === 'fetch') {
      const { tradesByYear, totalCount, managers, allSeasons, waiverActivity, waiverMVP } = await fetchAllLeagueTrades(normalizedLeagueId, userId)
      return NextResponse.json({ tradesByYear, total: totalCount, managers, allSeasons, waiverActivity, waiverMVP })
    }

    if (action === 'grade' && trade) {
      const gradedTrade = await gradeTrade(normalizedLeagueId, String(userId), trade)
      return NextResponse.json({ gradedTrade })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('Trade history error:', error)
    return NextResponse.json({ error: error.message || 'Failed to process' }, { status: 500 })
  }
})

async function fetchAllLeagueTrades(leagueId: string, userId: string): Promise<{ 
  tradesByYear: TradesByYear; 
  totalCount: number; 
  managers: Record<string, string>;
  allSeasons: string[];
  waiverActivity: WaiverActivity;
  waiverMVP: WaiverMVP | null;
}> {
  // First, resolve the username to a consistent Sleeper user_id
  // This ensures we match the user correctly across all seasons
  const resolvedUser = await resolveSleeperUser(userId)
  const sleeperUserId = resolvedUser?.userId || userId
  
  console.log(`[TRADE-HISTORY] Resolved user "${userId}" to Sleeper user_id: ${sleeperUserId}`)
  
  // Pass userId to getLeagueHistory to enable searching for leagues by name across seasons
  const leagueHistory = await getLeagueHistory(leagueId, userId)
  // Phase 3 batch 2 — canonical read path. Historical trade/waiver log: it renders what already
  // happened, so cache-only is correct here; nothing downstream acts on live roster state.
  // Reshaped to the `Record<sleeperId, {...}>` the helper below already expects, so the
  // surrounding logic is untouched.
  const canonicalPlayers = await getCanonicalPlayerMapForSport('NFL')
  const allPlayers: Record<string, { full_name: string; position: string; team: string | null }> =
    Object.fromEntries(
      [...canonicalPlayers].map(([sleeperId, p]) => [
        sleeperId,
        { full_name: p.name, position: p.position, team: p.team },
      ]),
    )
  
  console.log('[TRADE-HISTORY] League history found:', leagueHistory.map(l => ({ id: l.league_id, name: l.name, season: l.season, prev: l.previous_league_id })))
  
  const tradesByYear: TradesByYear = {}
  let totalCount = 0
  const managers: Record<string, string> = {}
  const allSeasons: string[] = []
  const allWaiverAdds: WaiverTransaction[] = []
  const allWaiverDrops: WaiverTransaction[] = []
  
  // Track league-wide waiver activity for MVP calculation
  const leagueWaiverMoves: Map<string, { 
    playerName: string; 
    position: string; 
    team: string;
    events: WaiverMVPEvent[] 
  }> = new Map()
  
  for (const league of leagueHistory) {
    const season = league.season
    allSeasons.push(season)
    console.log(`[TRADE-HISTORY] Fetching trades for season ${season} (league ${league.league_id})...`)
    // Pass the resolved Sleeper user_id for consistent matching
    const { trades: seasonTrades, managerMap, waiverAdds, waiverDrops, leagueMoves } = await fetchSeasonTrades(league.league_id, sleeperUserId, season, allPlayers)
    
    console.log(`[TRADE-HISTORY] Season ${season}: Found ${seasonTrades.length} trades (user trades: ${seasonTrades.filter(t => t.userInvolved).length}), ${waiverAdds.length} adds, ${waiverDrops.length} drops`)
    
    // Merge manager maps
    Object.assign(managers, managerMap)
    
    // Always include the season (even if empty) so UI knows it exists
    tradesByYear[season] = seasonTrades
    totalCount += seasonTrades.length
    
    // Collect waiver activity
    allWaiverAdds.push(...waiverAdds)
    allWaiverDrops.push(...waiverDrops)
    
    // Merge league-wide moves for MVP calculation
    for (const [playerId, moveData] of leagueMoves.entries()) {
      const existing = leagueWaiverMoves.get(playerId)
      if (existing) {
        existing.events.push(...moveData.events)
      } else {
        leagueWaiverMoves.set(playerId, { ...moveData })
      }
    }
  }
  
  const waiverActivity: WaiverActivity = {
    adds: allWaiverAdds.sort((a, b) => b.timestamp - a.timestamp),
    drops: allWaiverDrops.sort((a, b) => b.timestamp - a.timestamp),
    totalAdds: allWaiverAdds.length,
    totalDrops: allWaiverDrops.length
  }
  
  // Find the waiver MVP (most added player)
  let waiverMVP: WaiverMVP | null = null
  let maxAdds = 0
  
  for (const [playerId, data] of leagueWaiverMoves.entries()) {
    const adds = data.events.filter(e => e.type === 'add').length
    if (adds > maxAdds) {
      maxAdds = adds
      const drops = data.events.filter(e => e.type === 'drop').length
      waiverMVP = {
        playerId,
        playerName: data.playerName,
        position: data.position,
        team: data.team,
        timesAdded: adds,
        timesDropped: drops,
        totalMoves: data.events.length,
        journey: data.events.sort((a, b) => a.timestamp - b.timestamp)
      }
    }
  }
  
  return { tradesByYear, totalCount, managers, allSeasons, waiverActivity, waiverMVP }
}

async function fetchSeasonTrades(
  leagueId: string, 
  userId: string, 
  season: string,
  allPlayers: Record<string, any>
): Promise<{ 
  trades: ProcessedTrade[]; 
  managerMap: Record<string, string>; 
  waiverAdds: WaiverTransaction[]; 
  waiverDrops: WaiverTransaction[];
  leagueMoves: Map<string, { playerName: string; position: string; team: string; events: WaiverMVPEvent[] }>;
}> {
  const [rosters, users] = await Promise.all([
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
  ])

  const rosterToUser = new Map<number, string>()
  const userIdToName = new Map<string, string>()
  const rosterIdToName = new Map<number, string>()
  const managerMap: Record<string, string> = {}
  
  rosters.forEach(r => rosterToUser.set(r.roster_id, r.owner_id))
  users.forEach(u => {
    userIdToName.set(u.user_id, u.display_name || u.user_id)
    // Build manager map: userId -> displayName
    managerMap[u.user_id] = u.display_name || u.user_id
  })

  // Build rosterId to team name map
  rosters.forEach(r => {
    const ownerId = r.owner_id
    const ownerName = userIdToName.get(ownerId) || `Team ${r.roster_id}`
    rosterIdToName.set(r.roster_id, ownerName)
  })

  // userId should now be a resolved Sleeper user_id (numeric string)
  // But we also support matching by display_name/username as fallback
  // First try direct roster match by owner_id (most reliable for historical seasons)
  let userRosterId = rosters.find(r => r.owner_id === userId)?.roster_id
  
  // Check co_owners if no direct match
  if (!userRosterId) {
    userRosterId = rosters.find(r => (r as any).co_owners?.includes(userId))?.roster_id
  }
  
  // If no direct match, try matching through users list
  if (!userRosterId) {
    const matchedUser = users.find(u => 
      u.user_id === userId || 
      u.display_name?.toLowerCase() === userId.toLowerCase() ||
      (u as any).username?.toLowerCase() === userId.toLowerCase()
    )
    if (matchedUser) {
      userRosterId = rosters.find(r => 
        r.owner_id === matchedUser.user_id || 
        (r as any).co_owners?.includes(matchedUser.user_id)
      )?.roster_id
    }
  }
    
  console.log(`[TRADE-HISTORY] Season ${season}: Looking for user "${userId}" in ${rosters.length} rosters. Found rosterId: ${userRosterId || 'NONE'}`)

  const allTrades: ProcessedTrade[] = []
  const waiverAdds: WaiverTransaction[] = []
  const waiverDrops: WaiverTransaction[] = []
  const leagueMoves: Map<string, { playerName: string; position: string; team: string; events: WaiverMVPEvent[] }> = new Map()

  // Include all possible weeks for transactions:
  // Week 0: Offseason/preseason trades
  // Weeks 1-18: Regular season
  // Weeks 19+: Playoff and late-season
  for (let week = 0; week <= 21; week++) {
    const transactions = await getLeagueTransactions(leagueId, week)
    const trades = transactions.filter(t => t.type === 'trade' && t.status === 'complete')
    
    // Process ALL waiver/free agent transactions for league-wide MVP tracking
    const allWaiverTxns = transactions.filter(t => 
      (t.type === 'waiver' || t.type === 'free_agent') && 
      t.status === 'complete'
    )
    
    for (const txn of allWaiverTxns) {
      const timestamp = txn.created || txn.status_updated || Date.now()
      const dateStr = new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      
      // Process adds (league-wide tracking + user-specific)
      if (txn.adds) {
        for (const [playerId, toRosterId] of Object.entries(txn.adds)) {
          const player = allPlayers[playerId]
          const playerName = player?.full_name || `${player?.first_name || ''} ${player?.last_name || ''}`.trim() || playerId
          const position = player?.position || 'Unknown'
          const team = player?.team || 'FA'
          const teamName = rosterIdToName.get(toRosterId as number) || `Team ${toRosterId}`
          
          // Track for league-wide MVP
          if (!leagueMoves.has(playerId)) {
            leagueMoves.set(playerId, { playerName, position, team, events: [] })
          }
          leagueMoves.get(playerId)!.events.push({
            type: 'add',
            teamName,
            timestamp,
            date: dateStr
          })
          
          // Track user-specific adds
          if (toRosterId === userRosterId) {
            waiverAdds.push({
              playerId,
              playerName,
              position,
              team,
              type: 'add',
              timestamp,
              week,
              season
            })
          }
        }
      }
      
      // Process drops (league-wide tracking + user-specific)
      if (txn.drops) {
        for (const [playerId, fromRosterId] of Object.entries(txn.drops)) {
          const player = allPlayers[playerId]
          const playerName = player?.full_name || `${player?.first_name || ''} ${player?.last_name || ''}`.trim() || playerId
          const position = player?.position || 'Unknown'
          const team = player?.team || 'FA'
          const teamName = rosterIdToName.get(fromRosterId as number) || `Team ${fromRosterId}`
          
          // Track for league-wide MVP
          if (!leagueMoves.has(playerId)) {
            leagueMoves.set(playerId, { playerName, position, team, events: [] })
          }
          leagueMoves.get(playerId)!.events.push({
            type: 'drop',
            teamName,
            timestamp,
            date: dateStr
          })
          
          // Track user-specific drops
          if (fromRosterId === userRosterId) {
            waiverDrops.push({
              playerId,
              playerName,
              position,
              team,
              type: 'drop',
              timestamp,
              week,
              season
            })
          }
        }
      }
    }

    for (const trade of trades) {
      const parties: TradeParty[] = []

      for (const rosterId of trade.roster_ids) {
        const ownerId = rosterToUser.get(rosterId) || ''
        const displayName = userIdToName.get(ownerId) || `Team ${rosterId}`

        const playersReceived: TradeParty['playersReceived'] = []
        const picksReceived: TradeParty['picksReceived'] = []
        let faabReceived = 0

        if (trade.adds) {
          for (const [playerId, toRosterId] of Object.entries(trade.adds)) {
            if (toRosterId === rosterId) {
              const player = allPlayers[playerId]
              playersReceived.push({
                id: playerId,
                name: player?.full_name || `${player?.first_name || ''} ${player?.last_name || ''}`.trim() || playerId,
                position: player?.position || 'Unknown',
                team: player?.team || 'FA',
              })
            }
          }
        }

        if (trade.draft_picks) {
          for (const pick of trade.draft_picks) {
            if (pick.owner_id === rosterId) {
              picksReceived.push({ season: pick.season, round: pick.round })
            }
          }
        }

        if (trade.waiver_budget) {
          for (const budget of trade.waiver_budget) {
            if (budget.receiver === rosterId) {
              faabReceived += budget.amount
            }
          }
        }

        parties.push({
          rosterId,
          userId: ownerId,
          displayName,
          playersReceived,
          picksReceived,
          faabReceived,
        })
      }

      const userInvolved = userRosterId ? trade.roster_ids.includes(userRosterId) : false
      const userParty = parties.find(p => p.rosterId === userRosterId)

      allTrades.push({
        transactionId: trade.transaction_id,
        timestamp: trade.created,
        week,
        season,
        parties,
        userInvolved,
        userSide: userParty ? (userParty.playersReceived.length > 0 || userParty.picksReceived.length > 0 ? 'received' : 'gave') : null,
        userRosterId: userRosterId,
      })
    }
  }

  return { trades: allTrades.sort((a, b) => b.timestamp - a.timestamp), managerMap, waiverAdds, waiverDrops, leagueMoves }
}

/*
 * 🛑 `action: 'grade'` GRADES THROUGH THE ONE COMPLETED-TRADE GRADE (2026-11-26).
 *
 * Until then each past trade on the AF Legacy report card was priced by `lib/hybrid-valuation.ts`
 * (`pricePlayer` / `pricePick`, Excel → FantasyCalc → curve), the winner was whichever side's total
 * was 5% higher, and the letter was a FAIRNESS letter on its own 11-step scale (A = "balanced",
 * D = "lopsided") — so a trade you won badly and a trade you lost badly were both a D, while the page
 * counted every A as a big win. An LLM then wrote the verdict from those numbers.
 *
 * Now the trade goes to `oneGradeForCompletedTrade` (through `gradeLegacyCompletedTrades`, exactly as
 * `/api/legacy/trade-analytics` does) on the signed-in user's verified AF league row, from the
 * VIEWER's side:
 *   - `grade` is the trade's frozen ORIGINAL letter ("at the time"); `currentGrade` is today's re-grade;
 *   - `result` is the grade's own reading of that letter (B or better win, D or worse loss, C even),
 *     and `winner` names the side it favours;
 *   - `valueDifferential` is the league value the letter was taken on (received − sent, your side).
 * A withheld grade returns `graded: false`, `grade: null` and the grader's reason as `gradeWithheld`,
 * and no LLM call is made. When graded, an LLM may still write the two lines of prose, but it is handed
 * the canonical grade as the verdict, and prose that names any letter grade is discarded in favour of
 * the grade's own label and recommendation.
 */

type Outcome = 'win' | 'loss' | 'even'

/** The grade's own reading of a letter: B or better wins, D or worse loses. */
export function outcomeOfLetter(letter: GradeLetter): Outcome {
  return letter === 'A' || letter === 'B' ? 'win' : letter === 'D' || letter === 'F' ? 'loss' : 'even'
}

/** The viewer's party: the roster the fetch matched for this user, else a name/id match. */
export function viewerMatcher(trade: ProcessedTrade, requestedUser: string) {
  const byRoster = trade.userRosterId != null && (trade.parties ?? []).some((p) => p.rosterId === trade.userRosterId)
  return (p: { rosterId?: number; userId?: string; displayName?: string; teamName?: string }) =>
    byRoster ? p.rosterId === trade.userRosterId : isUserParty(p, requestedUser, requestedUser)
}

async function gradeTrade(leagueId: string, requestedUser: string, trade: ProcessedTrade) {
  const isViewer = viewerMatcher(trade, requestedUser)
  const [view] = await gradeLegacyCompletedTrades({
    suppliedLeagueId: leagueId,
    userId: await legacySessionUserId(),
    trades: [trade],
    isViewer,
  })
  return describeGradedTrade(trade, view!, isViewer)
}

/** A trade card's grade fields, read off one canonical view. Nothing is recomputed. */
export async function describeGradedTrade(
  trade: ProcessedTrade,
  view: TradeGradeView,
  isViewer: (p: TradeParty) => boolean,
  writeNarrative: (a: NarrativeArgs) => Promise<{ brief: string; full: string } | null> = narrativeFor,
) {
  const me = trade.parties?.find(isViewer)
  const them = trade.parties?.find((p) => p !== me)

  if (!view.graded) {
    return {
      ...trade,
      gradeSource: 'one_trade_engine' as const,
      graded: false as const,
      grade: null,
      partnerGrade: null,
      currentGrade: null,
      result: null,
      winner: null,
      valueDifferential: null,
      currentValueDifferential: null,
      gradeWithheld: view.reason,
      briefExplanation: 'Not graded',
      fullAnalysis: view.reason,
    }
  }

  const result = outcomeOfLetter(view.letter)
  const myName = me?.displayName || 'You'
  const theirName = them?.displayName || 'Your trade partner'
  const net = Math.round(view.getValue - view.giveValue)
  const current = view.current ?? null
  const narrative = await writeNarrative({ view, me, them, myName, theirName }).catch(() => null)

  return {
    ...trade,
    gradeSource: 'one_trade_engine' as const,
    graded: true as const,
    grade: view.letter,
    partnerGrade: view.partnerLetter,
    currentGrade: current?.letter ?? view.letter,
    result,
    winner: result === 'win' ? myName : result === 'loss' ? theirName : 'Even',
    valueDifferential: net,
    currentValueDifferential: current ? Math.round(current.getValue - current.giveValue) : net,
    gradeWithheld: null,
    briefExplanation: narrative?.brief || view.label,
    fullAnalysis: narrative?.full || view.recommendation,
  }
}

export type NarrativeArgs = {
  view: Extract<TradeGradeView, { graded: true }>
  me: TradeParty | undefined
  them: TradeParty | undefined
  myName: string
  theirName: string
}

const assetList = (p: TradeParty | undefined) =>
  [
    ...(p?.playersReceived ?? []).map((pl) => `${pl.name} (${pl.position})`),
    ...(p?.picksReceived ?? []).map((pk) => `${pk.season} Round ${pk.round}`),
  ].join(', ') || 'Nothing'

/** The prompt: the canonical verdict is stated as final; the model only explains it. */
export function narrativePrompt(a: NarrativeArgs): string {
  const { view } = a
  return `Write two short lines of prose about a completed fantasy trade. The verdict below is FINAL and comes from our trade grader. Do not give, suggest or imply any other verdict, score or winner, and do not write any letter grade.
${a.myName} received: ${assetList(a.me)}
${a.theirName} received: ${assetList(a.them)}
Verdict for ${a.myName}: ${view.label}. League value received ${Math.round(view.getValue)}, sent ${Math.round(view.giveValue)} (${view.basis}).
${view.recommendation}

Provide:
1. A 10-word brief explanation of that verdict
2. A 2-3 sentence full analysis consistent with that verdict

Format as JSON: { "brief": "...", "full": "..." }`
}

/**
 * Two lines of prose ABOUT the canonical grade, or null. Prose that writes a letter grade of its own
 * is dropped, so the caller falls back to the grade's own label and recommendation.
 */
async function narrativeFor(a: NarrativeArgs): Promise<{ brief: string; full: string } | null> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: narrativePrompt(a) }],
    max_tokens: 200,
    temperature: 0.5,
  })
  const content = response.choices[0]?.message?.content || '{}'
  const parsed = JSON.parse(content.replace(/```json?|```/g, '').trim()) as { brief?: unknown; full?: unknown }
  const brief = typeof parsed.brief === 'string' ? parsed.brief.trim() : ''
  const full = typeof parsed.full === 'string' ? parsed.full.trim() : ''
  if (!brief || !full) return null
  if (proseNamesAGrade(`${brief}\n${full}`)) return null
  return { brief, full }
}
