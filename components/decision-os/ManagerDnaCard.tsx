'use client'

import { Brain, Info, Target } from 'lucide-react'
import type { ManagerDnaViewModel } from '@/lib/decision-os/manager-dna'
import {
  DecisionOsBadge,
  DecisionOsConfidenceBadge,
  DecisionOsEmptyState,
  DecisionOsEvidenceGrid,
  DecisionOsInsufficientDataCallout,
  DecisionOsPanel,
  DecisionOsTrustNote,
  DecisionOsUpdatedStamp,
  DecisionOsWhyPanel,
  decisionOsCardClassName,
} from './DecisionOsCardPrimitives'

type ManagerDnaCardProps = {
  profile: ManagerDnaViewModel
  variant?: 'dashboard' | 'league' | 'commissioner' | 'team'
  compact?: boolean
}

function descriptionForVariant(variant: ManagerDnaCardProps['variant']) {
  if (variant === 'commissioner') {
    return 'A commissioner-friendly read on manager habits for better reminders, nudges, and league care.'
  }
  if (variant === 'league') {
    return 'A plain-language read on how this manager tends to decide, transact, take risk, and stay engaged in this league.'
  }
  return 'A plain-language read on how this manager tends to decide, transact, take risk, and stay engaged.'
}

function whyCopy(profile: ManagerDnaViewModel, isInsufficient: boolean) {
  if (isInsufficient) {
    return 'This profile is intentionally quiet until enough real manager activity exists to describe a pattern.'
  }
  return `Shown because the available behavior history supports a ${profile.primaryIdentity} profile with ${profile.confidenceLabel.toLowerCase()} evidence confidence.`
}

export default function ManagerDnaCard({ profile, variant = 'dashboard', compact = false }: ManagerDnaCardProps) {
  const isInsufficient = profile.status === 'insufficient-data'
  const traits = profile.traits.slice(0, compact ? 3 : 5)

  return (
    <section
      data-testid={`manager-dna-card-${variant}`}
      className={decisionOsCardClassName}
      aria-label={`${profile.title}: ${profile.primaryIdentity}`}
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge icon={Brain}>Manager DNA</DecisionOsBadge>
          <DecisionOsConfidenceBadge label={profile.confidenceLabel} />
          <DecisionOsUpdatedStamp value={profile.lastUpdatedIso} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{profile.subtitle}</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-primary md:text-3xl">
              {profile.primaryIdentity}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">
              {descriptionForVariant(variant)}
            </p>
            <DecisionOsTrustNote>
              This profile is descriptive, not a judgment. It is based on available behavior evidence and stays limited when history is thin.
            </DecisionOsTrustNote>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:min-w-[320px]">
            <MiniMetric label="Decision" value={profile.decisionStyle} />
            <MiniMetric label="Transactions" value={profile.transactionStyle} />
            <MiniMetric label="Risk" value={profile.riskTendency} />
            <MiniMetric label="Reliability" value={profile.engagementReliability} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <DecisionOsWhyPanel>{whyCopy(profile, isInsufficient)}</DecisionOsWhyPanel>

          {isInsufficient && profile.insufficientData ? (
            <DecisionOsInsufficientDataCallout
              title={profile.insufficientData.title}
              message={profile.insufficientData.message}
              missing={profile.insufficientData.missing}
            />
          ) : null}

          <DecisionOsEvidenceGrid
            title="Supporting evidence"
            items={profile.evidence.slice(0, 3)}
            columns={3}
          />

          <DecisionOsPanel title="Top traits" className="bg-surface-muted">
            {traits.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {traits.map((trait) => (
                  <span
                    key={`${trait.label}-${trait.strength}`}
                    className="rounded-full border border-subtle bg-surface px-3 py-1 text-xs font-semibold text-secondary"
                  >
                    {trait.label} / {trait.strength}
                  </span>
                ))}
              </div>
            ) : (
              <DecisionOsEmptyState
                icon={Info}
                title="Traits need more history."
                description="Weekly behavior, transaction, and lineup signals will populate this once they are grounded."
              />
            )}
          </DecisionOsPanel>
        </div>

        <aside className="rounded-xl border border-brand-primary/20 bg-brand-primary/10 p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-brand-primary">
            <Target className="h-4 w-4" aria-hidden />
            {variant === 'commissioner' ? 'Commissioner use' : 'Coaching focus'}
          </p>
          <p className="mt-3 text-sm leading-6 text-primary">{profile.coachingFocus}</p>
          <p className="mt-4 text-xs leading-5 text-muted">
            Use this as a conversation aid, not a label. It should make fantasy easier, clearer, and more fun.
          </p>
        </aside>
      </div>
    </section>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-subtle bg-surface px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-black text-primary">{value}</p>
    </div>
  )
}
