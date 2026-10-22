'use client'

import { SurvivorSeasonPreview } from './SurvivorSeasonPreview'
import { useMemo } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State, TradeReviewMode } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType, isDynastyConcept } from '@/lib/create-league-v2/state'
import { LEAGUE_TYPE_LABELS } from '@/lib/league-creation-wizard/league-type-registry'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import { listScoringPresetOptions } from '@/lib/league-creation-preset/scoring-presets'
import { GlassCard, SectionHeader } from '@/components/create-league-v2/primitives'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { localizeDraftTypeOption } from '@/lib/i18n/createLeagueWire'
import { sportSupportsProspectStash } from '@/lib/league-creation/prospectStashPolicy'

const TRADE_REVIEW_LABEL: Record<TradeReviewMode, string> = {
  none: 'No review',
  commissioner: 'Commissioner review',
  league_vote: 'League vote',
}

const RANK_WINDOW_MESSAGE = 'Rank window will be calculated after creation.'

function normalizeVisibilityLabel(state: CreateLeagueV2State): string {
  const leagueType = getEffectiveLeagueType(state)
  if (leagueType === 'best_ball') {
    return state.bestBall.visibility === 'public' ? 'Public' : 'Private'
  }
  if (leagueType && isDynastyConcept(leagueType)) {
    return state.dynasty.visibility === 'public' ? 'Public' : 'Private'
  }
  return 'Private (default)'
}

function monetizationLabel(state: CreateLeagueV2State): string {
  const leagueType = getEffectiveLeagueType(state)
  if (leagueType && isDynastyConcept(leagueType)) {
    return state.dynasty.monetization === 'paid' ? 'Paid intent' : 'Free'
  }
  return '—'
}

function waiverSummary(state: CreateLeagueV2State): string {
  const leagueType = getEffectiveLeagueType(state)
  if (leagueType && isDynastyConcept(leagueType)) {
    const d = state.dynasty
    const wt =
      d.waiverType === 'faab'
        ? `FAAB (${d.faabBudget})`
        : d.waiverType === 'rolling'
          ? 'Rolling'
          : 'Reverse standings'
    return wt
  }
  return '—'
}

function rosterSummary(state: CreateLeagueV2State): string {
  const leagueType = getEffectiveLeagueType(state)
  if (leagueType && isDynastyConcept(leagueType)) {
    const d = state.dynasty
    const taxi = sportSupportsProspectStash(state.sport) ? ` · Taxi ${d.taxiSlotCount}` : ''
    return `Startup depth ${d.startupRosterDepth} · Bench ${d.benchCount} · IR ${d.irCount}${taxi}`
  }
  if (leagueType === 'keeper') {
    const k = state.keeper
    return `Keepers ${k.keeperMaxKeepers} · Max years ${k.keeperMaxYears} · Round penalty ${k.keeperRoundPenalty}`
  }
  if (leagueType === 'best_ball') {
    const bb = state.bestBall
    return `${bb.rosterTemplateId || 'Roster'} · ${bb.lineupTemplateId || 'Lineup'}`
  }
  return '—'
}

function playoffSummary(state: CreateLeagueV2State): string {
  const leagueType = getEffectiveLeagueType(state)
  if (leagueType && isDynastyConcept(leagueType)) {
    const d = state.dynasty
    return `${d.playoffTeamCount} teams · ${d.playoffByeCount} byes · ${d.regularSeasonLength} regular-season weeks`
  }
  if (leagueType === 'best_ball') {
    const bb = state.bestBall
    return `${bb.playoffTeams} playoff teams · ${bb.regularSeasonLength} regular-season weeks`
  }
  return '—'
}

function resolveCreationModeLabel(state: CreateLeagueV2State): string {
  return state.creationMode === 'advanced' ? 'Advanced' : 'Quick'
}

export function CreateLeagueReviewStep({
  state,
  accent,
}: {
  state: CreateLeagueV2State
  accent: AccentTone
}) {
  const { t } = useLanguage()
  const leagueType = getEffectiveLeagueType(state)

  const conceptLabel = useMemo(() => {
    if (state.idpSelected) return 'IDP'
    if (!leagueType) return '—'
    const key = `createLeague.concept.${leagueType}.title`
    const translated = t(key)
    return translated === key ? LEAGUE_TYPE_LABELS[leagueType] ?? leagueType : translated
  }, [leagueType, state.idpSelected, t])

  const sportLabel = state.sport === 'SOCCER' ? t('createLeague.sport.soccer') : state.sport

  const draftLabel = useMemo(() => {
    if (!leagueType) return '—'
    const option = getDraftTypeOptions(leagueType, state.sport).find((item) => item.id === state.draftType)
    if (!option) return state.draftType
    return localizeDraftTypeOption(t, option).label
  }, [leagueType, state.sport, state.draftType, t])

  const scoringLabel = useMemo(() => {
    if (!leagueType) return '—'
    return (
      listScoringPresetOptions({
        leagueType,
        sport: state.sport,
        idpSelected: state.idpSelected,
      }).find((preset) => preset.id === state.scoringPresetId)?.label ??
      state.scoringPresetId ??
      '—'
    )
  }, [leagueType, state.sport, state.idpSelected, state.scoringPresetId])

  const languageLabel = state.language === 'es' ? 'Español' : 'English'

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Creation mode', value: resolveCreationModeLabel(state) },
    { label: 'Concept', value: conceptLabel },
    { label: 'Sport', value: sportLabel },
    { label: 'Scoring preset', value: scoringLabel },
    { label: 'Draft type', value: draftLabel },
    { label: 'Teams / pool', value: String(state.teamCount) },
    { label: 'League name', value: state.name.trim() || '—' },
    { label: 'Timezone', value: state.timezone?.trim() ? state.timezone : 'America/New_York' },
    { label: 'Language', value: languageLabel },
    { label: 'Trade review', value: TRADE_REVIEW_LABEL[state.tradeReviewMode] },
    { label: 'Waiver style', value: waiverSummary(state) },
    { label: 'Playoffs / season', value: playoffSummary(state) },
    { label: 'Roster summary', value: rosterSummary(state) },
    { label: 'Visibility', value: normalizeVisibilityLabel(state) },
    { label: 'Paid / free', value: monetizationLabel(state) },
    { label: 'Creator rank window', value: RANK_WINDOW_MESSAGE },
  ]

  return (
    <GlassCard>
      <SectionHeader
        title="Review"
        hint="Final snapshot before submit. Fix any warnings above if something looks off."
      />
      <SurvivorSeasonPreview state={state} />
      <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3 py-2.5">
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">{row.label}</dt>
            <dd className={`max-w-[65%] text-right text-sm font-medium ${accent.text}`}>{row.value}</dd>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
