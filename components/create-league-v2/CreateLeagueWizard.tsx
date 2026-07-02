'use client'

import { useEffect, useMemo, useState } from 'react'
import { CreateLeagueVideoTile } from '@/components/create-league-v2/CreateLeagueVideoTile'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  SUPPORTED_SPORTS,
  getDefaultBestBallSetup,
  getDefaultDynastySetup,
  getDefaultKeeperSetup,
  getEffectiveLeagueType,
  type CreateLeagueV2State,
  type SupportedSport,
  type WizardDraftType,
} from '@/lib/create-league-v2/state'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import {
  CREATE_LEAGUE_TIMEZONES,
  IMPORT_LEAGUE_PROVIDERS,
  PREMIUM_ADVANCED_CREATE_KEYS,
  PREMIUM_ADVANCED_CREATE_LABELS,
  UNIVERSAL_CREATE_TEAM_COUNTS,
  getEnabledPremiumAdvancedSettings,
  type ImportProviderOption,
  type PremiumAdvancedCreateKey,
} from '@/lib/create-league-v2/simple-create'
import {
  getDefaultScoringPresetId,
  listScoringPresetOptions,
} from '@/lib/league-creation-preset/scoring-presets'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA } from '@/lib/create-league-v2/theme'
import { getDraftTypeMedia } from '@/lib/league-media/draftTypeMedia'
import type { DraftTypeId, LeagueTypeId } from '@/lib/league-creation-wizard/types'

type WizardStep = 'sport' | 'basics' | 'draft' | 'summary' | 'review'

type WizardProps = {
  state: CreateLeagueV2State
  onChange: (patch: Partial<CreateLeagueV2State>) => void
  completionIssues: { code: string; message: string }[]
  fieldErrors: Partial<Record<string, string>> | null
  submitError: string | null
  submitting: boolean
  onSubmit: () => void
  onCancel: () => void
}

const SIMPLE_LEAGUE_TYPES: readonly LeagueTypeId[] = ['redraft', 'dynasty', 'keeper', 'best_ball']

const STEP_ORDER: readonly WizardStep[] = ['sport', 'basics', 'draft', 'summary', 'review']

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function fieldClass(hasError = false): string {
  return cx(
    'w-full rounded-xl border bg-[color:var(--surface-card)] px-3 py-2 text-sm font-semibold text-[color:var(--text-primary)] shadow-sm outline-none transition',
    hasError
      ? 'border-rose-400 focus:border-rose-500'
      : 'border-[color:var(--border-subtle)] focus:border-violet-500',
  )
}

function getLeagueTypeLabel(t: (key: string) => string, leagueType: LeagueTypeId): string {
  return t(`createLeague.g30.leagueType.${leagueType}`)
}

function getPremiumLabel(t: (key: string) => string, key: PremiumAdvancedCreateKey): string {
  const translated = t(`createLeague.g30.advanced.${key}`)
  return translated === `createLeague.g30.advanced.${key}`
    ? PREMIUM_ADVANCED_CREATE_LABELS[key]
    : translated
}

function nextStateForSport(state: CreateLeagueV2State, sport: SupportedSport): Partial<CreateLeagueV2State> {
  const leagueType = getEffectiveLeagueType(state) ?? 'redraft'
  const scoringPresetId = getDefaultScoringPresetId({
    leagueType,
    sport,
    idpSelected: state.idpSelected,
  })

  return {
    sport,
    scoringPresetId,
    teamCount: UNIVERSAL_CREATE_TEAM_COUNTS.includes(state.teamCount) ? state.teamCount : 12,
    dynasty: getDefaultDynastySetup(sport, state.draftType),
    keeper: getDefaultKeeperSetup(),
    bestBall: getDefaultBestBallSetup(sport, 'standard', state.draftType),
  }
}

function nextStateForLeagueType(state: CreateLeagueV2State, leagueType: LeagueTypeId): Partial<CreateLeagueV2State> {
  const draftTypeOptions = getDraftTypeOptions(leagueType, state.sport)
  const draftType = draftTypeOptions.some((option) => option.id === state.draftType)
    ? state.draftType
    : (draftTypeOptions[0]?.id ?? 'snake') as WizardDraftType
  const scoringPresetId = getDefaultScoringPresetId({
    leagueType,
    sport: state.sport,
    idpSelected: false,
  })

  return {
    leagueType,
    idpSelected: false,
    scoringPresetId,
    draftType,
    teamCount: UNIVERSAL_CREATE_TEAM_COUNTS.includes(state.teamCount) ? state.teamCount : 12,
    dynasty: getDefaultDynastySetup(state.sport, draftType),
    keeper: getDefaultKeeperSetup(),
    bestBall: getDefaultBestBallSetup(state.sport, 'standard', draftType),
  }
}

function useEnsureSimpleDefaults(state: CreateLeagueV2State, onChange: WizardProps['onChange']) {
  useEffect(() => {
    if (state.leagueType && state.scoringPresetId) return
    const leagueType = state.leagueType ?? 'redraft'
    onChange({
      leagueType,
      scoringPresetId:
        state.scoringPresetId ||
        getDefaultScoringPresetId({
          leagueType,
          sport: state.sport,
          idpSelected: state.idpSelected,
        }),
    })
  }, [onChange, state.idpSelected, state.leagueType, state.scoringPresetId, state.sport])
}

export function CreateLeagueWizard(props: WizardProps) {
  const { t, language } = useLanguage()
  const [activeStep, setActiveStep] = useState<WizardStep>('sport')
  const [importOpen, setImportOpen] = useState(false)
  const entitlements = useEntitlements()
  const isCommissioner = entitlements.hasCommissioner

  useEnsureSimpleDefaults(props.state, props.onChange)

  const enabledPremium = getEnabledPremiumAdvancedSettings(props.state.advancedSetup)
  const canCreate = props.completionIssues.length === 0

  return (
    <div className="min-h-screen bg-[color:var(--surface-app)] text-[color:var(--text-primary)]" data-testid="g30-create-league-wizard">
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-10">
        <section className="space-y-5">
          <header className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              {t('createLeague.g30.eyebrow')}
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                  {t('createLeague.g30.title')}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)]">
                  {t('createLeague.g30.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-violet-500/35 bg-violet-600/10 px-4 text-sm font-bold text-violet-700 transition hover:bg-violet-600/15 dark:text-violet-200"
                data-testid="g30-import-league-button"
              >
                {t('createLeague.g30.import.button')}
              </button>
            </div>
          </header>

          <nav className="grid grid-cols-5 gap-2" aria-label={t('createLeague.g30.steps.aria')}>
            {STEP_ORDER.map((step, index) => {
              const selected = activeStep === step
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => setActiveStep(step)}
                  className={cx(
                    'min-h-12 rounded-xl border px-2 text-left text-xs font-bold transition',
                    selected
                      ? 'border-violet-500 bg-violet-600 text-white shadow-lg shadow-violet-600/20'
                      : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-secondary)] hover:border-violet-400',
                  )}
                  data-testid={`g30-step-${step}`}
                >
                  <span className="block text-[10px] opacity-70">{index + 1}</span>
                  <span className="block truncate">{t(`createLeague.g30.steps.${step}`)}</span>
                </button>
              )
            })}
          </nav>

          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-4 shadow-xl shadow-black/5 sm:p-5">
            {activeStep === 'sport' ? (
              <SportStep state={props.state} onChange={props.onChange} />
            ) : null}
            {activeStep === 'basics' ? (
              <LeagueBasicsStep state={props.state} onChange={props.onChange} fieldErrors={props.fieldErrors} />
            ) : null}
            {activeStep === 'draft' ? (
              <DraftStep state={props.state} onChange={props.onChange} fieldErrors={props.fieldErrors} />
            ) : null}
            {activeStep === 'summary' ? (
              <SettingsSummaryStep
                state={props.state}
                onChange={props.onChange}
                hasCommissioner={isCommissioner}
                entitlementsLoading={entitlements.loading}
              />
            ) : null}
            {activeStep === 'review' ? (
              <ReviewCreateStep
                state={props.state}
                completionIssues={props.completionIssues}
                submitError={props.submitError}
                submitting={props.submitting}
                canCreate={canCreate}
                onSubmit={props.onSubmit}
              />
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={props.onCancel}
              disabled={props.submitting}
              className="min-h-11 rounded-xl border border-[color:var(--border-subtle)] px-4 text-sm font-bold text-[color:var(--text-secondary)] transition hover:border-violet-400 disabled:opacity-60"
            >
              {t('createLeague.v2.cancel')}
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  const index = STEP_ORDER.indexOf(activeStep)
                  setActiveStep(STEP_ORDER[Math.max(0, index - 1)] ?? 'sport')
                }}
                disabled={activeStep === 'sport' || props.submitting}
                className="min-h-11 rounded-xl border border-[color:var(--border-subtle)] px-4 text-sm font-bold text-[color:var(--text-secondary)] transition hover:border-violet-400 disabled:opacity-50"
              >
                {t('createLeague.g30.back')}
              </button>
              {activeStep === 'review' ? (
                <button
                  type="button"
                  onClick={props.onSubmit}
                  disabled={!canCreate || props.submitting}
                  className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-black text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-55"
                  data-testid="g30-create-league-submit"
                >
                  {props.submitting ? t('createLeague.g30.creating') : t('createLeague.v2.create')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const index = STEP_ORDER.indexOf(activeStep)
                    setActiveStep(STEP_ORDER[Math.min(STEP_ORDER.length - 1, index + 1)] ?? 'review')
                  }}
                  className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-black text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500"
                >
                  {t('createLeague.g30.next')}
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <LeaguePreviewCard
            state={props.state}
            language={language}
            enabledPremiumCount={enabledPremium.length}
          />
        </aside>
      </main>

      {importOpen ? <ImportLeagueModal onClose={() => setImportOpen(false)} /> : null}
    </div>
  )
}

export function SportStep({ state, onChange }: Pick<WizardProps, 'state' | 'onChange'>) {
  const { t } = useLanguage()

  return (
    <section className="space-y-4" data-testid="g30-sport-step">
      <StepHeader title={t('createLeague.g30.sport.title')} body={t('createLeague.g30.sport.body')} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SUPPORTED_SPORTS.map((sport) => {
          const selected = state.sport === sport
          const media = SPORT_MEDIA[sport]
          return (
            <CreateLeagueVideoTile
              key={sport}
              title={t(`createLeague.sport.${sport.toLowerCase()}`)}
              hint={t('createLeague.g30.sport.cardHint')}
              selected={selected}
              media={media}
              onSelect={() => onChange(nextStateForSport(state, sport))}
              testId={`g30-sport-${sport}`}
            />
          )
        })}
      </div>
    </section>
  )
}

export function LeagueBasicsStep({
  state,
  onChange,
  fieldErrors,
}: Pick<WizardProps, 'state' | 'onChange' | 'fieldErrors'>) {
  const { t } = useLanguage()
  const typeOptions = SIMPLE_LEAGUE_TYPES

  return (
    <section className="space-y-5" data-testid="g30-basics-step">
      <StepHeader title={t('createLeague.g30.basics.title')} body={t('createLeague.g30.basics.body')} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {typeOptions.map((leagueType) => {
          const selected = getEffectiveLeagueType(state) === leagueType
          const media = LEAGUE_TYPE_MEDIA[leagueType]
          return (
            <CreateLeagueVideoTile
              key={leagueType}
              title={getLeagueTypeLabel(t, leagueType)}
              hint={t(`createLeague.g30.leagueType.${leagueType}.hint`)}
              selected={selected}
              media={media}
              onSelect={() => onChange(nextStateForLeagueType(state, leagueType))}
              className="min-h-20"
              testId={`g30-league-type-${leagueType}`}
            />
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.name.label')}
          </span>
          <input
            value={state.name}
            onChange={(event) => onChange({ name: event.target.value, nameTouched: true })}
            className={fieldClass(Boolean(fieldErrors?.leagueName))}
            placeholder={t('createLeague.g30.name.placeholder')}
            data-testid="g30-league-name"
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.teamCount.label')}
          </span>
          <input
            type="number"
            min={2}
            max={32}
            value={state.teamCount}
            onChange={(event) => onChange({ teamCount: Number(event.target.value) })}
            className={fieldClass(Boolean(fieldErrors?.teamCount))}
            data-testid="g30-team-count"
          />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {(['private', 'public'] as const).map((privacy) => (
          <button
            key={privacy}
            type="button"
            onClick={() => onChange({ privacy })}
            className={cx(
              'rounded-xl border px-4 py-3 text-left text-sm font-bold transition',
              state.privacy === privacy
                ? 'border-violet-500 bg-violet-600/12 text-violet-700 dark:text-violet-200'
                : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-secondary)]',
            )}
            data-testid={`g30-privacy-${privacy}`}
          >
            {t(`createLeague.g30.privacy.${privacy}`)}
          </button>
        ))}
      </div>
    </section>
  )
}

export function DraftStep({
  state,
  onChange,
  fieldErrors,
}: Pick<WizardProps, 'state' | 'onChange' | 'fieldErrors'>) {
  const { t } = useLanguage()
  const leagueType = getEffectiveLeagueType(state) ?? 'redraft'
  const draftTypes = getDraftTypeOptions(leagueType, state.sport)
  const scoringPresets = listScoringPresetOptions({
    leagueType,
    sport: state.sport,
    idpSelected: state.idpSelected,
  })

  return (
    <section className="space-y-5" data-testid="g30-draft-step">
      <StepHeader title={t('createLeague.g30.draft.title')} body={t('createLeague.g30.draft.body')} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('createLeague.g30.draftType.label')}>
        {draftTypes.map((option) => {
          const media = getDraftTypeMedia(option.id as DraftTypeId)
          const selected = state.draftType === option.id
          const video = media.selectionVideo || undefined
          return (
            <CreateLeagueVideoTile
              key={option.id}
              title={option.label}
              hint={option.hint}
              eyebrow={t('createLeague.g30.draftType.label')}
              selected={selected}
              media={{
                video,
                poster: media.thumbnail,
              }}
              onSelect={() => onChange({ draftType: option.id as WizardDraftType })}
              className="min-h-28"
              testId={`g31-draft-type-${option.id}`}
            />
          )
        })}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.draftType.label')}
          </span>
          <select
            value={state.draftType}
            onChange={(event) => onChange({ draftType: event.target.value as WizardDraftType })}
            className={fieldClass(Boolean(fieldErrors?.draftType))}
            data-testid="g30-draft-type"
          >
            {draftTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.scoring.label')}
          </span>
          <select
            value={state.scoringPresetId}
            onChange={(event) => onChange({ scoringPresetId: event.target.value })}
            className={fieldClass(Boolean(fieldErrors?.scoringPreset))}
            data-testid="g30-scoring-preset"
          >
            {scoringPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.draftDate.label')}
          </span>
          <input
            type="date"
            value={state.draftDate}
            onChange={(event) => onChange({ draftDate: event.target.value })}
            className={fieldClass(Boolean(fieldErrors?.draftDate))}
            data-testid="g30-draft-date"
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.draftTime.label')}
          </span>
          <input
            type="time"
            value={state.draftTime}
            onChange={(event) => onChange({ draftTime: event.target.value })}
            className={fieldClass(Boolean(fieldErrors?.draftTime))}
            data-testid="g30-draft-time"
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.timezone.label')}
          </span>
          <select
            value={state.timezone}
            onChange={(event) => onChange({ timezone: event.target.value })}
            className={fieldClass(Boolean(fieldErrors?.timezone))}
            data-testid="g30-timezone"
          >
            {CREATE_LEAGUE_TIMEZONES.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}

export function SettingsSummaryStep({
  state,
  onChange,
  hasCommissioner,
  entitlementsLoading,
}: Pick<WizardProps, 'state' | 'onChange'> & {
  hasCommissioner: boolean
  entitlementsLoading: boolean
}) {
  const { t } = useLanguage()

  return (
    <section className="space-y-5" data-testid="g30-summary-step">
      <StepHeader title={t('createLeague.g30.summary.title')} body={t('createLeague.g30.summary.body')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryTile label={t('createLeague.summary.sport')} value={state.sport} />
        <SummaryTile label={t('createLeague.summary.concept')} value={String(getEffectiveLeagueType(state) ?? 'redraft')} />
        <SummaryTile label={t('createLeague.summary.teams')} value={String(state.teamCount)} />
        <SummaryTile label={t('createLeague.summary.draft')} value={`${state.draftDate || t('createLeague.g30.empty')} ${state.draftTime || ''}`.trim()} />
      </div>

      <LockedAdvancedSetupPanel
        state={state}
        onChange={onChange}
        hasCommissioner={hasCommissioner}
        entitlementsLoading={entitlementsLoading}
      />
    </section>
  )
}

export function ReviewCreateStep({
  state,
  completionIssues,
  submitError,
  submitting,
  canCreate,
  onSubmit,
}: {
  state: CreateLeagueV2State
  completionIssues: WizardProps['completionIssues']
  submitError: string | null
  submitting: boolean
  canCreate: boolean
  onSubmit: () => void
}) {
  const { t } = useLanguage()

  return (
    <section className="space-y-5" data-testid="g30-review-step">
      <StepHeader title={t('createLeague.g30.review.title')} body={t('createLeague.g30.review.body')} />
      <div className="rounded-2xl border border-violet-500/25 bg-violet-600/8 p-4">
        <h2 className="text-lg font-black">{state.name || t('createLeague.g30.preview.unnamed')}</h2>
        <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
          {state.teamCount} {t('createLeague.summary.teams')} - {state.sport} - {String(getEffectiveLeagueType(state) ?? 'redraft')}
        </p>
        <p className="mt-3 text-sm leading-6 text-[color:var(--text-secondary)]">
          {t('createLeague.g30.review.why')}
        </p>
      </div>

      {completionIssues.length > 0 ? (
        <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4" data-testid="g30-review-issues">
          <p className="text-sm font-black text-amber-700 dark:text-amber-200">{t('createLeague.g30.review.needsAttention')}</p>
          <ul className="mt-2 space-y-1 text-sm text-[color:var(--text-secondary)]">
            {completionIssues.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {submitError ? (
        <div role="alert" className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-200">
          {submitError}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canCreate || submitting}
        className="min-h-12 w-full rounded-xl bg-violet-600 px-5 text-sm font-black text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-55"
        data-testid="g30-create-league-submit-primary"
      >
        {submitting ? t('createLeague.g30.creating') : t('createLeague.v2.create')}
      </button>
    </section>
  )
}

export function LeaguePreviewCard({
  state,
  language,
  enabledPremiumCount,
}: {
  state: CreateLeagueV2State
  language: string
  enabledPremiumCount: number
}) {
  const { t } = useLanguage()
  const leagueType = getEffectiveLeagueType(state) ?? 'redraft'
  const scoring = listScoringPresetOptions({
    leagueType,
    sport: state.sport,
    idpSelected: state.idpSelected,
  }).find((option) => option.id === state.scoringPresetId)

  return (
    <section
      className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-5 shadow-xl shadow-black/5"
      data-testid="g30-league-preview"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
        {t('createLeague.g30.preview.eyebrow')}
      </p>
      <h2 className="mt-2 text-2xl font-black tracking-tight">{state.name || t('createLeague.g30.preview.unnamed')}</h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
        {t('createLeague.g30.preview.body')}
      </p>
      <div className="mt-5 space-y-3 text-sm">
        <PreviewRow label={t('createLeague.summary.sport')} value={state.sport} />
        <PreviewRow label={t('createLeague.summary.concept')} value={getLeagueTypeLabel(t, leagueType)} />
        <PreviewRow label={t('createLeague.summary.teams')} value={String(state.teamCount)} />
        <PreviewRow label={t('createLeague.g30.privacy.label')} value={t(`createLeague.g30.privacy.${state.privacy}`)} />
        <PreviewRow label={t('createLeague.summary.draft')} value={state.draftDate && state.draftTime ? `${state.draftDate} ${state.draftTime}` : t('createLeague.g30.empty')} />
        <PreviewRow label={t('createLeague.g30.timezone.label')} value={state.timezone} />
        <PreviewRow label={t('createLeague.summary.scoring')} value={scoring?.label ?? t('createLeague.g30.empty')} />
        <PreviewRow label={t('createLeague.g30.preview.language')} value={language.toUpperCase()} />
        <PreviewRow label={t('createLeague.g30.preview.advanced')} value={enabledPremiumCount > 0 ? String(enabledPremiumCount) : t('createLeague.g30.preview.advancedNone')} />
      </div>
    </section>
  )
}

export function ImportLeagueModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 backdrop-blur-sm sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('createLeague.g30.import.title')}
      data-testid="g30-import-modal"
    >
      <div className="max-h-[86vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              {t('createLeague.g30.import.eyebrow')}
            </p>
            <h2 className="mt-1 text-2xl font-black">{t('createLeague.g30.import.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
              {t('createLeague.g30.import.body')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[color:var(--border-subtle)] px-3 py-1 text-sm font-black"
            aria-label={t('createLeague.g30.import.close')}
          >
            x
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {IMPORT_LEAGUE_PROVIDERS.map((provider) => (
            <ImportProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ImportProviderCard({ provider }: { provider: ImportProviderOption }) {
  const { t } = useLanguage()
  const available = provider.state === 'available'
  return (
    <div
      className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-4"
      data-testid={`g30-import-provider-${provider.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black">{provider.label}</h3>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t(`createLeague.g30.import.state.${provider.state}`)}
          </p>
        </div>
        <span className={cx('rounded-full px-2 py-1 text-[11px] font-black', available ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200' : 'bg-amber-500/15 text-amber-700 dark:text-amber-200')}>
          {available ? t('createLeague.g30.import.ready') : t('createLeague.g30.import.beta')}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:var(--text-secondary)]">
        {available ? t('createLeague.g30.import.safeRoute') : t('createLeague.g30.import.noBrokenAction')}
      </p>
      {available && provider.route ? (
        <a
          href={provider.route}
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-black text-white transition hover:bg-violet-500"
        >
          {t('createLeague.g30.import.start')}
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="mt-4 min-h-10 w-full cursor-not-allowed rounded-xl bg-[color:var(--surface-card-soft)] px-4 text-sm font-black text-[color:var(--text-tertiary)]"
        >
          {t('createLeague.g30.import.comingSoon')}
        </button>
      )}
    </div>
  )
}

export function AFCommissionerUpsellCard() {
  const { t } = useLanguage()
  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-600/10 p-4" data-testid="g30-commissioner-upsell">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
        {t('createLeague.g30.upsell.eyebrow')}
      </p>
      <h3 className="mt-2 text-lg font-black">{t('createLeague.g30.upsell.title')}</h3>
      <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">{t('createLeague.g30.upsell.body')}</p>
      <a
        href="/pricing?plan=commissioner"
        className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-black text-white"
      >
        {t('createLeague.g30.upsell.cta')}
      </a>
    </div>
  )
}

export function LockedAdvancedSetupPanel({
  state,
  onChange,
  hasCommissioner,
  entitlementsLoading,
}: Pick<WizardProps, 'state' | 'onChange'> & {
  hasCommissioner: boolean
  entitlementsLoading: boolean
}) {
  const { t } = useLanguage()

  return (
    <section className="space-y-4" data-testid="g30-advanced-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-black">{t('createLeague.g30.advanced.title')}</h3>
          <p className="mt-1 text-sm leading-6 text-[color:var(--text-secondary)]">
            {hasCommissioner ? t('createLeague.g30.advanced.unlockedBody') : t('createLeague.g30.advanced.lockedBody')}
          </p>
        </div>
        <span className="rounded-full border border-[color:var(--border-subtle)] px-3 py-1 text-xs font-black text-[color:var(--text-secondary)]">
          {entitlementsLoading
            ? t('createLeague.g30.advanced.checking')
            : hasCommissioner
              ? t('createLeague.g30.advanced.unlocked')
              : t('createLeague.g30.advanced.locked')}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {PREMIUM_ADVANCED_CREATE_KEYS.map((key) => {
          const checked = state.advancedSetup[key] === true
          return (
            <label
              key={key}
              className={cx(
                'flex min-h-12 items-center gap-3 rounded-xl border px-3 text-sm font-bold',
                hasCommissioner
                  ? 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)]'
                  : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-tertiary)]',
              )}
              data-testid={`g30-advanced-${key}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!hasCommissioner}
                onChange={(event) =>
                  onChange({
                    advancedSetup: {
                      ...state.advancedSetup,
                      [key]: event.target.checked,
                    },
                  })
                }
              />
              <span>{getPremiumLabel(t, key)}</span>
            </label>
          )
        })}
      </div>

      {!hasCommissioner ? <AFCommissionerUpsellCard /> : null}
    </section>
  )
}

function StepHeader({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-xl font-black tracking-tight">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--text-secondary)]">{body}</p>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--text-tertiary)]">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[color:var(--border-subtle)] pb-2 last:border-b-0 last:pb-0">
      <span className="text-[color:var(--text-tertiary)]">{label}</span>
      <span className="text-right font-black">{value}</span>
    </div>
  )
}
