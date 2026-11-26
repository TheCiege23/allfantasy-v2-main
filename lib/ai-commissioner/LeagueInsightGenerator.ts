import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { analyzeLeagueGovernance } from './LeagueGovernanceAnalyzer'
import { loadTradeFairnessWatchlist } from './TradeFairnessAnalyzer'
import { toLeagueSport } from './SportCommissionerResolver'
import type { DraftInsight, LeagueInsightReport, MatchupInsight, WaiverInsight, WeeklyRecapPost } from './types'

interface LeagueInsightGeneratorInput {
  leagueId: string
  sport?: string | null
  season?: number | null
}

function buildWeeklyRecapPost(input: {
  leagueId: string
  sport: LeagueSport
  season: number
  matchupCount: number
  waiverCount: number
  tradeCount: number
  controversialTradeCount: number
  draftCommentaryCount: number
  pendingWaiverClaims: number
}): WeeklyRecapPost {
  const bullets: string[] = []
  bullets.push(`${input.matchupCount} matchup storyline(s) summarized for ${input.sport}.`)
  bullets.push(`${input.waiverCount} waiver result highlight(s) reviewed by Chimmy Commissioner.`)
  bullets.push(`${input.tradeCount} recent trade(s) scanned for fairness and controversy risk.`)
  bullets.push(`${input.draftCommentaryCount} draft commentary note(s) generated from recent picks.`)
  if (input.pendingWaiverClaims > 0) {
    bullets.push(`${input.pendingWaiverClaims} waiver claim(s) still pending commissioner action.`)
  }
  if (input.controversialTradeCount > 0) {
    bullets.push(
      `${input.controversialTradeCount} controversial trade(s) flagged for closer review this week.`
    )
  }

  return {
    title: `${input.sport} Commissioner Weekly Recap`,
    body: `Week-in-review for season ${input.season}: matchup momentum, waiver outcomes, draft movement, and trade fairness signals for league ${input.leagueId}.`,
    bullets,
    actionHref: `/league/${encodeURIComponent(input.leagueId)}?tab=Commissioner`,
    actionLabel: 'Open Commissioner',
  }
}

function buildRuleAdjustments(input: {
  pendingWaiverClaims: number
  inactiveManagers: number
  tradeDisputes: number
  ruleConflicts: string[]
}): string[] {
  const adjustments: string[] = []
  if (input.pendingWaiverClaims >= 8) {
    adjustments.push(
      'Increase waiver processing cadence or raise FAAB guidance visibility to reduce claim backlog.'
    )
  }
  if (input.inactiveManagers > 0) {
    adjustments.push(
      'Enable auto-reminders for inactive managers and publish a clear lineup compliance schedule.'
    )
  }
  if (input.tradeDisputes >= 2) {
    adjustments.push(
      'Require commissioner review for high-imbalance trades before league vote to reduce controversy.'
    )
  }
  for (const conflict of input.ruleConflicts) {
    adjustments.push(`Resolve rule conflict: ${conflict}`)
  }
  if (adjustments.length === 0) {
    adjustments.push('Current governance settings look healthy; maintain current policy with weekly audits.')
  }
  return adjustments.slice(0, 6)
}

function buildMatchupSummaryRows(rows: Array<{ matchupId: string; weekOrPeriod: number; teamA: string; teamB: string; scoreA: number; scoreB: number }>): MatchupInsight[] {
  return rows.map((matchup) => {
    const spread = Math.abs(matchup.scoreA - matchup.scoreB)
    const winner =
      matchup.scoreA === matchup.scoreB
        ? 'Tie'
        : matchup.scoreA > matchup.scoreB
          ? matchup.teamA
          : matchup.teamB
    return {
      matchupId: matchup.matchupId,
      weekOrPeriod: matchup.weekOrPeriod,
      summary: `Week ${matchup.weekOrPeriod}: ${matchup.teamA} ${matchup.scoreA.toFixed(
        1
      )} - ${matchup.teamB} ${matchup.scoreB.toFixed(1)} (winner: ${winner}, margin ${spread.toFixed(1)}).`,
    }
  })
}

function safeSport(sport: string | null | undefined): LeagueSport {
  return toLeagueSport(normalizeToSupportedSport(sport))
}

export async function generateLeagueInsights(
  input: LeagueInsightGeneratorInput
): Promise<LeagueInsightReport> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, sport: true, season: true },
  })
  if (!league) throw new Error('League not found')

  const sport = safeSport(input.sport ?? league.sport)
  const season = input.season ?? league.season ?? new Date().getUTCFullYear()

  const [governance, controversialTrades, latestWeekRows, waiverRows, draftRows] = await Promise.all([
    analyzeLeagueGovernance({ leagueId: input.leagueId, sport, season }),
    loadTradeFairnessWatchlist({ leagueId: input.leagueId, sport, season, limit: 6 }),
    prisma.matchupFact
      .findMany({
        where: { leagueId: input.leagueId, sport, season },
        orderBy: [{ weekOrPeriod: 'desc' }, { createdAt: 'desc' }],
        take: 18,
        select: {
          matchupId: true,
          weekOrPeriod: true,
          teamA: true,
          teamB: true,
          scoreA: true,
          scoreB: true,
        },
      })
      .catch(() => []),
    prisma.waiverTransaction
      .findMany({
        where: { leagueId: input.leagueId, sportType: sport },
        orderBy: { processedAt: 'desc' },
        take: 8,
        select: {
          claimId: true,
          rosterId: true,
          addPlayerId: true,
          dropPlayerId: true,
          faabSpent: true,
          processedAt: true,
        },
      })
      .catch(() => []),
    prisma.draftPick
      .findMany({
        where: {
          session: { leagueId: input.leagueId },
          sportType: sport,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          overall: true,
          round: true,
          displayName: true,
          playerName: true,
          position: true,
          source: true,
          createdAt: true,
        },
      })
      .catch(() => []),
  ])

  const highestWeek = latestWeekRows.reduce((max, row) => Math.max(max, row.weekOrPeriod), 0)
  const matchupSummaries = buildMatchupSummaryRows(
    latestWeekRows
      .filter((row) => row.weekOrPeriod === highestWeek || highestWeek === 0)
      .sort((a, b) => Math.abs(a.scoreA - a.scoreB) - Math.abs(b.scoreA - b.scoreB))
      .slice(0, 5)
  )

  const waiverHighlights: WaiverInsight[] = waiverRows.map((row) => ({
    claimId: row.claimId ?? null,
    processedAt: row.processedAt?.toISOString() ?? null,
    summary: `Roster ${row.rosterId} added ${row.addPlayerId}${
      row.dropPlayerId ? ` and dropped ${row.dropPlayerId}` : ''
    }${row.faabSpent != null ? ` for $${row.faabSpent} FAAB` : ''}.`,
  }))

  const draftCommentary: DraftInsight[] = draftRows.map((pick) => ({
    pickId: pick.id,
    createdAt: pick.createdAt.toISOString(),
    summary: `Round ${pick.round}, pick ${pick.overall}: ${pick.displayName || pick.playerName} selected ${pick.playerName} (${pick.position}) via ${pick.source || 'user'} pick.`,
  }))

  const weeklyRecapPost = buildWeeklyRecapPost({
    leagueId: input.leagueId,
    sport,
    season,
    matchupCount: matchupSummaries.length,
    waiverCount: waiverHighlights.length,
    tradeCount: controversialTrades.length,
    // A withheld grade ('unknown') is not a controversy — only a graded lean is.
    controversialTradeCount: controversialTrades.filter(
      (trade) => trade.controversyLevel === 'high' || trade.controversyLevel === 'medium'
    ).length,
    draftCommentaryCount: draftCommentary.length,
    pendingWaiverClaims: governance.pendingWaiverClaims,
  })

  const suggestedRuleAdjustments = buildRuleAdjustments({
    pendingWaiverClaims: governance.pendingWaiverClaims,
    inactiveManagers: governance.inactiveManagers.length,
    tradeDisputes: governance.tradeDisputes.length,
    ruleConflicts: governance.ruleConflicts.map((conflict) => conflict.summary),
  })

  return {
    leagueId: input.leagueId,
    sport,
    season,
    generatedAt: new Date().toISOString(),
    weeklyRecapPost,
    matchupSummaries,
    waiverHighlights,
    draftCommentary,
    controversialTrades,
    suggestedRuleAdjustments,
  }
}
