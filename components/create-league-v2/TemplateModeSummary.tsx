'use client'

import { useMemo } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import { GLASS_SURFACE } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getLeagueCreationTemplateMeta, isLeagueCreationTemplateId } from '@/lib/create-league-v2/templates/catalog'
import { buildTemplateModeIntroSummary, buildTemplateModeSummaryRows } from '@/lib/create-league-v2/templates/summary'
import { SectionHeader } from '@/components/create-league-v2/primitives'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{label}</dt>
      <dd className="max-w-[62%] text-right text-xs font-medium leading-snug text-white/85">{value}</dd>
    </div>
  )
}

export function TemplateModeSummary({ state, accent }: { state: CreateLeagueV2State; accent: AccentTone }) {
  const rows = useMemo(() => buildTemplateModeSummaryRows(state), [state])

  const headline = useMemo(() => {
    if (!state.selectedTemplateId || !isLeagueCreationTemplateId(state.selectedTemplateId)) return 'Templates'
    return getLeagueCreationTemplateMeta(state.selectedTemplateId).title
  }, [state.selectedTemplateId])

  return (
    <aside
      className={`${GLASS_SURFACE} relative overflow-hidden border-cyan-500/15 p-4 shadow-[0_0_50px_-18px_rgba(34,211,238,0.14)] sm:p-5 lg:sticky lg:top-24`}
      data-testid="template-mode-summary-aside"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/35 to-transparent"
        aria-hidden
      />
      <SectionHeader title="Template summary" hint={headline} />
      {!state.selectedTemplateId || !isLeagueCreationTemplateId(state.selectedTemplateId) ? (
        <p className={`mb-3 text-xs leading-relaxed text-white/50`}>
          {buildTemplateModeIntroSummary()[0]?.value ?? ''}
        </p>
      ) : (
        <p className={`mb-3 text-xs leading-relaxed ${accent.text} opacity-90`}>
          {getLeagueCreationTemplateMeta(state.selectedTemplateId).shortDescription}
        </p>
      )}
      <dl className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-1">
        {rows.map((r, i) => (
          <Row key={`${r.label}-${i}`} label={r.label} value={r.value} />
        ))}
      </dl>
    </aside>
  )
}
