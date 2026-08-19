'use client'
/**
 * Fantasy OS Suite — Phase OS-B3: Daily Brief Composition Engine.
 *
 * Purely presentational — takes an already-composed `DailyBrief` (from `composeDailyBrief`,
 * `lib/decision-os/dailyBrief.ts`) and renders it. No fetch, no state, no derivation of its own: every
 * number and sentence it shows was already decided by the pure composition layer. This mirrors
 * `CommissionerAttentionQueue.tsx`'s own "generic in, ranked list out" discipline from OS-B2.
 *
 * Deliberately compact — "favor scanability" (this phase's own instruction). No card-level fetch state
 * to handle: the caller always passes a real, valid `DailyBrief` (an honest all-healthy brief is a
 * valid brief, not a loading placeholder — see `CommissionerCommandCenterSection.tsx`'s own
 * zero-input-while-loading convention).
 */
import { CheckCircle2, Sparkles } from 'lucide-react'
import type { DailyBrief } from '@/lib/decision-os/dailyBrief'
import { DecisionOsBadge, DecisionOsPanel, decisionOsCardClassName, SEVERITY_DOT_CLASS } from './DecisionOsCardPrimitives'

type TodaysBriefCardProps = {
  brief: DailyBrief
  leagueNameById: Map<string, string>
}

export default function TodaysBriefCard({ brief, leagueNameById }: TodaysBriefCardProps) {
  const leagueName = (leagueId: string) => leagueNameById.get(leagueId) ?? leagueId

  return (
    <div className={decisionOsCardClassName} data-testid="todays-brief-card">
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge icon={Sparkles}>Today&apos;s Brief</DecisionOsBadge>
        </div>
        <p className="mt-3 text-lg font-black leading-snug text-primary" data-testid="todays-brief-summary">
          {brief.summary}
        </p>
      </div>

      <div className="space-y-4 p-5">
        {brief.topPriorityItems.length > 0 ? (
          <ul className="space-y-1.5" data-testid="todays-brief-priority-items">
            {brief.topPriorityItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[item.severity]}`}
                  aria-hidden
                />
                <span className="text-secondary">
                  <span className="font-semibold text-primary">{leagueName(item.leagueId)}</span> —{' '}
                  {item.explanation}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted" data-testid="todays-brief-empty">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
            Nothing needs a decision from you today.
          </div>
        )}

        {brief.recommendedActions.length > 0 ? (
          <DecisionOsPanel title="Recommended today">
            <ul
              className="mt-2 space-y-1 text-sm leading-6 text-secondary"
              data-testid="todays-brief-recommended-actions"
            >
              {brief.recommendedActions.map((action) => (
                <li key={action}>• {action}</li>
              ))}
            </ul>
          </DecisionOsPanel>
        ) : null}

        {brief.positiveHighlights.length > 0 ? (
          <div className="flex flex-wrap gap-2" data-testid="todays-brief-positive-highlights">
            {brief.positiveHighlights.map((highlight) => (
              <span
                key={highlight.leagueId}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700"
              >
                {leagueName(highlight.leagueId)} — {highlight.title}
              </span>
            ))}
          </div>
        ) : null}

        {brief.leagueHighlights.length > 0 ? (
          <div className="flex flex-wrap gap-2" data-testid="todays-brief-league-highlights">
            {brief.leagueHighlights.map((highlight) => (
              <span
                key={highlight.leagueId}
                className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-muted px-2.5 py-1 text-xs font-medium text-secondary"
              >
                {leagueName(highlight.leagueId)} — {highlight.direction === 'increasing' ? 'more' : 'less'} active (
                {highlight.eventCountDelta > 0 ? '+' : ''}
                {highlight.eventCountDelta})
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
