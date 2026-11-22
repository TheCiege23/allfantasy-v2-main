import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { sortAttentionSignals } from '@/lib/decision-os/attentionSignals'

/**
 * The Command Center's attention signals, folded into Your week (2026-11-14, owner's call).
 *
 * The Manager Hub (`/manager-hub`) was a second cross-league "what needs me" page beside Your week.
 * The owner's direction is that the decision backbone stays invisible and feeds the screen people
 * already use, so the signals Your week did NOT already cover now render inside its guide. The
 * Manager Hub page stays, for white-label tenants.
 *
 * WHICH SIGNALS. Only the Survivor format signals today — votes due, a closing speech owed, a
 * challenge locking unanswered, a trade window closing, a side-game pick due. Nothing else on
 * /core/week says any of that. The rest of the attention queue was left out on purpose:
 *   - lineups, deadlines and sync trouble are already the guide's own rows and the Blueprint's;
 *   - `manager_engagement_risk` describes the viewer to themselves and is built from an event store
 *     that is sparse in production (DashUserOs's header records the same coverage gap);
 *   - `manager_recommendation` needs a per-league User OS read on every visit to a hot page.
 *
 * PURE: the page loads the signals (`loadSurvivorFormatSignals`), this only orders, caps and labels
 * them. A signal for a league not in the viewer's list is dropped rather than linked blind.
 */

export type WeekNeed = {
  id: string
  leagueId: string
  leagueName: string
  title: string
  /** The action to take when the signal names one, otherwise its explanation. */
  detail: string
  tone: 'urgent' | 'soon' | 'info'
  href: string
}

export const WEEK_NEEDS_LIMIT = 6

function toneFor(severity: DecisionOsAttentionSignal['severity']): WeekNeed['tone'] {
  if (severity === 'critical' || severity === 'high') return 'urgent'
  if (severity === 'medium') return 'soon'
  return 'info'
}

export function weekNeedsFromSignals(
  signals: readonly DecisionOsAttentionSignal[],
  leagues: ReadonlyArray<{ id: string; name: string | null | undefined }>,
  limit: number = WEEK_NEEDS_LIMIT,
): WeekNeed[] {
  const names = new Map(leagues.map((l) => [l.id, l.name?.trim() || null]))
  const out: WeekNeed[] = []
  const seen = new Set<string>()
  for (const s of sortAttentionSignals(signals)) {
    if (out.length >= limit) break
    if (seen.has(s.id) || !names.has(s.leagueId)) continue
    seen.add(s.id)
    out.push({
      id: s.id,
      leagueId: s.leagueId,
      leagueName: names.get(s.leagueId) ?? 'League',
      title: s.title,
      detail: s.recommendedAction ?? s.explanation,
      tone: toneFor(s.severity),
      href: `/core?league=${encodeURIComponent(s.leagueId)}`,
    })
  }
  return out
}
