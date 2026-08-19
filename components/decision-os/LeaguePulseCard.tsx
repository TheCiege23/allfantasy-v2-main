'use client'

import Link from 'next/link'
import { Activity, ArrowRight, Info, Sparkles } from 'lucide-react'
import type { LeaguePulseTone, LeaguePulseViewModel } from '@/lib/decision-os/league-pulse'
import {
  DecisionOsBadge,
  DecisionOsConfidenceBadge,
  DecisionOsEvidenceGrid,
  DecisionOsInsufficientDataCallout,
  DecisionOsPanel,
  DecisionOsTrustNote,
  DecisionOsUpdatedStamp,
  DecisionOsWhyPanel,
  decisionOsCardClassName,
  decisionOsToneClasses,
} from './DecisionOsCardPrimitives'

type LeaguePulseCardProps = {
  pulse: LeaguePulseViewModel
  variant?: 'dashboard' | 'league' | 'commissioner'
  compact?: boolean
}

// Phase V1.1: was 2 private tone tables (`toneClass`, `statusClasses`) — both migrated onto the shared
// `decisionOsToneClasses`. `LeaguePulseTone` (positive/warning/danger/neutral, `lib/decision-os/league-pulse.ts`)
// and `LeaguePulseViewModel['status']` (healthy/watch/at-risk/insufficient-data) are real, pre-existing
// domain vocabularies with their own meaning to the business logic — kept as-is, not renamed, only
// translated to the shared tone at the render boundary.
function metricToneClasses(tone: LeaguePulseTone): string {
  if (tone === 'positive') return decisionOsToneClasses('good')
  if (tone === 'warning') return decisionOsToneClasses('warning')
  if (tone === 'danger') return decisionOsToneClasses('danger')
  return decisionOsToneClasses('neutral')
}

function statusClasses(status: LeaguePulseViewModel['status']): string {
  if (status === 'healthy') return decisionOsToneClasses('good')
  if (status === 'watch') return decisionOsToneClasses('warning')
  if (status === 'at-risk') return decisionOsToneClasses('danger')
  return decisionOsToneClasses('neutral')
}

export default function LeaguePulseCard({ pulse, variant = 'dashboard', compact = false }: LeaguePulseCardProps) {
  const isInsufficient = pulse.status === 'insufficient-data'
  const evidencePreview = pulse.evidence.slice(0, compact ? 3 : 4)
  const derivationPreview = pulse.derivation.slice(0, compact ? 2 : 3)

  return (
    <section
      data-testid={`league-pulse-card-${variant}`}
      className={decisionOsCardClassName}
      aria-label={`${pulse.title}: ${pulse.statusLabel}`}
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge icon={Sparkles}>{pulse.eyebrow}</DecisionOsBadge>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClasses(pulse.status)}`}>
            {isInsufficient ? <Info className="h-3.5 w-3.5" aria-hidden /> : <Activity className="h-3.5 w-3.5" aria-hidden />}
            {pulse.statusLabel}
          </span>
          <DecisionOsConfidenceBadge label={pulse.confidenceLabel} />
          <DecisionOsUpdatedStamp value={pulse.lastUpdatedIso} includeTime />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{pulse.title}</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-primary md:text-3xl">
              {pulse.headline}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary">{pulse.summary}</p>
            <DecisionOsTrustNote>
              This pulse is evidence-backed and deterministic. Limited league data lowers confidence instead of producing unsupported claims.
            </DecisionOsTrustNote>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[280px]">
            {pulse.metrics.slice(0, 3).map((metric) => (
              <div key={metric.label} className={`min-w-0 rounded-xl border px-3 py-2 ${metricToneClasses(metric.tone)}`}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-80">{metric.label}</p>
                <p className="mt-1 break-words text-lg font-black">{metric.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <DecisionOsWhyPanel>{pulse.why}</DecisionOsWhyPanel>

          {isInsufficient && pulse.insufficientData ? (
            <DecisionOsInsufficientDataCallout
              title={pulse.insufficientData.title}
              message={pulse.insufficientData.message}
              missing={pulse.insufficientData.missing}
            />
          ) : null}

          <DecisionOsEvidenceGrid title="Based on" items={evidencePreview} columns={2} />
        </div>

        <aside className="space-y-4">
          <DecisionOsPanel title="Decision path" className="bg-surface-muted">
            <ol className="mt-3 space-y-2">
              {derivationPreview.map((step, index) => (
                <li key={step} className="flex gap-2 text-sm leading-5 text-secondary">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-bold text-muted">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </DecisionOsPanel>

          <div className="rounded-xl border border-brand-primary/20 bg-brand-primary/10 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-primary">Next action</p>
            <p className="mt-2 text-sm font-bold text-primary">{pulse.nextAction.label}</p>
            <p className="mt-1 text-sm leading-6 text-secondary">{pulse.nextAction.detail}</p>
            {pulse.nextAction.href ? (
              <Link
                href={pulse.nextAction.href}
                className="focus-ring mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-content-inverse transition hover:bg-brand-strong"
              >
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  )
}
