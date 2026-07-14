/**
 * User OS League-Specific Intelligence Wiring phase — Part 6, waiver domain.
 *
 * Deliberately does NOT call `lib/waiver-engine/waiver-scoring.ts`'s
 * `scoreWaiverCandidates`/`computeFaabBid` this phase. Those are real,
 * production-wired (`/api/waiver-ai/engine`, this phase's Part 1
 * inventory), but their inputs (`WaiverRosterPlayer.age/value/assetValue`,
 * a real free-agent candidate pool with player valuations) are not present
 * in `UserOsContext` — building them safely would mean re-deriving player
 * valuation logic, which is exactly the "do not duplicate" this phase is
 * guarded against. Rather than fabricate age/value fields to force-fit the
 * real engine's signature, this generator surfaces a real, honest,
 * player-name-free "positional need" signal from canonical roster position
 * counts — and explicitly does NOT name a specific free agent to add,
 * since it has no safe access to a real, current free-agent pool. The
 * real `/api/waiver-ai/engine` route remains the authoritative surface for
 * actual player-level FAAB/pickup suggestions.
 */
import type { UserOsContext, RosterPlayerEntry } from '../userOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../types'

const OUT_STATUSES = ['out', 'ir', 'injured reserve', 'suspended', 'doubtful']

function isLikelyOut(injuryStatus: string | undefined, cachedStatus: string): boolean {
  const s = (injuryStatus ?? cachedStatus ?? '').toLowerCase()
  return OUT_STATUSES.some((needle) => s.includes(needle))
}

export function generateWaiverRecommendations(context: UserOsContext, generatedAt: string): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('waiver') || !context.lineup || !context.teamId) return []

  const recommendations: LeagueRecommendation[] = []
  const fullRoster: RosterPlayerEntry[] = [...context.lineup.starters, ...context.lineup.bench, ...context.lineup.ir]

  const byPosition = new Map<string, RosterPlayerEntry[]>()
  for (const p of fullRoster) {
    if (!p.position) continue
    const arr = byPosition.get(p.position) ?? []
    arr.push(p)
    byPosition.set(p.position, arr)
  }

  for (const [position, players] of byPosition) {
    const healthyCount = players.filter((p) => !isLikelyOut(context.injuryByPlayerId.get(p.id)?.status, p.status)).length
    if (healthyCount > 0) continue // Only a real, unambiguous gap — zero healthy players at this position.
    const priority = 'high' as const
    if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) continue

    recommendations.push(
      buildRecommendation({
        leagueId: context.canonicalLeagueId,
        teamId: context.teamId,
        rosterId: context.rosterId ?? undefined,
        domain: 'waiver',
        type: 'positional_need',
        key: `no-healthy-${position}`,
        priority,
        title: `No healthy ${position} on your roster`,
        summary: `Every ${position} you have rostered is currently listed as out, doubtful, IR, or suspended. Consider a waiver add at this position.`,
        rationale: [`${players.length} ${position}(s) rostered, 0 currently healthy per the live injury report.`],
        evidence: [
          { label: `${position} rostered`, detail: String(players.length), source: 'Roster.playerData' },
          { label: `${position} healthy`, detail: '0', source: 'InjuryReportRecord' },
        ],
        playerIds: players.map((p) => p.id),
        sourceFreshness: context.syncFreshness,
        // Never names a specific free agent — no safe, real free-agent-pool access this phase.
        executionCapability: 'recommendation_only',
        action:
          context.provider === 'allfantasy'
            ? { label: 'Browse free agents', href: `/league/${context.canonicalLeagueId}?tab=players`, payloadType: 'waiver_browse' }
            : undefined,
        generatedAt,
      })
    )
  }

  return recommendations
}
