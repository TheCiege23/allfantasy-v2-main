'use client'

import { useEffect, useRef } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { LeagueCreationTemplateId } from '@/lib/create-league-v2/templates/types'
import { listLeagueCreationTemplates } from '@/lib/create-league-v2/templates/catalog'
import { GlassCard, SectionHeader } from '@/components/create-league-v2/primitives'
import { trackLeagueCreationEvent } from '@/lib/analytics/league-creation/track'

const complexityStyles: Record<string, string> = {
  casual: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100/90',
  moderate: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100/90',
  advanced: 'border-amber-400/25 bg-amber-500/10 text-amber-100/90',
}

export function TemplateModeBrowser({
  accent,
  onSelectTemplate,
}: {
  accent: AccentTone
  onSelectTemplate: (id: LeagueCreationTemplateId) => void
}) {
  const templates = listLeagueCreationTemplates()
  const listViewSent = useRef(false)
  const previewed = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (listViewSent.current) return
    listViewSent.current = true
    trackLeagueCreationEvent('league_create_template_list_viewed', {})
  }, [])

  const onTemplatePreview = (id: LeagueCreationTemplateId) => {
    if (previewed.current.has(id)) return
    previewed.current.add(id)
    trackLeagueCreationEvent('league_create_template_previewed', { templateId: id })
  }

  return (
    <GlassCard data-testid="template-mode-browser" className="!p-4 sm:!p-6">
      <SectionHeader
        title="Choose a league template"
        hint="Each template loads onboarding defaults onto the same create pipeline as Quick and Advanced. Pick one to continue — you can customize everything after."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {templates.map((tm) => (
          <button
            key={tm.id}
            type="button"
            onPointerEnter={() => onTemplatePreview(tm.id)}
            onFocus={() => onTemplatePreview(tm.id)}
            onClick={() => onSelectTemplate(tm.id)}
            className="group touch-manipulation rounded-2xl border border-white/[0.08] bg-[#0a1228]/40 p-4 text-left transition hover:border-cyan-400/35 hover:bg-white/[0.04] sm:p-5"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${complexityStyles[tm.complexity] ?? 'border-white/15 bg-white/[0.04] text-white/70'}`}>
                {tm.complexity}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wide ${accent.text} opacity-90`}>
                {tm.visibilityHint.replace(/_/g, ' ')}
              </span>
            </div>
            <h3 className="text-base font-bold text-white">{tm.title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-white/55">{tm.shortDescription}</p>
            <dl className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3 text-[11px] text-white/45">
              <div className="flex gap-2">
                <dt className="shrink-0 font-semibold text-white/35">Play</dt>
                <dd className="min-w-0 text-white/60">{tm.gameplayStyle}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 font-semibold text-white/35">Draft</dt>
                <dd className="min-w-0 text-white/60">{tm.draftStyle}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 font-semibold text-white/35">Scoring</dt>
                <dd className="min-w-0 text-white/60">{tm.scoringStyle}</dd>
              </div>
            </dl>
            <p className={`mt-3 text-[11px] font-semibold ${accent.text} opacity-90`}>Tap to use this template →</p>
          </button>
        ))}
      </div>
    </GlassCard>
  )
}
