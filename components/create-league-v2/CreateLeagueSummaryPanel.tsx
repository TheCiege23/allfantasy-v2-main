'use client'

import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType } from '@/lib/create-league-v2/state'
import { LEAGUE_TYPE_LABELS } from '@/lib/league-creation-wizard/league-type-registry'
import { listScoringPresetOptions } from '@/lib/league-creation-preset/scoring-presets'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import { GLASS_SURFACE } from '@/lib/create-league-v2/theme'

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAF: 'NCAAF',
  NCAAB: 'NCAAB',
  SOCCER: 'Soccer',
}

export function CreateLeagueSummaryPanel({
  state,
  accent,
}: {
  state: CreateLeagueV2State
  accent: AccentTone
}) {
  const lt = getEffectiveLeagueType(state)
  const presetLabel =
    lt &&
    listScoringPresetOptions({ leagueType: lt, sport: state.sport, idpSelected: state.idpSelected }).find(
      (p) => p.id === state.scoringPresetId,
    )?.label
  const draftOpts = lt ? getDraftTypeOptions(lt, state.sport) : []
  const draftLabel = draftOpts.find((d) => d.id === state.draftType)?.label ?? state.draftType

  return (
    <aside className={`${GLASS_SURFACE} p-5 sm:p-6 lg:sticky lg:top-24`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.22em] ${accent.text}`}>Live summary</p>
      <h2 className="mt-2 text-lg font-bold tracking-tight text-white">Your league</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/45">
        Waivers, rosters, playoffs, and advanced scoring can be customized in League Settings after creation.
      </p>

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex justify-between gap-3 border-b border-white/[0.06] pb-2">
          <dt className="text-white/45">Concept</dt>
          <dd className="text-right font-medium text-white/90">
            {state.idpSelected ? 'IDP (NFL)' : lt ? (LEAGUE_TYPE_LABELS[lt] ?? lt) : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-white/[0.06] pb-2">
          <dt className="text-white/45">Sport</dt>
          <dd className="text-right font-medium text-white/90">{SPORT_LABELS[state.sport] ?? state.sport}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-white/[0.06] pb-2">
          <dt className="text-white/45">Scoring</dt>
          <dd className="max-w-[58%] text-right font-medium text-white/90">{presetLabel ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-white/[0.06] pb-2">
          <dt className="text-white/45">Teams</dt>
          <dd className="text-right font-medium text-white/90">{state.teamCount}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-white/[0.06] pb-2">
          <dt className="text-white/45">Name</dt>
          <dd className="max-w-[60%] truncate text-right font-medium text-cyan-100/95" title={state.name}>
            {state.name.trim() || '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-white/45">Draft</dt>
          <dd className="text-right font-medium text-white/90">{draftLabel}</dd>
        </div>
      </dl>

      <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-[11px] leading-relaxed text-white/40">
        Defaults for lineups, waivers, and draft clock are applied automatically. Open League Settings to go deeper.
      </div>
    </aside>
  )
}
