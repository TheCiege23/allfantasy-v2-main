'use client'

import { useId } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import type { CommissionerConfidenceLevel, CommissionerRecommendationStatus } from '@/lib/commissioner-ui/contracts'
import { getSeverityStyle, SEVERITY_LABELS } from './severityStyles'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cardsCopy, cosLoaderText, severityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'

const CONFIDENCE_LABELS: Record<CommissionerConfidenceLevel, string> = {
  developing_signal: 'Developing signal',
  moderate: 'Moderate confidence',
  high: 'High confidence',
  very_high: 'Very high confidence',
}

/** Workflow-neutral labels — status is never severity-colored (Status Language, Design Language §14). */
const STATUS_LABELS: Record<CommissionerRecommendationStatus, string> = {
  new: 'New',
  viewed: 'Viewed',
  in_progress: 'In Progress',
  completed: 'Completed',
  dismissed: 'Dismissed',
  expired: 'Expired',
  automated: 'Automated',
  deferred: 'Deferred',
  resolved: 'Resolved',
}

export interface RecommendationCardProps {
  /** What happened. */
  title: string
  /** Why it matters. */
  rationale: string
  severity: SeverityTier
  /** Absent when nothing scored it — see `CommissionerRecommendationContract`. Never defaulted. */
  confidence?: CommissionerConfidenceLevel
  /** Expected impact of acting. Absent when no estimate exists upstream. */
  expectedImpact?: string
  /** Absent when the backend names no specific action; the footer is then not rendered. */
  primaryActionLabel?: string
  /** Optional — Mission Control and League Health's previews omit it, and nothing persists a lifecycle yet. */
  status?: CommissionerRecommendationStatus
  onPrimaryAction?: () => void
  onDismiss?: () => void
  onViewEvidence?: () => void
}

/**
 * The four-part structure required by the Design Constitution §9 — what,
 * why, action, consequence — every recommendation surface in the product
 * uses this same card, per Recommendations Center §6.
 *
 * The card is a `role="group"` named by its own title. Every card renders the
 * same controls (a primary action button, Dismiss, View evidence), so "this
 * recommendation's Send Check-In button" is only expressible as a named region
 * — for a screen reader and for a test alike. It replaces a
 * `closest('[class*=…]')` selector that went red on a purely visual change; see
 * `__tests__/commissioner-os-recommendations.test.tsx`. `useId` rather than a
 * recommendation id because an `aria-labelledby` value is a space-separated id
 * list, and ids from the live queue are not ours to trust.
 *
 * Spanish (2026-10-06): the card's own labels go through `cardsCopy`, and the four
 * recommendation fields through `cosLoaderText` — HERE, once, so every surface that
 * draws this card (Recommendations, League Health, Mission Control) reads the same
 * Spanish without translating the contract itself. Callers pass the English the
 * loader wrote; text the translator does not know passes through unchanged.
 */
export function RecommendationCard({
  title,
  rationale,
  severity,
  confidence,
  expectedImpact,
  primaryActionLabel,
  status,
  onPrimaryAction,
  onDismiss,
  onViewEvidence,
}: RecommendationCardProps) {
  const style = getSeverityStyle(severity)
  const titleId = useId()
  const { language } = useOptionalLanguage()
  const ui = (english: string) => cardsCopy(english, language)

  return (
    <Card role="group" aria-labelledby={titleId} style={{ borderColor: style.border }}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle id={titleId}>{cosLoaderText(title, language)}</CardTitle>
          <div className="flex items-center gap-2">
            {status && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                {ui(STATUS_LABELS[status])}
              </span>
            )}
            <Badge style={{ background: style.bg, color: style.text, borderColor: style.border }}>
              {severityLabelText(severity, SEVERITY_LABELS[severity], language)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {cosLoaderText(rationale, language)}
        </p>
        {/*
          Omitted rather than defaulted. The metadata line used to render unconditionally, so an
          absent confidence printed `undefined · undefined`; filling it with a placeholder would
          have been worse — a confidence level the presentation layer invented for a
          recommendation nothing scored.
        */}
        {confidence || expectedImpact ? (
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>
            {[confidence ? ui(CONFIDENCE_LABELS[confidence]) : null, expectedImpact ? cosLoaderText(expectedImpact, language) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
        {onViewEvidence && (
          <button type="button" onClick={onViewEvidence} className="focus-ring link-themed text-xs">
            {ui('View evidence')}
          </button>
        )}
      </CardContent>
      {/*
        A footer with no named action is no footer. Rendering an empty primary button would put a
        control on the card that says nothing and does nothing — worse than the card simply ending
        at its rationale.
      */}
      {primaryActionLabel || onDismiss ? (
        <CardFooter className="gap-2">
          {primaryActionLabel ? (
            <Button size="sm" onClick={onPrimaryAction}>
              {cosLoaderText(primaryActionLabel, language)}
            </Button>
          ) : null}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              {ui('Dismiss')}
            </Button>
          )}
        </CardFooter>
      ) : null}
    </Card>
  )
}
