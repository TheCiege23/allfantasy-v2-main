/**
 * Lineup Attention Service — Phase 9.
 *
 * Reuses lib/lineup-actions/computeLineupActionsForUser.ts — the real, live,
 * cross-league lineup-issue engine (already wired into Decision OS's lineup
 * slice and an active `/api/today/lineup-actions` route) — as this service's
 * primary attention source. Its `fetch_error` reasonType is dropped, matching
 * that engine's OWN convention (its `countableAction()` helper already
 * excludes fetch_error from anything a user should act on).
 *
 * On top of that reuse, this service adds NEW attention reasons the existing
 * engine does not cover, computed only from real fields this module's own
 * GameDayContextAssembler already assembles (MatchupPlayerSlot's
 * injuryStatus/gameStatus/projectedPoints/currentPoints, and real
 * FantasyScheduleGame rows for postponement/cancellation cross-reference) —
 * never fabricated. Reasons the brief lists that this phase's real data does
 * NOT support (bench_out_projecting_starter, healthy_player_on_ir) are
 * declared in the LineupAttentionReasonCode type for future use but are not
 * computed here — MatchupCenterPayload only exposes starters, not bench/IR
 * with projections, so implementing them now would require guessing. See
 * README "Known limitations."
 */

import { prisma } from '@/lib/prisma'
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import type { LineupActionItem, LineupActionReasonType } from '@/lib/lineup-actions/types'
import type { LeagueGameDayContext, LineupAttentionItem, LineupAttentionReasonCode } from './types'

const LEGACY_REASON_MAP: Partial<Record<LineupActionReasonType, LineupAttentionReasonCode>> = {
  empty_starter: 'empty_starting_slot',
  native_starter_gap: 'empty_starting_slot',
  injured_starter: 'starter_ruled_out',
  questionable_starter: 'starter_questionable_or_doubtful',
  doubtful_starter: 'starter_questionable_or_doubtful',
  illegal_slot: 'invalid_lineup',
  weather_risk: 'starter_game_postponed_or_cancelled',
}

function mapLegacyItem(item: LineupActionItem, fetchedAt: string): LineupAttentionItem | null {
  // fetch_error is not countable per the source engine's own convention — dropped here too.
  if (item.reasonType === 'fetch_error') return null

  const reasonCode = LEGACY_REASON_MAP[item.reasonType] ?? 'legacy_engine_reported_issue'
  return {
    reasonCode,
    severity: item.severity,
    message: item.message,
    leagueId: item.leagueId,
    leagueName: item.leagueName,
    rosterId: item.teamId,
    playerId: item.playerId,
    playerName: item.playerName,
    evidence: [`Source: computeLineupActionsForUser (${item.sourceModule}), reasonType=${item.reasonType}.`],
    freshness: 'fresh',
    sourceAttribution: {
      source: 'lineup-actions-engine',
      fetchedAt,
      providerTimestamp: null,
      freshness: 'fresh',
      confidence: item.confidence ?? 70,
      missingDataReason: null,
    },
    confidence: item.confidence ?? 70,
    risk: item.severity === 'critical' ? 'high' : item.severity === 'warning' ? 'medium' : 'low',
    actionable: item.lockTime ? new Date(item.lockTime).getTime() > Date.now() : true,
    providerDeepLink: null,
  }
}

function statusMatches(injuryStatus: string | null, needles: string[]): boolean {
  if (!injuryStatus) return false
  const lower = injuryStatus.toLowerCase()
  return needles.some((n) => lower.includes(n))
}

async function findPostponedOrCancelledGame(sport: string, season: string, week: number, team: string | null): Promise<boolean> {
  if (!team) return false
  const game = await prisma.fantasyScheduleGame.findFirst({
    where: { sport, season, week, OR: [{ homeTeam: team }, { awayTeam: team }] },
    select: { status: true },
  })
  const status = (game?.status ?? '').toLowerCase()
  return status.includes('postponed') || status.includes('cancelled') || status.includes('canceled')
}

export async function computeLineupAttention(input: {
  userId: string
  leagueContexts: LeagueGameDayContext[]
}): Promise<{ items: LineupAttentionItem[]; legacyActions: LineupActionItem[] }> {
  const fetchedAt = new Date().toISOString()
  const items: LineupAttentionItem[] = []

  const legacyPayload = await computeLineupActionsForUser(input.userId)
  for (const action of legacyPayload.actions) {
    const mapped = mapLegacyItem(action, fetchedAt)
    if (mapped) items.push(mapped)
  }

  for (const ctx of input.leagueContexts) {
    if (!ctx.matchup) continue
    if (ctx.matchupState.attribution.freshness === 'stale') {
      items.push({
        reasonCode: 'stale_player_status',
        severity: 'info',
        message: `Matchup data for ${ctx.leagueId} is stale — ${ctx.matchupState.attribution.missingDataReason ?? 'refresh recommended.'}`,
        leagueId: ctx.leagueId,
        leagueName: null,
        rosterId: ctx.matchup.left.rosterId,
        playerId: null,
        playerName: null,
        evidence: [`Fetched at ${ctx.matchupState.attribution.fetchedAt}.`],
        freshness: 'stale',
        sourceAttribution: ctx.matchupState.attribution,
        confidence: ctx.matchupState.attribution.confidence,
        risk: 'low',
        actionable: true,
        providerDeepLink: null,
      })
    }

    for (const starter of ctx.matchup.left.starters) {
      const isLocked = starter.gameStatus === 'live' || starter.gameStatus === 'final'

      if (statusMatches(starter.injuryStatus, ['out', 'ir', 'inactive'])) {
        items.push({
          reasonCode: statusMatches(starter.injuryStatus, ['inactive']) ? 'starter_inactive' : 'starter_ruled_out',
          severity: isLocked ? 'info' : 'critical',
          message: `${starter.name} (${starter.position}) is ${starter.injuryStatus} and is in your starting lineup.`,
          leagueId: ctx.leagueId,
          leagueName: null,
          rosterId: ctx.matchup.left.rosterId,
          playerId: starter.playerId,
          playerName: starter.name,
          evidence: [`injuryStatus=${starter.injuryStatus}`, `gameStatus=${starter.gameStatus}`],
          freshness: ctx.matchupState.attribution.freshness,
          sourceAttribution: ctx.matchupState.attribution,
          confidence: 85,
          risk: isLocked ? 'low' : 'high',
          actionable: !isLocked,
          providerDeepLink: null,
        })
      } else if (statusMatches(starter.injuryStatus, ['questionable', 'doubtful'])) {
        items.push({
          reasonCode: 'starter_questionable_or_doubtful',
          severity: isLocked ? 'info' : 'warning',
          message: `${starter.name} (${starter.position}) is ${starter.injuryStatus}.`,
          leagueId: ctx.leagueId,
          leagueName: null,
          rosterId: ctx.matchup.left.rosterId,
          playerId: starter.playerId,
          playerName: starter.name,
          evidence: [`injuryStatus=${starter.injuryStatus}`],
          freshness: ctx.matchupState.attribution.freshness,
          sourceAttribution: ctx.matchupState.attribution,
          confidence: 70,
          risk: isLocked ? 'low' : 'medium',
          actionable: !isLocked,
          providerDeepLink: null,
        })
      }

      if (starter.gameStatus === 'upcoming' && starter.projectedPoints === 0 && starter.currentPoints === 0) {
        items.push({
          reasonCode: 'missing_projection',
          severity: 'info',
          message: `${starter.name} (${starter.position}) has no available projection.`,
          leagueId: ctx.leagueId,
          leagueName: null,
          rosterId: ctx.matchup.left.rosterId,
          playerId: starter.playerId,
          playerName: starter.name,
          evidence: ['projectedPoints=0', 'currentPoints=0'],
          freshness: ctx.matchupState.attribution.freshness,
          sourceAttribution: ctx.matchupState.attribution,
          confidence: 50,
          risk: 'low',
          actionable: true,
          providerDeepLink: null,
        })
      }

      if (!isLocked && (await findPostponedOrCancelledGame(ctx.sport, String(ctx.season), ctx.week, starter.team))) {
        items.push({
          reasonCode: 'starter_game_postponed_or_cancelled',
          severity: 'critical',
          message: `${starter.name} (${starter.position})'s game appears postponed or cancelled.`,
          leagueId: ctx.leagueId,
          leagueName: null,
          rosterId: ctx.matchup.left.rosterId,
          playerId: starter.playerId,
          playerName: starter.name,
          evidence: [`team=${starter.team}`],
          freshness: ctx.matchupState.attribution.freshness,
          sourceAttribution: ctx.matchupState.attribution,
          confidence: 60,
          risk: 'high',
          actionable: true,
          providerDeepLink: null,
        })
      }
    }
  }

  return { items, legacyActions: legacyPayload.actions }
}
