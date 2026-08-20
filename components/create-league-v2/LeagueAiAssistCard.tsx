'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { LeagueAiRecommendation } from '@/lib/create-league-v2/ai/types'
import { inferLeagueAiRecommendationFromDescription } from '@/lib/create-league-v2/ai/heuristic-infer'
import { GlassCard, InnerPanel, SectionHeader, PrimaryCTA, SecondaryButton } from '@/components/create-league-v2/primitives'
import { trackLeagueCreationEvent } from '@/lib/analytics/league-creation/track'

export interface LeagueAiAssistCardProps {
  accent: AccentTone
  /** Applies normalized recommendation through the canonical hydrate path (no auto-submit). */
  onApplyRecommendation: (rec: LeagueAiRecommendation) => void
  /** Optional injector for tests; defaults to heuristic infer (no network). */
  inferFromDescription?: (description: string) => LeagueAiRecommendation
}

function formatExtracted(rec: LeagueAiRecommendation): string {
  const entries = Object.entries(rec.extractedSettings).filter(([, v]) => v !== undefined && v !== null)
  if (entries.length === 0) return 'None'
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')
}

export function LeagueAiAssistCard({
  accent,
  onApplyRecommendation,
  inferFromDescription = inferLeagueAiRecommendationFromDescription,
}: LeagueAiAssistCardProps) {
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState<LeagueAiRecommendation | null>(null)
  const lastRecommendationRef = useRef<LeagueAiRecommendation | null>(null)
  const appliedAfterLastInferRef = useRef(false)

  const runInfer = useCallback(() => {
    const rec = inferFromDescription(description)
    lastRecommendationRef.current = rec
    appliedAfterLastInferRef.current = false
    trackLeagueCreationEvent('league_create_ai_recommendation_requested', {
      aiDescriptionCharCount: description.trim().length,
      aiRecommendedTemplateId: rec.recommendedTemplateId,
      aiUnsupportedRequestCount: rec.unsupportedRequests.length,
      aiConfidence: rec.confidence,
    })
    if (rec.unsupportedRequests.length > 0) {
      trackLeagueCreationEvent('league_create_ai_unsupported_requests', {
        aiUnsupportedRequestCount: rec.unsupportedRequests.length,
      })
    }
    setPending(rec)
  }, [description, inferFromDescription])

  const apply = useCallback(() => {
    if (!pending) return
    appliedAfterLastInferRef.current = true
    onApplyRecommendation(pending)
  }, [onApplyRecommendation, pending])

  useEffect(
    () => () => {
      const rec = lastRecommendationRef.current
      if (!rec || appliedAfterLastInferRef.current) return
      const meaningful =
        rec.recommendedTemplateId != null ||
        Object.keys(rec.extractedSettings).length > 0 ||
        rec.unsupportedRequests.length > 0
      if (!meaningful) return
      trackLeagueCreationEvent('league_create_ai_recommendation_ignored', {
        aiRecommendedTemplateId: rec.recommendedTemplateId,
        aiUnsupportedRequestCount: rec.unsupportedRequests.length,
      })
    },
    [],
  )

  const canGet = description.trim().length > 0
  const canApply =
    pending != null &&
    (pending.recommendedTemplateId != null || Object.keys(pending.extractedSettings).length > 0)

  return (
    <GlassCard data-testid="league-ai-assist-card">
      <SectionHeader
        title="Describe your league"
        hint="Plain-language intent only. Output is structured suggestions — nothing is applied until you choose Apply. No auto-create."
      />
      <label htmlFor="league-ai-description" className="sr-only">
        Describe the league you want
      </label>
      <textarea
        id="league-ai-description"
        data-testid="league-ai-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="e.g. casual office redraft, 12 teams, NFL…"
        className="mb-4 w-full resize-y rounded-xl border border-white/[0.08] bg-[#060b18]/90 px-3 py-2.5 text-sm leading-relaxed text-white/90 placeholder:text-white/35 focus:border-cyan-400/40 focus:outline-none focus:ring-1 focus:ring-cyan-400/25"
      />
      <div className="flex flex-wrap gap-3" data-testid="league-ai-get-rec">
        <SecondaryButton onClick={runInfer} disabled={!canGet}>
          Get recommendation
        </SecondaryButton>
      </div>

      {pending ? (
        <InnerPanel className="mt-5 space-y-3 border border-white/[0.06]">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">AI recommendation</p>
          <p className="text-sm leading-relaxed text-white/80">{pending.explanation}</p>
          <dl className="grid gap-2 text-xs text-white/65 sm:grid-cols-2">
            <div>
              <dt className="text-white/40">Template</dt>
              <dd className="font-mono text-white/85">{pending.recommendedTemplateId ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-white/40">Confidence</dt>
              <dd className="tabular-nums text-white/85">{Math.round(pending.confidence * 100)}%</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-white/40">Extracted settings</dt>
              <dd className="text-white/80">{formatExtracted(pending)}</dd>
            </div>
          </dl>
          {pending.warnings.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-xs text-amber-100/90" data-testid="league-ai-warnings">
              {pending.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {pending.unsupportedRequests.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-xs text-rose-100/85" data-testid="league-ai-unsupported">
              {pending.unsupportedRequests.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="pt-2" data-testid="league-ai-apply">
            <PrimaryCTA accent={accent} onClick={apply} disabled={!canApply}>
              Apply recommendation
            </PrimaryCTA>
            <p className="mt-2 text-[11px] leading-relaxed text-white/38">
              Review the summary rail, then create when you are ready — same validation as always.
            </p>
          </div>
        </InnerPanel>
      ) : null}
    </GlassCard>
  )
}
