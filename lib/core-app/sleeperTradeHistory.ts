import 'server-only'

import {
  getTradeGrades,
  type GradedTrade,
  type TradeGradesPayload,
} from '@/lib/trade-intel/sleeperTradeGradeService'
import { currentTradeIds } from '@/lib/trade-intel/sleeperTradeSync'
import { archiveCompletedFeedTrades } from '@/lib/import-os/collector/archiveFeedTrades'
import { loadTradeExpectation } from '@/lib/trade-intel/tradeExpectationLoader'
import { hasNoSignal } from '@/lib/trade-intel/tradeGradeEmail'
import type { TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
import type { ResolvedPlayerMedia } from '@/lib/player-media'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { sleeperAvatarUrl } from '@/lib/sleeper-avatar'
import type { TradeRecord } from './trades'

function expectationNote(expectation: TradeExpectation | null, rosterId: number): string {
  if (!expectation) return 'Not enough league-specific market data to issue a grade.'
  const side = expectation.sides.find((s) => s.rosterId === rosterId)
  if (expectation.evaluation?.withheldReason) {
    return `${expectation.evaluation.withheldReason} League: ${expectation.leagueNote}.`
  }
  if (!side?.projected) return `No complete market grade is available. League: ${expectation.leagueNote}.`
  const edge = Math.round(side.projected.valueEdge * 100)
  const disagreement = side.projected.productionDisagrees
    ? ' Prior-season production points the other way.'
    : ''
  const need = side?.starterGaps == null
    ? 'Roster needs unavailable.'
    : side.starterGaps.length === 0
      ? 'No required starter gaps detected.'
      : `Starter gaps: ${side.starterGaps.map((g) => `${g.position} ${g.rostered}/${g.required}`).join(', ')}.`
  const playoff = expectation.evaluation?.factors?.find((f) => f.id === 'playoff-impact')
  return `Market grade: ${edge >= 0 ? '+' : ''}${edge}% value in ${expectation.leagueNote || 'this league'}.${disagreement} ${need} ${playoff?.detail ?? 'Playoff impact is unavailable.'} This is a market grade; a full contextual grade is withheld until every required input is available.`
}

export function toTradeRecord(
  trade: GradedTrade,
  viewerOwnerId: string | null,
  expectation: TradeExpectation | null,
  mediaByPlayerId: Map<string, ResolvedPlayerMedia> = new Map(),
): TradeRecord {
  const mine = trade.sides.find((s) => viewerOwnerId != null && s.ownerId === viewerOwnerId)
  const side = mine ?? trade.sides[0]
  const provisional = hasNoSignal(trade)
  return {
    transactionId: trade.id,
    season: Number(trade.season), week: trade.week,
    at: new Date(trade.createdIso),
    rosterIds: trade.sides.map((s) => String(s.rosterId)),
    yourSide: mine ? 'in' : 'unknown',
    playersIn: side?.playersIn.length ?? 0,
    playersOut: side?.playersOut.length ?? 0,
    picks: trade.sides.reduce((n, s) => n + s.picksIn.length, 0),
    partnerTeamName: trade.sides.filter((s) => s !== side).map((s) => s.teamName ?? s.managerName).join(', ') || null,
    players: trade.sides.map((s) => {
      const projected = expectation?.sides.find((e) => e.rosterId === s.rosterId)?.projected
      return {
        manager: s.teamName ?? s.managerName,
        avatarUrl: sleeperAvatarUrl(s.avatar),
        isYou: viewerOwnerId != null && s.ownerId === viewerOwnerId,
        received: s.playersIn.map((p) => {
          const resolved = mediaByPlayerId.get(p.playerId)
          return {
            sleeperId: p.playerId,
            name: p.name,
            position: p.position,
            team: resolved?.teamAbbr ?? null,
            headshotUrl: resolved?.media.headshotUrl ?? null,
            teamLogoUrl: resolved?.media.teamLogoUrl ?? null,
          }
        }),
        picks: s.picksIn.map((p) => p.label),
        grade: provisional ? projected?.letter ?? null : s.currentGrade,
        gradeBasis: provisional ? 'Market' : 'Realized',
        gradeNote: provisional
          ? expectationNote(expectation, s.rosterId)
          : `Realized under this league's scoring: net ${s.cumulativeNet.toFixed(1)} fantasy points while the assets were held. This result grade does not claim a team-needs or playoff-probability adjustment.`,
      }
    }),
  }
}

export type ReconciledTradeGrades = {
  grades: TradeGradesPayload | null
  feedAvailable: boolean
  incomplete: boolean
  refreshed: boolean
}

/**
 * One completed-trade read for every app surface.
 *
 * Emails force the ledger as soon as the detector sees a completed provider
 * transaction. A screen can load before that sweep, so it must compare the
 * cached ledger with the same live transaction ids and repair the cache when a
 * completed id is missing. This is shared by desktop, mobile, and the legacy
 * league tab so none can remain days behind the notification path.
 */
export async function getReconciledTradeGrades(
  leagueId: string,
): Promise<ReconciledTradeGrades> {
  const [initial, feed] = await Promise.all([
    getTradeGrades(leagueId),
    currentTradeIds(leagueId),
  ])
  const known = new Set(initial?.trades.map((t) => t.id.split(':').pop()) ?? [])
  const missingCompleted = feed?.some((t) => t.status === 'complete' && !known.has(t.id)) ?? false
  /*
   * 🛑 THE SAME MOMENT IS THE ARCHIVE'S GAP (2026-09-25). A completed trade the ledger lacks is one
   * the archive (/core Trades' grade list, the board, Chimmy's history) lacks too — it waited for a
   * sync lane, hours to a day. Written from this same feed now, in the background: idempotent, and
   * never allowed to slow or fail the read that noticed it.
   */
  if (missingCompleted && feed) {
    void archiveCompletedFeedTrades({ sleeperLeagueId: leagueId, feed }).catch(() => undefined)
  }
  const grades = missingCompleted ? await getTradeGrades(leagueId, { force: true }) : initial
  const refreshedIds = new Set(grades?.trades.map((t) => t.id.split(':').pop()) ?? [])
  const incomplete =
    !feed ||
    (feed?.some((t) => t.status === 'complete' && !refreshedIds.has(t.id)) ?? false) ||
    Boolean(grades?.missing.some((m) => m.includes('transactions')))
  return {
    grades,
    feedAvailable: feed != null,
    incomplete,
    refreshed: missingCompleted,
  }
}

export async function getSleeperTradeHistory(leagueId: string, viewerOwnerId: string | null) {
  const reconciled = await getReconciledTradeGrades(leagueId)
  const grades = reconciled.grades
  if (!grades) return null
  const trades = [...grades.trades].sort((a, b) => Date.parse(b.createdIso) - Date.parse(a.createdIso)).slice(0, 60)
  const mediaByPlayerId = await attachPlayerMediaBatch(
    [...new Set(trades.flatMap((t) => t.sides.flatMap((s) => s.playersIn.map((p) => p.playerId))))]
      .map((playerId) => ({ playerId, sport: 'nfl' })),
  ).catch(() => new Map<string, ResolvedPlayerMedia>())
  const history: TradeRecord[] = []
  // Only trades without realized points need the same market projection used
  // in the email. Bound expensive enrichment to four concurrent trades.
  for (let i = 0; i < trades.length; i += 4) {
    history.push(...await Promise.all(trades.slice(i, i + 4).map(async (trade) => {
      const expectation = hasNoSignal(trade)
        ? await loadTradeExpectation(leagueId, trade).catch(() => null)
        : null
      return toTradeRecord(trade, viewerOwnerId, expectation, mediaByPlayerId)
    })))
  }
  return {
    history,
    notice: grades.staleAsOf || reconciled.incomplete
      ? 'Sleeper trade refresh is incomplete. Showing the last available grades; refresh to check for newer trades.'
      : `Trade history checked with Sleeper${reconciled.refreshed ? ' and refreshed' : ''}. Grades updated ${grades.fetchedAt}.`,
  }
}
