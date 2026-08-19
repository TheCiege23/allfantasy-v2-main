'use client'
/**
 * Fantasy OS Suite — Phase OS-B1: Commissioner Multi-League Command Center.
 *
 * Ranks the commissioner's own leagues by real Decision OS output — no new intelligence computed
 * here, purely sorting/filtering `CommissionerCommandCenterLeagueSummary[]` (already-real Mission
 * Control fields). Leagues without an available Decision OS read are excluded from ranking entirely
 * (never ranked as "0" or "last" — that would fabricate a position for data that doesn't exist).
 *
 * Phase OS-B6: reduced from 4 ranking panels to 2 ("Needs the most attention" + "Most active leagues").
 * The original "Healthiest leagues" and "Least active leagues" panels were dropped — for a commissioner
 * with only 1-2 leagues (the common case), those two panels showed the EXACT SAME leagues their
 * counterpart already showed (the healthiest league in a 2-league account is trivially also the
 * "not-least-healthy" one), a real instance of the "duplicated sections" clutter this phase's own UX
 * principles call out. "Healthiest" is also already covered, non-redundantly, by Today's Brief's own
 * positive highlights (`high_league_health` signals) — dropping it here loses no real information, only
 * a duplicate presentation of it. The two panels kept both answer "what should I do next?" (needs
 * attention) or add genuine context ("most active") rather than restating a positive already shown
 * elsewhere.
 */
import type { CommissionerCommandCenterLeagueSummary } from '@/lib/decision-os/commissionerCommandCenter'
import { DecisionOsEmptyState, DecisionOsPanel } from './DecisionOsCardPrimitives'

type CommissionerLeagueHealthRankingProps = {
  summaries: CommissionerCommandCenterLeagueSummary[]
  leagueNameById: Map<string, string>
}

type RankedEntry = { leagueId: string; label: string; display: string }

function RankedList({
  title,
  entries,
  emptyMessage,
  testId,
}: {
  title: string
  entries: RankedEntry[]
  emptyMessage: string
  testId: string
}) {
  return (
    <DecisionOsPanel title={title}>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-muted" data-testid={`${testId}-empty`}>
          {emptyMessage}
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5" data-testid={testId}>
          {entries.map((entry) => (
            <li key={entry.leagueId} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-semibold text-primary">{entry.label}</span>
              <span className="shrink-0 text-xs text-muted">{entry.display}</span>
            </li>
          ))}
        </ol>
      )}
    </DecisionOsPanel>
  )
}

export default function CommissionerLeagueHealthRanking({
  summaries,
  leagueNameById,
}: CommissionerLeagueHealthRankingProps) {
  const available = summaries.filter((s) => s.available)

  if (summaries.length === 0) {
    return (
      <DecisionOsEmptyState
        title="League health ranking is loading"
        description="Once your leagues resolve, the healthiest and least healthy will appear here."
      />
    )
  }

  if (available.length === 0) {
    return (
      <div data-testid="league-health-ranking-unavailable">
        <DecisionOsEmptyState
          title="No league health data available yet"
          description="A health read for your leagues couldn't be loaded right now."
        />
      </div>
    )
  }

  const label = (leagueId: string) => leagueNameById.get(leagueId) ?? leagueId

  const scored = available.filter((s) => s.leagueHealthScore != null)
  const byHealthAsc = [...scored].sort((a, b) => (a.leagueHealthScore ?? 0) - (b.leagueHealthScore ?? 0))
  const leastHealthy: RankedEntry[] = byHealthAsc
    .slice(0, 3)
    .map((s) => ({ leagueId: s.leagueId, label: label(s.leagueId), display: `${s.leagueHealthScore}/100` }))

  const byActivity = available
    .map((s) => ({ ...s, totalActivity: s.tradeCount + s.waiverClaimCount + s.rosterActivityCount }))
    .sort((a, b) => b.totalActivity - a.totalActivity)
  const mostActive: RankedEntry[] = byActivity
    .slice(0, 3)
    .map((s) => ({ leagueId: s.leagueId, label: label(s.leagueId), display: `${s.totalActivity} events` }))

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="league-health-ranking">
      <RankedList
        title="Needs the most attention"
        entries={leastHealthy}
        emptyMessage="No scored leagues yet."
        testId="league-health-ranking-least-healthy"
      />
      <RankedList
        title="Most active leagues"
        entries={mostActive}
        emptyMessage="No activity recorded yet."
        testId="league-health-ranking-most-active"
      />
    </div>
  )
}
