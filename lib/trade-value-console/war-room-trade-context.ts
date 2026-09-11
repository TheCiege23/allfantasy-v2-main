import 'server-only'

import { prisma } from '@/lib/prisma'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { leagueToolAccessUserMessage } from '@/lib/ai-tools/league-tool-access-messages'
import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { loadLeagueForTrade } from './league-loader'
import { snapshotFromLoaded } from './quick-badges'
import { CURRENT_FRANCHISES_INCLUDING_UNKNOWN } from '@/lib/league-import/teamLifecycle'

export type TradeValueWarRoomContext =
  | {
      ok: true
      leagueId: string
      leagueName: string | null
      sport: string
      scoringLine: string | null
      leagueContextResolved: boolean
      teamCount: number
      yourTeamClaimed: boolean
      summaryLine: string
      /** Trade deadline / review / pick-trading summary for AI consumers. Null when no league context. */
      tradeWindow: {
        currentPeriod: number | null
        tradeDeadlineWeek: number | null
        weeksUntilDeadline: number | null
        pastDeadline: boolean
        tradeReviewHours: number | null
        draftPickTrading: boolean | null
        note: string
      } | null
    }
  | {
      ok: false
      code: LeagueToolAccessErrorCode
      userMessage: string
    }

/**
 * Lightweight, deterministic context for War Room (no synthetic trade sides).
 * Confirms membership, league engine scoring, and roster/team rows for Trade Value deep links.
 */
export async function loadTradeValueWarRoomContext(args: {
  userId: string
  leagueId: string
}): Promise<TradeValueWarRoomContext> {
  const access = await assertLeagueMemberWithCode(args.leagueId.trim(), args.userId)
  if (!access.ok) {
    return { ok: false, code: access.code, userMessage: leagueToolAccessUserMessage(access.code) }
  }

  const leagueRow = await loadLeagueForTrade({
    leagueId: args.leagueId.trim(),
    userId: args.userId,
    membershipPreverified: true,
  })
  if (!leagueRow) {
    return { ok: false, code: 'DATA_LOAD_FAILED', userMessage: leagueToolAccessUserMessage('DATA_LOAD_FAILED') }
  }

  const snap = snapshotFromLoaded(leagueRow)
  let scoringLine: string | null = null
  let leagueContextResolved = false
  let tradeWindow: Extract<TradeValueWarRoomContext, { ok: true }>['tradeWindow'] = null
  try {
    const lc = await resolveNormalizedLeagueContext({
      userId: args.userId,
      leagueId: args.leagueId.trim(),
    })
    if (lc.ok) {
      leagueContextResolved = true
      const s = lc.context.scoring
      scoringLine = `${s.scoringModel} · rec ${s.labels.receptionFormat} · SF ${s.labels.isSuperflex ? 'on' : 'off'}`
      const cur = lc.context.matchupPeriod.currentPeriod
      const deadline = lc.context.trade.tradeDeadlineWeek
      const reviewHours = lc.context.trade.tradeReviewHours
      const pickTrading = lc.context.trade.draftPickTrading
      const weeksUntil = typeof cur === 'number' && typeof deadline === 'number' ? deadline - cur : null
      const pastDeadline = weeksUntil != null && weeksUntil < 0
      const deadlinePart =
        deadline == null
          ? 'No trade deadline configured.'
          : pastDeadline
            ? `Trade deadline (week ${deadline}) has passed.`
            : weeksUntil === 0
              ? `Trade deadline is this week (week ${deadline}).`
              : weeksUntil != null
                ? `Trade deadline in ${weeksUntil} week${weeksUntil === 1 ? '' : 's'} (week ${deadline}).`
                : `Trade deadline: week ${deadline}.`
      const reviewPart =
        reviewHours != null && reviewHours > 0
          ? ` Review: ${reviewHours}h.`
          : reviewHours === 0
            ? ' No review period.'
            : ''
      const pickPart =
        pickTrading === true
          ? ' Picks tradable.'
          : pickTrading === false
            ? ' Picks not tradable.'
            : ''
      tradeWindow = {
        currentPeriod: cur,
        tradeDeadlineWeek: deadline,
        weeksUntilDeadline: weeksUntil,
        pastDeadline,
        tradeReviewHours: reviewHours,
        draftPickTrading: pickTrading,
        note: `${deadlinePart}${reviewPart}${pickPart}`.trim(),
      }
    }
  } catch {
    scoringLine = snap.scoring ? `League label: ${snap.scoring}` : null
  }

  /* "Is your team claimed" is a current-membership question. */
  const teams = await prisma.leagueTeam.findMany({
    where: { ...CURRENT_FRANCHISES_INCLUDING_UNKNOWN, leagueId: args.leagueId.trim() },
    select: { claimedByUserId: true },
  })
  const yourTeamClaimed = teams.some((t) => t.claimedByUserId === args.userId)

  const summaryLine = leagueContextResolved
    ? `Trade Value uses normalized scoring (${scoringLine ?? 'see league'}). ${yourTeamClaimed ? 'Your team is linked — roster-aware pricing is available.' : 'Claim your team in this league to unlock full roster context.'}`
    : `League loaded (${snap.name ?? snap.id}). ${scoringLine ? `Scoring: ${scoringLine}.` : ''} Open Trade Value to grade a deal with live valuations.`

  return {
    ok: true,
    leagueId: snap.id,
    leagueName: snap.name,
    sport: String(snap.sport),
    scoringLine,
    leagueContextResolved,
    teamCount: teams.length,
    yourTeamClaimed,
    summaryLine,
    tradeWindow,
  }
}
