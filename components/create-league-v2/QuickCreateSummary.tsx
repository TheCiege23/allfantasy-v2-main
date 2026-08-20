'use client'

import { useMemo } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import { GLASS_SURFACE } from '@/lib/create-league-v2/theme'
import { getEffectiveLeagueType, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getScoringPresetOptionsForSelection } from '@/lib/create-league-v2/rules-engine'
import { buildCreateLeagueReviewSnapshot } from '@/lib/create-league-v2/reviewCanonicalSnapshot'
import { SectionHeader } from '@/components/create-league-v2/primitives'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{label}</dt>
      <dd className="max-w-[62%] text-right text-xs font-medium leading-snug text-white/85">{value}</dd>
    </div>
  )
}

function ScoringSummaryRow({
  label,
  primaryLabel,
  presetId,
}: {
  label: string
  primaryLabel: string
  presetId: string | null
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{label}</dt>
      <dd className="max-w-[62%] text-right text-xs font-medium leading-snug text-white/85">
        <span className="block">{primaryLabel}</span>
        {presetId && primaryLabel !== presetId ? (
          <span className="mt-0.5 block font-mono text-[10px] font-normal tracking-tight text-white/35">{presetId}</span>
        ) : null}
      </dd>
    </div>
  )
}

/**
 * Compact canonical preview for Quick Create — driven by `buildCreateLeagueReviewSnapshot`.
 */
export function QuickCreateSummary({ state, accent }: { state: CreateLeagueV2State; accent: AccentTone }) {
  const snap = useMemo(() => buildCreateLeagueReviewSnapshot(state), [state])

  const scoringDisplay = useMemo(() => {
    const id = (snap.engineOk ? snap.scoringPresetId || state.scoringPresetId : state.scoringPresetId) || ''
    if (!id.trim()) return { primary: '—', presetId: null as string | null }
    const lt = getEffectiveLeagueType(state)
    if (!lt) return { primary: id, presetId: null }
    const opts = getScoringPresetOptionsForSelection({
      leagueType: lt,
      sport: state.sport,
      idpSelected: state.idpSelected,
    })
    const match = opts.find((o) => o.id === id)
    return {
      primary: match?.label?.trim() ? match.label : id,
      presetId: match?.label?.trim() ? id : null,
    }
  }, [snap.engineOk, snap.scoringPresetId, state])

  const visibilityLine = useMemo(() => {
    if (snap.finderVisibility === 'public') return 'Public · listing on'
    if (snap.finderVisibility === 'invite_only') return 'Invite-only'
    return 'Private'
  }, [snap.finderVisibility])

  const paymentLine = useMemo(() => {
    if (snap.monetizationFromPayload === 'paid') return 'Paid intent'
    return 'Free'
  }, [snap.monetizationFromPayload])

  const roster = snap.engineOk ? snap.rosterEngineSummary : '—'
  const waiver = snap.engineOk ? snap.waiverLeagueTableSummary : '—'
  const playoff = snap.engineOk ? snap.playoffEngineSummary : '—'
  const draft = snap.engineOk ? snap.draftSummary : '—'
  return (
    <aside
      className={`${GLASS_SURFACE} relative overflow-hidden border-cyan-500/15 p-4 shadow-[0_0_50px_-18px_rgba(34,211,238,0.14)] sm:p-5 lg:sticky lg:top-24`}
      data-testid="quick-create-summary-aside"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/35 to-transparent"
        aria-hidden
      />
      <SectionHeader
        title="Live summary"
        hint="Mirrors the same canonical snapshot used in Advanced review."
      />
      {!snap.engineOk && snap.engineError ? (
        <p className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">{snap.engineError}</p>
      ) : null}
      <dl className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-1">
        <Row label="Roster (preset)" value={roster} />
        <Row label="Waivers" value={waiver} />
        <Row label="Playoffs" value={playoff} />
        <ScoringSummaryRow label="Scoring preset" primaryLabel={scoringDisplay.primary} presetId={scoringDisplay.presetId} />
        <Row label="Visibility" value={visibilityLine} />
        <Row label="Payment" value={paymentLine} />
        <Row label="Draft" value={draft} />
      </dl>
      <p className={`mt-3 text-[10px] font-semibold uppercase tracking-wide ${accent.text} opacity-90`}>
        {snap.paymentEnabledPersisted ? 'Homepage payment tools on after create' : 'Homepage payment off at create'}
      </p>
    </aside>
  )
}
