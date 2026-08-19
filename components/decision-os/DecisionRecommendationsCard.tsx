'use client'

import { ArrowRight, ListChecks } from 'lucide-react'
import type { DecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'
import {
  DecisionOsBadge,
  DecisionOsConfidenceBadge,
  DecisionOsEmptyState,
  DecisionOsEvidenceGrid,
  DecisionOsInsufficientDataCallout,
  DecisionOsTrustNote,
  DecisionOsUpdatedStamp,
  DecisionOsWhyPanel,
  decisionOsCardClassName,
  decisionOsToneClasses,
} from './DecisionOsCardPrimitives'

type DecisionRecommendationsCardProps = {
  model: DecisionRecommendationsViewModel
  variant?: 'dashboard' | 'league' | 'commissioner' | 'team'
  compact?: boolean
}

// Phase V1.1: was a private `priorityClass` table — migrated onto the shared `decisionOsToneClasses`.
// A clean 4-way match, including 'medium', which was already cyan — the exact hex `--color-info`
// resolves to (`#0e7490`), so this is a semantic-token migration with zero visible color change.
function priorityClass(priority: string): string {
  const value = priority.toLowerCase()
  if (value === 'critical') return decisionOsToneClasses('danger')
  if (value === 'high') return decisionOsToneClasses('warning')
  if (value === 'medium') return decisionOsToneClasses('info')
  return decisionOsToneClasses('neutral')
}

function descriptionForVariant(variant: DecisionRecommendationsCardProps['variant']) {
  if (variant === 'commissioner') {
    return 'A commissioner-safe action queue that stays quiet until evidence supports a move.'
  }
  if (variant === 'league') {
    return 'A short league action queue with priority, impact, difficulty, evidence, and one suggested next step.'
  }
  return 'A short action queue with priority, impact, difficulty, evidence, and one suggested next step.'
}

function whyCopy(model: DecisionRecommendationsViewModel, isInsufficient: boolean) {
  if (isInsufficient) {
    return 'This card is shown to explain why no grounded moves are ready yet. It will not invent an action just to fill the space.'
  }
  return `Shown because ${model.recommendations.length} grounded move${model.recommendations.length === 1 ? '' : 's'} passed the deterministic evidence checks for this surface.`
}

export default function DecisionRecommendationsCard({
  model,
  variant = 'dashboard',
  compact = false,
}: DecisionRecommendationsCardProps) {
  const isInsufficient = model.status === 'insufficient-data'
  const recommendations = model.recommendations.slice(0, compact ? 2 : 3)

  return (
    <section
      data-testid={`decision-recommendations-card-${variant}`}
      className={decisionOsCardClassName}
      aria-label={`${model.title}: ${model.subtitle}`}
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge icon={ListChecks}>Recommended Moves</DecisionOsBadge>
          <DecisionOsConfidenceBadge label={model.confidenceLabel} />
          <DecisionOsUpdatedStamp value={model.lastUpdatedIso} />
        </div>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-primary md:text-3xl">{model.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">
          {descriptionForVariant(variant)}
        </p>
        <DecisionOsTrustNote>
          Only grounded recommendations are shown here. If evidence is limited, the card says so instead of filling in guesses.
        </DecisionOsTrustNote>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[0.9fr_1.1fr]">
        <aside className="space-y-4">
          <DecisionOsWhyPanel>{whyCopy(model, isInsufficient)}</DecisionOsWhyPanel>

          <DecisionOsEvidenceGrid
            title="Evidence checked"
            items={model.evidence.slice(0, 3)}
            columns={1}
            emptyMessage="No recommendation evidence is available yet."
          />

          {isInsufficient && model.insufficientData ? (
            <DecisionOsInsufficientDataCallout
              title={model.insufficientData.title}
              message={model.insufficientData.message}
              missing={model.insufficientData.missing}
            />
          ) : null}
        </aside>

        <div className="space-y-3">
          {recommendations.length > 0 ? (
            recommendations.map((item, index) => (
              <article
                key={`${item.title}-${index}`}
                className="rounded-xl border border-subtle bg-surface-muted p-4 transition hover:border-brand-primary/20 hover:bg-surface-hover motion-reduce:transition-none"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${priorityClass(item.priority)}`}>
                    {item.priority}
                  </span>
                  <span className="rounded-full border border-subtle bg-surface px-2.5 py-1 text-[11px] font-semibold text-secondary">
                    {item.difficulty}
                  </span>
                  {item.completionStatus ? (
                    <span className="rounded-full border border-subtle bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted">
                      {item.completionStatus}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-3 text-lg font-black text-primary">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-secondary">{item.expectedImpact}</p>
                <div className="mt-3 rounded-xl border border-brand-primary/20 bg-brand-primary/10 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-primary">
                    Suggested action
                  </p>
                  <p className="mt-1 flex items-start gap-2 text-sm font-semibold text-primary">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
                    <span>{item.suggestedAction}</span>
                  </p>
                </div>
                {item.evidence.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.evidence.map((evidence) => (
                      <span key={evidence} className="rounded-full border border-subtle bg-surface px-2.5 py-1 text-[11px] text-secondary">
                        {evidence}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <DecisionOsEmptyState
              title="No grounded moves are ready yet."
              description="Once supported league or manager evidence produces a deterministic action, it will appear here with its source context."
            />
          )}
        </div>
      </div>
    </section>
  )
}
