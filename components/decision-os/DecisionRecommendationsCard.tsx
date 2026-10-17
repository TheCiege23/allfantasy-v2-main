'use client'

import { ArrowRight, ListChecks } from 'lucide-react'
import type { DecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { localizeRecommendations, translateRecText } from '@/lib/i18n/decision-os/recommendations'
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

/** Dictionary key for the card's description line. */
function descriptionKeyForVariant(variant: DecisionRecommendationsCardProps['variant']) {
  if (variant === 'commissioner') return 'recCard.desc.commissioner'
  if (variant === 'league') return 'recCard.desc.league'
  return 'recCard.desc.default'
}

function whyCopy(model: DecisionRecommendationsViewModel, isInsufficient: boolean, t: (key: string) => string) {
  if (isInsufficient) return t('recCard.why.insufficient')
  const count = model.recommendations.length
  return t(count === 1 ? 'recCard.why.readyOne' : 'recCard.why.readyMany').replace('{{count}}', String(count))
}

export default function DecisionRecommendationsCard({
  model: rawModel,
  variant = 'dashboard',
  compact = false,
}: DecisionRecommendationsCardProps) {
  const { t, language } = useOptionalLanguage()
  const model = localizeRecommendations(rawModel, language)
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
          <DecisionOsBadge icon={ListChecks}>{t('recCard.badge')}</DecisionOsBadge>
          <DecisionOsConfidenceBadge label={model.confidenceLabel} language={language} />
          <DecisionOsUpdatedStamp value={model.lastUpdatedIso} language={language} />
        </div>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-primary md:text-3xl">{model.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">
          {t(descriptionKeyForVariant(variant))}
        </p>
        <DecisionOsTrustNote>
          {t('recCard.trustNote')}
        </DecisionOsTrustNote>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[0.9fr_1.1fr]">
        <aside className="space-y-4">
          <DecisionOsWhyPanel language={language}>{whyCopy(model, isInsufficient, t)}</DecisionOsWhyPanel>

          <DecisionOsEvidenceGrid
            title={t('recCard.evidenceChecked')}
            items={model.evidence.slice(0, 3)}
            columns={1}
            emptyMessage={t('recCard.evidenceEmpty')}
          />

          {isInsufficient && model.insufficientData ? (
            <DecisionOsInsufficientDataCallout
              title={model.insufficientData.title}
              message={model.insufficientData.message}
              missing={model.insufficientData.missing}
              language={language}
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
                    {language === 'es' ? translateRecText(item.priority) : item.priority}
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
                    {t('recCard.suggestedAction')}
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
              title={t('recCard.emptyTitle')}
              description={t('recCard.emptyDescription')}
            />
          )}
        </div>
      </div>
    </section>
  )
}
