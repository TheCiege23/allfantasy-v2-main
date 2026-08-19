import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import {
  getDraftPicks,
  getLeagueDrafts,
  getLeagueInfo,
  getLeagueMatchups,
  getLeagueRosters,
  getLeagueTransactions,
  getLeagueUsers,
  type SleeperTransaction,
} from '@/lib/sleeper-client'
import { computeRivalryWeek, type RivalryWeekData } from '@/lib/rivalry-engine'

const openai = getOpenAIRouteClient()

interface SleeperLeague {
  league_id: string
  name: string
  sport: string
  season: string
  season_type: string
  total_rosters: number
  status: string
  settings: {
    type?: number
    playoff_teams?: number
    num_teams?: number
  }
  scoring_settings?: Record<string, number>
  roster_positions?: string[]
  avatar?: string
  previous_league_id?: string
}

interface SleeperUser {
  user_id: string
  username: string
  display_name: string
  avatar?: string
}

interface SleeperRoster {
  roster_id: number
  owner_id: string
  players?: string[]
  starters?: string[]
  reserve?: string[]
  taxi?: string[]
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
  }
}

interface SleeperMatchup {
  roster_id: number
  matchup_id: number
  points: number
}

interface SleeperDraftPick {
  round: number
  roster_id: number
  player_id: string
  picked_by: string
  pick_no: number
  metadata?: {
    first_name?: string
    last_name?: string
    position?: string
    team?: string
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/transfer", tool: "LegacyTransfer" })(async (req: NextRequest) => {
  try {
    const { leagueId } = await req.json()
    
    if (!leagueId || typeof leagueId !== 'string') {
      return NextResponse.json({ error: 'League ID is required' }, { status: 400 })
    }

    const cleanId = leagueId.trim()
    
    const league: SleeperLeague | null = await getLeagueInfo(cleanId) as SleeperLeague | null
    if (!league) {
      return NextResponse.json({ error: 'League not found. Please check your League ID.' }, { status: 404 })
    }

    const [users, rosters, drafts] = await Promise.all([
      getLeagueUsers(cleanId) as Promise<SleeperUser[]>,
      getLeagueRosters(cleanId) as Promise<SleeperRoster[]>,
      getLeagueDrafts(cleanId),
    ])

    const rosterToUser: Record<number, SleeperUser> = {}
    if (rosters && users) {
      rosters.forEach(roster => {
        const user = users.find(u => u.user_id === roster.owner_id)
        if (user) rosterToUser[roster.roster_id] = user
      })
    }

    let transactions: SleeperTransaction[] = []
    try {
      const currentWeek = 18
      for (let week = 1; week <= currentWeek; week++) {
        const weekTx = await getLeagueTransactions(cleanId, week) as unknown as SleeperTransaction[]
        if (weekTx.length > 0) transactions = transactions.concat(weekTx)
      }
    } catch {}

    const trades = transactions.filter(t => t.type === 'trade' && t.status === 'complete')

    let draftPicks: SleeperDraftPick[] = []
    let draftSlotMap: Record<number, number> = {}
    let draftInfo: { type?: string; status?: string; startTime?: number } = {}
    if (drafts && drafts.length > 0) {
      const latestDraft = drafts[0]
      draftPicks = await getDraftPicks(latestDraft.draft_id) as SleeperDraftPick[]
      draftInfo = {
        type: latestDraft.type,
        status: latestDraft.status,
        startTime: latestDraft.start_time,
      }
      const slotToRoster: Record<string, number> = latestDraft.slot_to_roster_id || {}
      for (const [slot, rosterId] of Object.entries(slotToRoster)) {
        draftSlotMap[rosterId] = parseInt(slot)
      }
    }

    let allMatchups: { week: number; matchups: SleeperMatchup[] }[] = []
    for (let week = 1; week <= 18; week++) {
      const weekMatchups = await getLeagueMatchups(cleanId, week) as SleeperMatchup[]
      if (weekMatchups && weekMatchups.length > 0) {
        allMatchups.push({ week, matchups: weekMatchups })
      }
    }

    let previousSeasons: { season: string; league: SleeperLeague }[] = []
    let prevId = league.previous_league_id
    while (prevId) {
      const prevLeague = await getLeagueInfo(prevId) as SleeperLeague | null
      if (prevLeague) {
        previousSeasons.push({ season: prevLeague.season, league: prevLeague })
        prevId = prevLeague.previous_league_id
      } else {
        break
      }
      if (previousSeasons.length >= 10) break
    }

    const playerMap: Record<string, { name: string; position: string; team: string }> = {}

    const allRosteredIds = new Set<string>()
    rosters?.forEach(r => {
      r.players?.forEach(pid => allRosteredIds.add(pid))
      r.starters?.forEach(pid => { if (pid && pid !== '0') allRosteredIds.add(pid) })
    })

    try {
      // Phase 3: canonical read path. Was a live fetch of Sleeper's whole NFL universe to
      // resolve the rostered ids; now a fixed 3 queries for exactly those ids. The
      // draft-pick fallback below is unchanged and still covers ids with no canonical row.
      const { getCanonicalPlayersBySleeperIds } = await import('@/lib/canonical/getCanonicalPlayer')
      const canonical = await getCanonicalPlayersBySleeperIds([...allRosteredIds])
      allRosteredIds.forEach(pid => {
        const cp = canonical.get(pid)
        if (cp) {
          playerMap[pid] = {
            name: cp.name,
            position: cp.position || '',
            team: cp.team || '',
          }
        }
      })
    } catch {
      if (draftPicks && draftPicks.length > 0) {
        draftPicks.forEach(p => {
          if (p.player_id && p.metadata) {
            playerMap[p.player_id] = {
              name: `${p.metadata.first_name || ''} ${p.metadata.last_name || ''}`.trim(),
              position: p.metadata.position || '',
              team: p.metadata.team || '',
            }
          }
        })
      }
    }

    const managers = rosters?.map(roster => {
      const user = rosterToUser[roster.roster_id]
      return {
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        username: user?.username || 'Unknown',
        displayName: user?.display_name || user?.username || 'Unknown',
        avatar: user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
        wins: roster.settings?.wins || 0,
        losses: roster.settings?.losses || 0,
        ties: roster.settings?.ties || 0,
        pointsFor: ((roster.settings?.fpts || 0) + (roster.settings?.fpts_decimal || 0) / 100).toFixed(2),
        rosterSize: roster.players?.length || 0,
        starters: roster.starters || [],
        players: roster.players || [],
        reserve: roster.reserve || [],
        taxi: roster.taxi || [],
        draftSlot: draftSlotMap[roster.roster_id] || null,
      }
    }) || []

    const fetchedAt = Date.now()

    const leagueType = league.settings?.type === 2 ? 'Dynasty' : league.settings?.type === 1 ? 'Keeper' : 'Redraft'
    const ppr = league.scoring_settings?.rec || 0
    const superflex = league.roster_positions?.filter(p => p === 'SUPER_FLEX').length || 0
    const tep = league.scoring_settings?.bonus_rec_te || 0

    const hasUsers = Array.isArray(users) && users.length > 0
    const hasRosters = Array.isArray(rosters) && rosters.length > 0
    const hasMatchups = allMatchups.length > 0
    const hasTrades = trades.length > 0
    const hasDraftPicks = draftPicks.length > 0
    const hasPlayerMap = Object.keys(playerMap).length > 0
    const hasHistory = previousSeasons.length > 0
    const rostersWithPlayers = rosters?.filter(r => (r.players?.length || 0) > 0).length || 0
    const rosterCoverage = hasRosters ? Math.round((rostersWithPlayers / rosters!.length) * 100) : 0
    const matchupWeeksCovered = allMatchups.length
    const sourcesAvailable = [hasUsers, hasRosters, hasMatchups, hasTrades, hasDraftPicks, hasPlayerMap].filter(Boolean).length
    const sourcesTotal = 6
    const completenessScore = Math.round(
      (sourcesAvailable / sourcesTotal) * 50 +
      (rosterCoverage / 100) * 25 +
      (Math.min(matchupWeeksCovered, 17) / 17) * 25
    )
    const confidencePenalty =
      (!hasRosters ? 30 : rosterCoverage < 50 ? 15 : 0) +
      (!hasMatchups ? 20 : matchupWeeksCovered < 5 ? 10 : 0) +
      (!hasUsers ? 10 : 0) +
      (!hasPlayerMap ? 10 : 0)

    const dataQuality = {
      fetchedAt,
      sources: {
        users: hasUsers,
        rosters: hasRosters,
        matchups: hasMatchups,
        trades: hasTrades,
        draftPicks: hasDraftPicks,
        playerMap: hasPlayerMap,
        history: hasHistory,
      },
      rosterCoverage,
      matchupWeeksCovered,
      completenessScore: Math.max(0, Math.min(100, completenessScore)),
      confidencePenalty: Math.min(confidencePenalty, 50),
      tier: completenessScore >= 80 ? 'FULL' as const : completenessScore >= 50 ? 'PARTIAL' as const : 'MINIMAL' as const,
      signals: [
        ...(rosterCoverage < 100 ? [`${100 - rosterCoverage}% of rosters missing player data`] : []),
        ...(!hasTrades ? ['No trade history available'] : []),
        ...(!hasDraftPicks ? ['No draft data available'] : []),
        ...(matchupWeeksCovered < 5 ? [`Only ${matchupWeeksCovered} weeks of matchup data`] : []),
        ...(!hasHistory ? ['No previous season history'] : []),
        ...(!hasPlayerMap ? ['Player name resolution unavailable'] : []),
      ],
    }

    interface StorylineV2 {
      title: string
      description: string
      type: string
      confidence: number
      evidence: { type: string; label: string; detail: string }[]
      nextTrigger: string
    }

    const sortedByWins = [...managers].sort((a, b) => b.wins - a.wins || parseFloat(b.pointsFor || '0') - parseFloat(a.pointsFor || '0'))
    const sortedByPts = [...managers].sort((a, b) => parseFloat(b.pointsFor || '0') - parseFloat(a.pointsFor || '0'))

    const topManager = sortedByWins[0] || { displayName: 'Unknown', wins: 0, losses: 0, pointsFor: '0' }
    const bottomManager = sortedByWins[sortedByWins.length - 1] || topManager
    const closePairs: string[] = []
    for (let i = 0; i < sortedByWins.length - 1; i++) {
      if (Math.abs(sortedByWins[i].wins - sortedByWins[i + 1].wins) <= 1) {
        closePairs.push(`${sortedByWins[i].displayName} (${sortedByWins[i].wins}W) vs ${sortedByWins[i + 1].displayName} (${sortedByWins[i + 1].wins}W)`)
      }
    }

    const tradeLeaders: Record<number, number> = {}
    trades.forEach(t => (t.roster_ids || []).forEach(rid => { tradeLeaders[rid] = (tradeLeaders[rid] || 0) + 1 }))
    const topTrader = Object.entries(tradeLeaders).sort((a, b) => b[1] - a[1])[0]
    const topTraderManager = topTrader ? managers.find(m => m.rosterId === Number(topTrader[0])) : null

    const highScorer = sortedByPts[0] || topManager
    const lowScorer = sortedByPts[sortedByPts.length - 1] || bottomManager

    const evidenceContext = `DETERMINISTIC EVIDENCE (use these facts, do not invent stats):
- League leader: ${topManager?.displayName} at ${topManager?.wins}-${topManager?.losses} (${topManager?.pointsFor} pts)
- Last place: ${bottomManager?.displayName} at ${bottomManager?.wins}-${bottomManager?.losses} (${bottomManager?.pointsFor} pts)
- Close races: ${closePairs.length > 0 ? closePairs.join('; ') : 'None within 1 win'}
- Top scorer: ${highScorer?.displayName} (${highScorer?.pointsFor} pts)
- Lowest scorer: ${lowScorer?.displayName} (${lowScorer?.pointsFor} pts)
- Most active trader: ${topTraderManager ? `${topTraderManager.displayName} (${topTrader![1]} trades)` : 'No trades'}
- Total trades: ${trades.length}
- Seasons of history: ${previousSeasons.length + 1}
- Win-loss spread: ${topManager?.wins - (bottomManager?.wins || 0)} games between 1st and last`

    let storylines: StorylineV2[] = []
    try {
      const storylinePrompt = `You are a fantasy sports analyst creating data-backed storylines for an upcoming 2025 fantasy football season.

CRITICAL GROUNDING RULES:
- You may ONLY reference managers, records, point totals, and trades that appear in the data below.
- Do NOT invent any stats, scores, player names, or events not present in this payload.
- Every number you cite must come from the evidence section below.
- If the data is thin, say so honestly — lower the confidence score rather than fabricating details.

League: "${league.name}"
Type: ${leagueType}
Teams: ${managers.length}

Managers and their records:
${managers.map(m => `- ${m.displayName}: ${m.wins}-${m.losses}${m.ties ? `-${m.ties}` : ''} (${m.pointsFor} pts, roster: ${m.rosterSize} players)`).join('\n')}

${evidenceContext}

Data quality note: ${dataQuality.completenessScore}% completeness. ${dataQuality.signals.length > 0 ? `Gaps: ${dataQuality.signals.join('; ')}` : 'All data sources available.'}

Generate 3-5 compelling storylines. Each MUST be grounded in the evidence above—reference specific records, point totals, and manager names.

For each storyline, return:
- title: short catchy headline (4-8 words)
- description: 2-3 sentences referencing real data from above. Do not invent statistics.
- type: one of: rivalry, redemption, contender, underdog, dynasty, trade_war, sleeper
- confidence: 0-100, how strongly the data supports this narrative. Use 80-95 for storylines with strong numerical evidence. Use 50-70 for projected/speculative arcs. Use 30-49 for purely hypothetical narratives. If data quality is below 70%, cap max confidence at 75.
- evidence: array of {type, label, detail} where type is one of "record", "trade", "manager", "matchup", "trend" — label is a short tag, detail is the specific data point from the payload above
- nextTrigger: one sentence describing what event/result would update this storyline (e.g. "If X loses 2 more games..." or "Next trade involving Y")

Return JSON: {"storylines": [...]}

Example:
{"storylines": [{"title": "The Points Machine", "description": "Despite sitting at 5-4, Jordan leads the league with 1,247 points—32 more than the next closest manager.", "type": "contender", "confidence": 88, "evidence": [{"type": "record", "label": "5-4 Record", "detail": "Jordan: 1247.32 pts, 2nd most wins but highest scorer"}, {"type": "trend", "label": "Scoring Trend", "detail": "32 pts above next closest"}], "nextTrigger": "If Jordan wins 2 of next 3, playoff lock becomes near-certain"}]}`

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: storylinePrompt }],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
      })

      const content = completion.choices[0]?.message?.content
      if (content) {
        const parsed = JSON.parse(content)
        const raw: any[] = parsed.storylines || parsed.stories || (Array.isArray(parsed) ? parsed : [])
        storylines = raw.map(s => ({
          title: String(s.title || ''),
          description: String(s.description || ''),
          type: String(s.type || 'sleeper'),
          confidence: typeof s.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(s.confidence) - dataQuality.confidencePenalty)) : Math.max(10, 50 - dataQuality.confidencePenalty),
          evidence: Array.isArray(s.evidence) ? s.evidence.map((e: any) => ({
            type: String(e?.type || 'trend'),
            label: String(e?.label || ''),
            detail: String(e?.detail || ''),
          })).filter((e: any) => e.label && e.detail) : [],
          nextTrigger: typeof s.nextTrigger === 'string' ? s.nextTrigger : '',
        }))
      }
    } catch (err) {
      console.error('Storyline generation error:', err)
      storylines = [
        {
          title: 'The Championship Chase',
          description: `${topManager?.displayName} leads at ${topManager?.wins}-${topManager?.losses} with ${topManager?.pointsFor} pts. With ${previousSeasons.length + 1} seasons of history, ${league.name} enters 2025 with unfinished business.`,
          type: 'contender',
          confidence: 75,
          evidence: [
            { type: 'record', label: `${topManager?.wins}-${topManager?.losses}`, detail: `${topManager?.displayName} leads standings` },
            { type: 'trend', label: `${previousSeasons.length + 1} Seasons`, detail: 'Established league history' },
          ],
          nextTrigger: `If ${topManager?.displayName} loses 2 straight, the race reopens`,
        },
        {
          title: 'Trade Season Heats Up',
          description: `${trades.length} trades this season${topTraderManager ? `, led by ${topTraderManager.displayName} with ${topTrader![1]} deals` : ''}. Who will make the move that defines the 2025 campaign?`,
          type: 'trade_war',
          confidence: trades.length > 5 ? 80 : 55,
          evidence: [
            { type: 'trade', label: `${trades.length} Trades`, detail: 'Total completed trades this season' },
            ...(topTraderManager ? [{ type: 'manager' as const, label: 'Most Active', detail: `${topTraderManager.displayName}: ${topTrader![1]} trades` }] : []),
          ],
          nextTrigger: 'Next completed trade updates activity leaderboard',
        },
        {
          title: 'Underdog Watch',
          description: `${bottomManager?.displayName} sits at ${bottomManager?.wins}-${bottomManager?.losses} with ${bottomManager?.pointsFor} pts. Every season has a comeback story—could this be the year?`,
          type: 'underdog',
          confidence: 40,
          evidence: [
            { type: 'record', label: `${bottomManager?.wins}-${bottomManager?.losses}`, detail: `${bottomManager?.displayName} in last place` },
          ],
          nextTrigger: `If ${bottomManager?.displayName} wins 3 of next 4, the storyline becomes redemption`,
        },
      ]
    }

    const rivalryWeek = computeRivalryWeek(allMatchups, trades, managers)

    let rivalryNarratives: { rivalryOfTheWeek?: string; revengeGame?: string; tradeTension?: string } = {}
    try {
      const rivalryParts: string[] = []
      if (rivalryWeek.rivalryOfTheWeek) {
        const r = rivalryWeek.rivalryOfTheWeek
        rivalryParts.push(`RIVALRY OF THE WEEK: ${r.team1.displayName} (${r.team1.wins}-${r.team1.losses}) vs ${r.team2.displayName} (${r.team2.wins}-${r.team2.losses}). H2H record: ${r.h2hRecord.wins1}-${r.h2hRecord.wins2}. Trade friction: ${r.tradeFriction} trades between them. Rivalry score: ${r.totalScore}. ${r.streakHolder ? `${r.streakHolder.rosterId === r.team1.rosterId ? r.team1.displayName : r.team2.displayName} on a ${r.streakHolder.streak}-game streak.` : ''}`)
      }
      if (rivalryWeek.revengeGame) {
        const r = rivalryWeek.revengeGame
        const loser = r.recentLoser === r.team1.rosterId ? r.team1 : r.team2
        const winner = r.recentLoser === r.team1.rosterId ? r.team2 : r.team1
        rivalryParts.push(`REVENGE GAME: ${loser.displayName} lost to ${winner.displayName} in Week ${r.lastMatchup?.week || '?'} and is seeking revenge. ${r.streakHolder ? `${winner.displayName} has won ${r.streakHolder.streak} straight.` : ''}`)
      }
      if (rivalryWeek.tradeTensionIndex) {
        const t = rivalryWeek.tradeTensionIndex
        rivalryParts.push(`TRADE TENSION: ${t.pair.team1.displayName} and ${t.pair.team2.displayName} have completed ${t.tradeCount} trades between them. Tension score: ${t.tensionScore}/100.`)
      }

      if (rivalryParts.length > 0) {
        const narrativePrompt = `You are a fantasy sports hype narrator. Write short, punchy narrative cards for these league rivalries.

League: "${league.name}" (${leagueType})

${rivalryParts.join('\n\n')}

For each card present, write a 1-2 sentence narrative that's dramatic, specific to the managers involved, and builds excitement. Reference actual records and stats when possible.

Return JSON: {"rivalryOfTheWeek": "...", "revengeGame": "...", "tradeTension": "..."}
Only include keys for cards that have data above. Keep each narrative under 50 words.`

        const narrativeCompletion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: narrativePrompt }],
          response_format: { type: 'json_object' },
          max_tokens: 400,
        })

        const narrativeContent = narrativeCompletion.choices[0]?.message?.content
        if (narrativeContent) {
          const parsed = JSON.parse(narrativeContent)
          if (parsed && typeof parsed === 'object') {
            rivalryNarratives = {
              rivalryOfTheWeek: typeof parsed.rivalryOfTheWeek === 'string' ? parsed.rivalryOfTheWeek : undefined,
              revengeGame: typeof parsed.revengeGame === 'string' ? parsed.revengeGame : undefined,
              tradeTension: typeof parsed.tradeTension === 'string' ? parsed.tradeTension : undefined,
            }
          }
        }
      }
    } catch (err) {
      console.error('Rivalry narrative generation error:', err)
    }

    const transferPreview = {
      dataQuality,
      league: {
        id: league.league_id,
        name: league.name,
        sport: league.sport?.toUpperCase() || 'NFL',
        season: league.season,
        type: leagueType,
        status: league.status,
        teamCount: league.total_rosters || league.settings?.num_teams || 0,
        playoffTeams: league.settings?.playoff_teams || 0,
        avatar: league.avatar ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}` : null,
        settings: {
          ppr,
          superflex: superflex > 0,
          tep: tep > 0,
        },
        scoringSettings: league.scoring_settings || {},
      },
      managers,
      stats: {
        totalSeasons: previousSeasons.length + 1,
        totalTrades: trades.length,
        totalDraftPicks: draftPicks.length,
        totalMatchups: allMatchups.reduce((sum, w) => sum + w.matchups.length, 0),
        previousSeasons: previousSeasons.map(s => s.season),
      },
      recentTrades: trades.slice(0, 5).map(t => {
        const rosterIds = t.roster_ids || []
        const sides: Record<number, { players: { id: string; name: string; pos: string; team: string }[]; picks: number }> = {}
        rosterIds.forEach(rid => { sides[rid] = { players: [], picks: 0 } })

        if (t.adds) {
          for (const [pid, rid] of Object.entries(t.adds)) {
            if (!sides[rid]) sides[rid] = { players: [], picks: 0 }
            const p = playerMap[pid]
            sides[rid].players.push({
              id: pid,
              name: p?.name || pid,
              pos: p?.position || '',
              team: p?.team || '',
            })
          }
        }
        if (t.draft_picks) {
          t.draft_picks.forEach((dp: any) => {
            const rid = dp.owner_id
            if (rid && sides[rid]) sides[rid].picks++
            else if (rid) sides[rid] = { players: [], picks: 1 }
          })
        }

        const tradeSides = rosterIds.map(rid => {
          const user = rosterToUser[rid]
          return {
            rosterId: rid,
            username: user?.display_name || user?.username || 'Unknown',
            avatar: user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
            receives: sides[rid] || { players: [], picks: 0 },
          }
        })

        return {
          id: t.transaction_id,
          created: t.created,
          teamsInvolved: rosterIds.length,
          sides: tradeSides,
          playersAdded: t.adds ? Object.keys(t.adds).length : 0,
          playersDropped: t.drops ? Object.keys(t.drops).length : 0,
          draftPicks: t.draft_picks?.length || 0,
        }
      }),
      recentDraft: draftPicks.slice(0, 10).map(p => ({
        round: p.round,
        pick: p.pick_no,
        playerId: p.player_id,
        playerName: p.metadata ? `${p.metadata.first_name} ${p.metadata.last_name}` : p.player_id,
        position: p.metadata?.position || '',
        team: p.metadata?.team || '',
      })),
      rosterPositions: league.roster_positions || [],
      playerMap,
      draftInfo,
      storylines,
      rivalryWeek,
      rivalryNarratives,
    }

    return NextResponse.json({
      success: true,
      preview: transferPreview,
      message: `Found "${league.name}" with ${managers.length} managers and ${previousSeasons.length + 1} seasons of history.`
    })

  } catch (error: any) {
    console.error('Transfer error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch league data' },
      { status: 500 }
    )
  }
})
