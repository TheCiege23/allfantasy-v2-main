/**
 * My Team / Manager Command Center — server-side context assembly.
 *
 * This module is deliberately thin. It does not compute scores, projections,
 * matchup pairing, standings, or win probability; every figure it returns comes
 * from an already-live canonical engine, and anything without one is reported as
 * unavailable rather than approximated. See `lib/my-team/types.ts` for why that
 * is enforced structurally, and `lib/my-team/derive.ts` for the pure rules.
 *
 * Reuse map:
 *   matchup / starters / win prob  → `buildLeagueGameDayContext`, which wraps
 *                                    `server/services/matchupCenterService.ts`
 *   lineup issues → game plan      → `computeLineupActionsForUser`, filtered to
 *                                    this league
 *   access                         → `resolveLeagueAccess`
 *
 * Deliberately NOT wired, and reported honestly instead:
 *   playoff / championship odds    → `lib/ai/sim/seasonSimulator.ts` is real, but
 *                                    it is request-time Monte Carlo with no
 *                                    persistence and is not enabled for live
 *                                    surfaces. Fabricating a percentage here would
 *                                    be the most misleading number on the page.
 *   bench / IR / taxi depth        → `MatchupCenterPayload` exposes STARTERS only
 *                                    (documented in the game-day README). The full
 *                                    roster already renders in the league shell's
 *                                    My Team tab, which this page deep-links to.
 */

import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { buildLeagueGameDayContext } from '@/lib/shared-services/game-day/GameDayContextAssembler'
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import type { SourceAttribution } from '@/lib/shared-services/game-day/types'
import type { UserLeague } from '@/app/dashboard/types'
import {
  buildGamePlan,
  buildLineupView,
  buildRosterNeeds,
  buildRosterStrength,
  humanizeEngineReason,
  resolveWriteCapability,
} from './derive'
import {
  sectionOk,
  sectionUnavailable,
  type GamePlanItem,
  type LineupView,
  type MatchupView,
  type MissionIndicator,
  type MyTeamContext,
  type RosterNeed,
  type RosterStrengthView,
  type SectionState,
  type TeamIdentity,
} from './types'

export type BuildMyTeamContextInput = {
  leagueId: string
  viewerUserId: string
  week?: number
  season?: number
}

export type BuildMyTeamContextResult =
  | { ok: true; context: MyTeamContext }
  | { ok: false; status: 403 | 404; reason: string }

function attribution(
  source: string,
  fetchedAt: string,
  freshness: SourceAttribution['freshness'],
  confidence: number,
): SourceAttribution {
  return { source, fetchedAt, providerTimestamp: null, freshness, confidence, missingDataReason: null }
}

// ── Mission control ──────────────────────────────────────────────────────────

function buildMissionControl(params: {
  lineup: SectionState<LineupView>
  gamePlan: SectionState<GamePlanItem[]>
  matchup: SectionState<MatchupView>
}): MissionIndicator[] {
  const indicators: MissionIndicator[] = []

  if (params.lineup.status === 'ok' && params.lineup.data.starters.length === 0) {
    // A roster with zero readable slots is not a complete lineup — `filled === total`
    // is vacuously true at 0/0 and would render as reassuring green while the action
    // queue simultaneously reports missing starters. Report the gap instead.
    indicators.push({
      id: 'lineup',
      label: 'Lineup status',
      value: null,
      sublabel: null,
      tone: 'unknown',
      targetId: 'lineup',
      unavailableReason: 'No starting slots could be read for your roster this week.',
    })
  } else if (params.lineup.status === 'ok') {
    const slots = params.lineup.data.starters
    const filled = slots.filter((s) => s.player != null).length
    const allSet = filled === slots.length
    indicators.push({
      id: 'lineup',
      label: 'Lineup status',
      value: `${filled} / ${slots.length}`,
      sublabel: allSet ? 'Starters set' : 'Slots need filling',
      tone: allSet ? 'positive' : 'critical',
      targetId: 'lineup',
      unavailableReason: null,
    })
  } else {
    indicators.push({
      id: 'lineup',
      label: 'Lineup status',
      value: null,
      sublabel: null,
      tone: 'unknown',
      targetId: 'lineup',
      unavailableReason: params.lineup.reason,
    })
  }

  if (params.gamePlan.status === 'ok') {
    const critical = params.gamePlan.data.filter((i) => i.priority === 'critical').length
    const high = params.gamePlan.data.filter((i) => i.priority === 'high').length
    indicators.push({
      id: 'attention',
      label: 'Needs attention',
      value: String(critical + high),
      sublabel: critical > 0 ? `${critical} critical` : high > 0 ? 'High priority' : 'Nothing urgent',
      tone: critical > 0 ? 'critical' : high > 0 ? 'warning' : 'positive',
      targetId: 'game-plan',
      unavailableReason: null,
    })
  } else {
    indicators.push({
      id: 'attention',
      label: 'Needs attention',
      value: null,
      sublabel: null,
      tone: 'unknown',
      targetId: 'game-plan',
      unavailableReason: params.gamePlan.reason,
    })
  }

  if (params.matchup.status === 'ok') {
    const pct = params.matchup.data.viewerWinProbabilityPct
    indicators.push({
      id: 'matchup',
      label: 'Matchup',
      value: pct == null ? null : `${Math.round(pct)}%`,
      sublabel: pct == null ? null : 'Projected-points ratio',
      tone: pct == null ? 'unknown' : pct >= 55 ? 'positive' : pct <= 45 ? 'warning' : 'neutral',
      targetId: 'matchup',
      unavailableReason: pct == null ? 'Win probability needs projections for both lineups.' : null,
    })
  } else {
    indicators.push({
      id: 'matchup',
      label: 'Matchup',
      value: null,
      sublabel: null,
      tone: 'unknown',
      targetId: 'matchup',
      unavailableReason: params.matchup.reason,
    })
  }

  indicators.push({
    id: 'playoffs',
    label: 'Playoff odds',
    value: null,
    sublabel: null,
    tone: 'unknown',
    targetId: 'outlook',
    unavailableReason: 'Season simulation is not enabled for this surface.',
  })

  return indicators
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export async function buildMyTeamContext(input: BuildMyTeamContextInput): Promise<BuildMyTeamContextResult> {
  const access = await resolveLeagueAccess(input.leagueId, input.viewerUserId)
  if (!access) {
    return { ok: false, status: 403, reason: 'You do not have access to this league.' }
  }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true,
      name: true,
      platform: true,
      platformLeagueId: true,
      sport: true,
      season: true,
      leagueType: true,
      lifecycleState: true,
      logoUrl: true,
    },
  })
  if (!league) {
    return { ok: false, status: 404, reason: 'League not found.' }
  }

  const roster = await prisma.roster.findFirst({
    where: { leagueId: input.leagueId, platformUserId: input.viewerUserId },
    select: { id: true },
  })

  const generatedAtIso = new Date().toISOString()

  // Both engines may fail independently — one failing must never blank the other,
  // and neither may degrade into a reassuring empty state.
  const [gameDayResult, lineupResult] = await Promise.allSettled([
    buildLeagueGameDayContext({
      leagueId: input.leagueId,
      viewerUserId: input.viewerUserId,
      week: input.week,
      season: input.season,
    }),
    computeLineupActionsForUser(input.viewerUserId),
  ])

  const gameDay = gameDayResult.status === 'fulfilled' ? gameDayResult.value : null

  const write = resolveWriteCapability({
    platform: String(league.platform ?? ''),
    platformLeagueId: league.platformLeagueId ?? null,
    hasRoster: roster != null,
  })

  // ── Matchup + lineup + strength ────────────────────────────────────────────
  let matchup: SectionState<MatchupView>
  let lineup: SectionState<LineupView>
  let rosterStrength: SectionState<RosterStrengthView>

  const payload = gameDay?.matchup ?? null

  if (!gameDay) {
    const detail = gameDayResult.status === 'rejected' ? String(gameDayResult.reason) : undefined
    const fail = sectionUnavailable(
      'provider_unavailable',
      'Matchup and lineup data could not be loaded for this league right now.',
      { detail },
    )
    matchup = fail
    lineup = fail
    rosterStrength = fail
  } else if (!payload) {
    const raw = gameDay.unavailableReason
    const reason = raw ? humanizeEngineReason(raw) : 'No matchup is scheduled for your team this week.'
    const kind = gameDay.matchupState.state === 'bye' ? 'unsupported_for_format' : 'provider_unavailable'
    // Raw engine text is preserved for logs but never rendered as the message.
    const extra = raw ? { detail: raw } : undefined
    matchup = sectionUnavailable(kind, reason, extra)
    lineup = sectionUnavailable(kind, reason, extra)
    rosterStrength = sectionUnavailable(kind, reason, extra)
  } else {
    const attr = attribution(
      'matchup-center-service',
      gameDay.matchupState.attribution.fetchedAt || generatedAtIso,
      gameDay.matchupState.attribution.freshness,
      gameDay.matchupState.attribution.confidence,
    )

    matchup = sectionOk<MatchupView>(
      {
        payload,
        // buildMatchupCenterPayload always builds `left` from the viewer's own
        // roster (matchupCenterService.ts:298-300). Verified, not inferred.
        viewerSide: 'left',
        viewerWinProbabilityPct:
          payload.winProbabilityLeft == null ? null : Math.round(payload.winProbabilityLeft * 1000) / 10,
        winProbabilityMethod: 'projected_points_ratio',
        state: gameDay.matchupState.state,
      },
      attr,
    )

    lineup = sectionOk(buildLineupView(payload), attr)

    const strength = buildRosterStrength(payload)
    rosterStrength = strength
      ? sectionOk(strength, attr)
      : sectionUnavailable('insufficient_data', 'No starter projections are available for this week yet.')
  }

  // ── Game plan + needs ──────────────────────────────────────────────────────
  let gamePlan: SectionState<GamePlanItem[]>
  let rosterNeeds: SectionState<RosterNeed[]>

  if (lineupResult.status !== 'fulfilled') {
    const fail = sectionUnavailable(
      'provider_unavailable',
      'Your action queue could not be built — the lineup scan did not complete.',
      { detail: String(lineupResult.reason) },
    )
    gamePlan = fail
    rosterNeeds = fail
  } else {
    const summary = lineupResult.value
    const block = summary.leagues.find((l) => l.leagueId === input.leagueId)
    const leagueActions = summary.actions.filter((a) => a.leagueId === input.leagueId)

    if (block?.scanIncomplete) {
      // The scan ran but could not see the whole lineup. Rendering "all clear"
      // here would be the worst possible outcome, so the gap is stated instead.
      gamePlan = sectionUnavailable(
        'provider_unavailable',
        'Your lineup could not be fully verified this cycle, so recommendations would be incomplete.',
        write.platformHref
          ? { resolveHref: write.platformHref, resolveLabel: `Check on ${write.platformLabel}` }
          : undefined,
      )
      rosterNeeds = sectionUnavailable('provider_unavailable', 'Roster needs require a complete lineup scan.')
    } else {
      const attr = attribution('lineup-actions-engine', summary.lastUpdatedAt || generatedAtIso, 'fresh', 1)
      gamePlan = sectionOk(buildGamePlan(leagueActions, write, input.leagueId), attr)
      rosterNeeds = sectionOk(buildRosterNeeds(leagueActions), attr)
    }
  }

  // ── Identity ───────────────────────────────────────────────────────────────
  const side = payload?.left ?? null
  const identity: TeamIdentity = {
    teamName: side?.teamName ?? 'My team',
    managerName: null,
    avatarUrl: side?.avatarUrl ?? null,
    record: side?.record ?? null,
    // Standings rank and power rank are separate engines this page does not read.
    // Null renders as an em dash rather than a fabricated placing.
    rank: null,
    teamCount: null,
    powerRank: null,
  }

  // ── Withheld sections ──────────────────────────────────────────────────────
  const playoffOutlook = sectionUnavailable(
    'engine_not_enabled',
    'Playoff and championship odds are not enabled for this surface. The season simulator runs on demand elsewhere and has no stored result to read here.',
  )
  const waivers = sectionUnavailable(
    'engine_not_enabled',
    'Waiver recommendations are not wired into this page yet.',
    write.platformHref
      ? { resolveHref: write.platformHref, resolveLabel: `Open waivers on ${write.platformLabel}` }
      : undefined,
  )
  const trades = sectionUnavailable('engine_not_enabled', 'Trade opportunities are not wired into this page yet.')

  const missionControl = buildMissionControl({ lineup, gamePlan, matchup })

  const userLeague: UserLeague = {
    id: league.id,
    name: league.name,
    platform: String(league.platform ?? 'unknown'),
    sport: String(league.sport ?? 'NFL'),
    format: String(league.leagueType ?? ''),
    teamCount: 0,
    season: league.season ?? undefined,
    logoUrl: league.logoUrl ?? null,
    leagueType: league.leagueType ?? null,
    lifecycleState: league.lifecycleState ?? null,
    isCommissioner: access.isCommissioner,
    hasUnifiedRecord: true,
  }

  const degraded = [lineup, gamePlan, matchup, rosterStrength, rosterNeeds].some((s) => s.status === 'unavailable')

  return {
    ok: true,
    context: {
      league: userLeague,
      leagueId: league.id,
      season: gameDay?.season ?? league.season ?? 0,
      week: gameDay?.week ?? 0,
      weekResolutionSource: gameDay?.weekResolution.source ?? 'unresolved',
      isPlayoffWeek: gameDay?.weekResolution.isPlayoffWeek ?? false,
      sport: gameDay?.sport ?? String(league.sport ?? 'NFL'),
      platform: gameDay?.platform ?? String(league.platform ?? 'unknown'),
      identity,
      write,
      viewerIsCommissioner: access.isCommissioner,
      lineup,
      gamePlan,
      matchup,
      rosterStrength,
      rosterNeeds,
      playoffOutlook,
      waivers,
      trades,
      missionControl,
      generatedAtIso,
      degraded,
    },
  }
}
