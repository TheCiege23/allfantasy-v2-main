/**
 * My Team — pure derivation helpers.
 *
 * Split out from `buildMyTeamContext.ts` so the product rules that matter most
 * (what counts as read-only, what a slot's status is, when a grade is withheld)
 * are plain functions over plain data: no prisma, no network, no session. They
 * are unit-testable with zero mocks, which is what keeps the honesty invariants
 * actually covered rather than nominally covered.
 */

import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { MatchupCenterPayload, MatchupPlayerSlot } from '@/lib/matchup-center/types'
import type {
  GamePlanItem,
  GamePlanPriority,
  LineupPlayer,
  LineupSlot,
  LineupSlotStatus,
  LineupView,
  PositionStrength,
  RosterNeed,
  RosterStrengthView,
  WriteCapability,
} from './types'

/** Platforms whose leagues are imported snapshots — analysis only, never written to from here. */
export const IMPORTED_PLATFORMS = new Set(['sleeper', 'espn', 'yahoo', 'cbs', 'fantrax', 'mfl'])

export const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  cbs: 'CBS',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
}

/**
 * An imported league is read-only here regardless of the viewer's role — a
 * commissioner of a Sleeper league still cannot set a lineup through AllFantasy,
 * because AllFantasy does not hold the authoritative roster. Encoding that as
 * data (rather than `platform === 'sleeper'` checks sprinkled through the UI) is
 * what stops the page implying an action happened here when it did not.
 */
export function resolveWriteCapability(params: {
  platform: string
  platformLeagueId: string | null
  hasRoster: boolean
}): WriteCapability {
  const platform = params.platform.trim().toLowerCase()
  const label = PLATFORM_LABELS[platform] ?? null

  if (IMPORTED_PLATFORMS.has(platform)) {
    const href =
      platform === 'sleeper' && params.platformLeagueId
        ? `https://sleeper.com/leagues/${params.platformLeagueId}`
        : null
    return {
      canEditLineup: false,
      canSubmitWaiverClaim: false,
      canProposeTrade: false,
      canMoveToIr: false,
      platformHref: href,
      platformLabel: label,
      readOnlyReason: label
        ? `This league is imported from ${label}. AllFantasy can analyze and recommend, but roster moves have to be made on ${label}.`
        : 'This league is imported. AllFantasy can analyze and recommend, but roster moves have to be made on the source platform.',
    }
  }

  if (!params.hasRoster) {
    return {
      canEditLineup: false,
      canSubmitWaiverClaim: false,
      canProposeTrade: false,
      canMoveToIr: false,
      platformHref: null,
      platformLabel: 'AllFantasy',
      readOnlyReason: 'You do not have a claimed team in this league yet.',
    }
  }

  return {
    canEditLineup: true,
    canSubmitWaiverClaim: true,
    canProposeTrade: true,
    canMoveToIr: true,
    platformHref: null,
    platformLabel: 'AllFantasy',
    readOnlyReason: null,
  }
}

// ── Engine error copy ────────────────────────────────────────────────────────

/**
 * Canonical engines return terse operator strings (`'Forbidden'`, `'Roster not
 * found'`). Those are correct as API payloads and useless as user copy, so they
 * are translated here and the raw value is kept in `detail` for logs.
 *
 * `'Forbidden'` deserves its specific wording. `matchupCenterService` authorizes
 * on `LeagueTeam.platformUserId`, while this page (and `resolveLeagueAccess`)
 * authorize on `Roster.platformUserId` — two different tables. A member who has
 * a roster but no team record therefore passes the page gate and is rejected by
 * the matchup engine. Telling that user "forbidden" implies they don't belong in
 * their own league, which is both alarming and wrong.
 */
export function humanizeEngineReason(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  switch (value.toLowerCase()) {
    case 'forbidden':
      return 'This league’s matchup data is not linked to your account yet. Your team is connected by roster, but the matchup service also needs a team record for this league.'
    case 'roster not found':
      return 'No roster is linked to your account in this league, so there is no lineup to read.'
    case 'opponent roster missing':
      return 'Your opponent’s roster for this week could not be found, so the matchup cannot be built.'
    case 'league not found':
      return 'This league could not be loaded.'
    case '':
      return 'This data could not be loaded for your team right now.'
    default:
      return value
  }
}

// ── Lineup ───────────────────────────────────────────────────────────────────

export function slotStatusFor(slot: MatchupPlayerSlot): LineupSlotStatus {
  const injury = (slot.injuryStatus ?? '').trim().toUpperCase()
  // Lock beats injury: once a game is underway the designation is no longer actionable.
  if (slot.gameStatus === 'live' || slot.gameStatus === 'final') return 'locked'
  if (injury === 'OUT' || injury === 'IR' || injury === 'SUSPENDED') return 'out'
  if (injury === 'DOUBTFUL') return 'injured'
  if (injury === 'QUESTIONABLE' || injury === 'Q') return 'questionable'
  if (injury === 'BYE') return 'bye'
  return 'ok'
}

export function toLineupPlayer(slot: MatchupPlayerSlot): LineupPlayer {
  return {
    playerId: slot.playerId,
    name: slot.name,
    position: slot.position,
    team: slot.team,
    opponent: slot.opponent,
    headshotUrl: slot.headshotUrl,
    // A player whose game has not started has NO current points — that is not the
    // same as having scored 0.0, and the UI renders the two differently.
    currentPoints: slot.gameStatus === 'upcoming' ? null : slot.currentPoints,
    projectedPoints: Number.isFinite(slot.projectedPoints) ? slot.projectedPoints : null,
    injuryStatus: slot.injuryStatus,
    newsBlurb: slot.newsBlurb,
    weatherSummary: slot.weatherSummary,
    gameLabel: slot.gameLabel,
    gameStatus: slot.gameStatus,
    aiInsight: slot.aiInsight,
  }
}

export function buildLineupView(payload: MatchupCenterPayload): LineupView {
  const starters: LineupSlot[] = payload.left.starters.map((slot, index) => ({
    slotId: `${slot.playerId || 'empty'}-${index}`,
    slotLabel: slot.position,
    player: slot.playerId ? toLineupPlayer(slot) : null,
    status: slot.playerId ? slotStatusFor(slot) : 'empty',
    lockTimeIso: null,
  }))

  const anyProjectionMissing = starters.some((s) => s.player != null && s.player.projectedPoints == null)
  // With no readable slots there is nothing to total. Reporting the payload's 0
  // would render "0.0" as if the lineup were genuinely projected to score nothing.
  const noSlots = starters.length === 0

  return {
    starters,
    // Documented gap, not an oversight: matchupCenterService returns starters only.
    bench: [],
    reserve: [],
    // A total computed over an incomplete set would read as authoritative, so it
    // is withheld rather than under-reported.
    projectedTotal: noSlots || anyProjectionMissing ? null : payload.left.projectedTotal,
    currentTotal: payload.left.totalPoints,
    partial: payload.partialData || anyProjectionMissing,
  }
}

// ── Game plan ────────────────────────────────────────────────────────────────

export const REASON_TITLES: Record<string, string> = {
  empty_starter: 'Fill an empty starting slot',
  injured_starter: 'Injured player in your starting lineup',
  questionable_starter: 'Questionable starter needs monitoring',
  doubtful_starter: 'Doubtful starter likely to sit',
  illegal_slot: 'Ineligible player in a starting slot',
  native_starter_gap: 'Incomplete starting lineup',
  ai_start_sit: 'Better starting option available',
  ai_waiver: 'Waiver target fits a roster need',
  matchup_prep: 'Matchup preparation',
  injury_impact: 'Injury affects your roster',
  war_room: 'War Room flagged this lineup',
  weather_risk: 'Weather risk for a starter',
  fetch_error: 'Lineup could not be fully verified',
}

export function priorityFor(action: LineupActionItem): GamePlanPriority {
  if (action.severity === 'critical' || action.urgency === 'urgent') return 'critical'
  if (action.severity === 'warning' || action.urgency === 'soon') return 'high'
  if (action.urgency === 'normal') return 'medium'
  return 'low'
}

const PRIORITY_ORDER: Record<GamePlanPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * Collapse actions that describe the SAME underlying problem.
 *
 * The lineup scan emits one item per affected slot, so a single "missing 7 starter
 * slots" finding arrives as seven rows with identical titles and identical messages.
 * Rendering all seven overstates how many distinct decisions the manager faces —
 * the count is the most glanceable thing on the page, so inflating it is a real
 * distortion. Grouping is keyed on reason + message so genuinely different problems
 * at the same position stay separate.
 */
function groupEquivalentActions(actions: LineupActionItem[]): Array<{ head: LineupActionItem; slots: string[] }> {
  const groups = new Map<string, { head: LineupActionItem; slots: string[] }>()
  for (const action of actions) {
    const key = `${action.reasonType}::${action.message}`
    const existing = groups.get(key)
    if (existing) {
      if (action.slotLabel && !existing.slots.includes(action.slotLabel)) {
        existing.slots.push(action.slotLabel)
      }
      continue
    }
    groups.set(key, { head: action, slots: action.slotLabel ? [action.slotLabel] : [] })
  }
  return [...groups.values()]
}

export function buildGamePlan(
  actions: LineupActionItem[],
  write: WriteCapability,
  leagueId: string,
): GamePlanItem[] {
  return groupEquivalentActions(actions)
    .map(({ head: action, slots }, index) => {
      // Copy follows capability, never the other way round: on an imported league
      // every affordance points back at the source platform.
      const externalOnly = !write.canEditLineup
      const actionLabel = externalOnly
        ? write.platformLabel
          ? `Open in ${write.platformLabel}`
          : 'Open source platform'
        : 'Set lineup'
      const actionHref = externalOnly ? write.platformHref : `/league/${leagueId}?tab=roster`

      return {
        id: `${action.reasonType}-${action.playerId ?? action.slotId ?? index}`,
        priority: priorityFor(action),
        title: REASON_TITLES[action.reasonType] ?? action.message,
        reason: action.message,
        playerName: action.playerName,
        // Every position the grouped finding touches, so collapsing rows loses no detail.
        slotLabel: slots.length > 0 ? slots.join(', ') : action.slotLabel,
        deadlineIso: action.lockTime,
        confidence: action.confidence,
        expectedGain: action.expectedGain,
        sourceModule: action.sourceModule,
        actionLabel,
        actionHref,
        externalOnly,
      } satisfies GamePlanItem
    })
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
}

// ── Roster strength ──────────────────────────────────────────────────────────

/**
 * Position strength from starter projections only. `leagueRank` stays null
 * because ranking a position across the league needs every rival roster's
 * projections, which this payload does not carry — an unranked bar is honest, a
 * guessed rank is not.
 */
export function buildRosterStrength(payload: MatchupCenterPayload): RosterStrengthView | null {
  const byPosition = new Map<string, { total: number; starters: number }>()
  let missingProjection = false

  for (const slot of payload.left.starters) {
    if (!slot.playerId) continue
    if (!Number.isFinite(slot.projectedPoints)) {
      missingProjection = true
      continue
    }
    const key = slot.position || 'FLEX'
    const cur = byPosition.get(key) ?? { total: 0, starters: 0 }
    cur.total += slot.projectedPoints
    cur.starters += 1
    byPosition.set(key, cur)
  }

  if (byPosition.size === 0) return null

  const positions: PositionStrength[] = [...byPosition.entries()]
    .map(([position, v]) => ({
      position,
      value: Math.round(v.total * 10) / 10,
      leagueRank: null,
      starterCount: v.starters,
      depthCount: 0,
    }))
    .sort((a, b) => b.value - a.value)

  return {
    positions,
    // Withheld whenever any starter projection is missing — a letter grade over
    // partial data would be the most confidently wrong number on the page.
    overallGrade: null,
    gradeBasis: missingProjection
      ? 'Some starters have no projection this week, so an overall grade would be based on incomplete data.'
      : 'Overall grade needs league-wide comparison data, which is not wired for this surface yet.',
  }
}

const NEED_REASONS = new Set(['empty_starter', 'injured_starter', 'doubtful_starter'])

export function buildRosterNeeds(actions: LineupActionItem[]): RosterNeed[] {
  const needs = new Map<string, RosterNeed>()
  for (const action of actions) {
    const position = action.slotLabel
    if (!position || !NEED_REASONS.has(action.reasonType)) continue

    const evidence = action.playerName ? `${action.playerName}: ${action.message}` : action.message
    const existing = needs.get(position)
    if (existing) {
      existing.evidence.push(evidence)
      // An empty slot outranks an injury designation at the same position.
      if (action.reasonType === 'empty_starter') existing.severity = 'critical'
      continue
    }
    needs.set(position, {
      position,
      severity: action.reasonType === 'empty_starter' ? 'critical' : 'high',
      summary:
        action.reasonType === 'empty_starter'
          ? `No player is currently starting at ${position}.`
          : `Your ${position} starter is carrying an injury designation.`,
      evidence: [evidence],
    })
  }
  return [...needs.values()]
}
