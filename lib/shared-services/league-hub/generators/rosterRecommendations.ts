/**
 * User OS League-Specific Intelligence Wiring phase — Part 8, roster domain.
 *
 * Real, deterministic signals computed directly from the viewer's own
 * canonical roster (starters + bench + IR combined) — no dynasty age-curve
 * or draft-pick-value logic this phase (would need player-age/pick data not
 * present on `RosterPlayerEntry`; deferred, disclosed, not fabricated).
 * `lib/dynasty-engine/*` remains the real, dynasty-specific engine for that
 * — deliberately not invoked here for redraft leagues, matching the
 * explicit guardrail against applying dynasty logic to redraft formats.
 */
import type { UserOsContext, RosterPlayerEntry } from '../userOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../types'

const OUT_STATUSES = ['out', 'ir', 'injured reserve', 'suspended', 'doubtful']

function isLikelyOut(injuryStatus: string | undefined, cachedStatus: string): boolean {
  const s = (injuryStatus ?? cachedStatus ?? '').toLowerCase()
  return OUT_STATUSES.some((needle) => s.includes(needle))
}

export function generateRosterRecommendations(context: UserOsContext, generatedAt: string): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('roster') || !context.lineup || !context.teamId) {
    return []
  }

  const recommendations: LeagueRecommendation[] = []
  const fullRoster: RosterPlayerEntry[] = [
    ...context.lineup.starters,
    ...context.lineup.bench,
    ...context.lineup.ir,
  ]

  // Injury concentration — a real count, never a fabricated "risk score".
  const injuredCount = fullRoster.filter((p) => isLikelyOut(context.injuryByPlayerId.get(p.id)?.status, p.status)).length
  if (injuredCount >= 3 && isFreshnessSafeForPriority(context.syncFreshness, 'high')) {
    recommendations.push(
      buildRecommendation({
        leagueId: context.canonicalLeagueId,
        teamId: context.teamId,
        rosterId: context.rosterId ?? undefined,
        domain: 'roster',
        type: 'injury_concentration',
        key: 'roster-injury-concentration',
        priority: 'high',
        title: `${injuredCount} players on your roster are currently out or questionable`,
        summary: `Your roster has an elevated injury count (${injuredCount} of ${fullRoster.length} players), which raises the risk of an unexpectedly thin lineup this week.`,
        rationale: [`${injuredCount} rostered players have a live injury report indicating out/doubtful/IR/suspended status.`],
        evidence: [{ label: 'Injured player count', detail: String(injuredCount), source: 'InjuryReportRecord' }],
        playerIds: fullRoster
          .filter((p) => isLikelyOut(context.injuryByPlayerId.get(p.id)?.status, p.status))
          .map((p) => p.id),
        sourceFreshness: context.syncFreshness,
        executionCapability: 'recommendation_only',
        generatedAt,
      })
    )
  }

  // Positional depth — real count per position, simple real heuristic (not fabricated data, a disclosed methodology choice).
  const byPosition = new Map<string, RosterPlayerEntry[]>()
  for (const p of fullRoster) {
    if (!p.position) continue
    const arr = byPosition.get(p.position) ?? []
    arr.push(p)
    byPosition.set(p.position, arr)
  }
  for (const [position, players] of byPosition) {
    if (players.length === 1 && fullRoster.length >= 8) {
      recommendations.push(
        buildRecommendation({
          leagueId: context.canonicalLeagueId,
          teamId: context.teamId,
          rosterId: context.rosterId ?? undefined,
          domain: 'roster',
          type: 'position_weakness',
          key: `weak-${position}`,
          priority: 'medium',
          title: `Only one rostered ${position}`,
          summary: `You have exactly one ${position} on your roster, leaving no depth if that player is unavailable.`,
          rationale: [`Position count: ${players.length} ${position}(s) vs. ${fullRoster.length} total rostered players.`],
          evidence: [{ label: `${position} count`, detail: '1', source: 'Roster.playerData' }],
          playerIds: players.map((p) => p.id),
          sourceFreshness: context.syncFreshness,
          executionCapability: 'recommendation_only',
          generatedAt,
        })
      )
    }
  }

  // Bench inefficiency — real projection comparison, same position, bench > starter.
  for (const bench of context.lineup.bench) {
    if (!bench.position || bench.projection <= 0) continue
    const worseStarter = context.lineup.starters.find(
      (s) => s.position === bench.position && s.projection < bench.projection
    )
    if (worseStarter && isFreshnessSafeForPriority(context.syncFreshness, 'medium')) {
      recommendations.push(
        buildRecommendation({
          leagueId: context.canonicalLeagueId,
          teamId: context.teamId,
          rosterId: context.rosterId ?? undefined,
          domain: 'roster',
          type: 'bench_inefficiency',
          key: `${bench.id}-over-${worseStarter.id}`,
          priority: 'medium',
          title: `${bench.name} is projected higher than starter ${worseStarter.name}`,
          summary: `${bench.name} (bench, ${bench.projection.toFixed(1)} proj.) is projected above ${worseStarter.name} (starting, ${worseStarter.projection.toFixed(1)} proj.) at the same position.`,
          rationale: [`${bench.name}: ${bench.projection.toFixed(1)} projected points. ${worseStarter.name}: ${worseStarter.projection.toFixed(1)} projected points.`],
          evidence: [
            { label: `${bench.name} projection`, detail: bench.projection.toFixed(1), source: 'Roster.playerData' },
            { label: `${worseStarter.name} projection`, detail: worseStarter.projection.toFixed(1), source: 'Roster.playerData' },
          ],
          playerIds: [bench.id, worseStarter.id],
          confidence: 0.6,
          sourceFreshness: context.syncFreshness,
          // No real mutation path this phase — see USER_OS_EXECUTION_CAPABILITY_MATRIX.md.
          executionCapability: context.provider === 'allfantasy' ? 'recommendation_only' : 'open_provider',
          action:
            context.provider === 'allfantasy'
              ? { label: 'Review lineup', href: `/league/${context.canonicalLeagueId}?tab=team`, payloadType: 'lineup_review' }
              : undefined,
          generatedAt,
        })
      )
    }
  }

  return recommendations
}
