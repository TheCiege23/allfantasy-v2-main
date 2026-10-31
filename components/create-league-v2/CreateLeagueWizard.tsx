'use client'

import { GUILLOTINE_SINGLE_ELIMINATION_MAX_TEAMS, guillotineNeedsDoubleElimination } from '@/lib/guillotine/teamCountLimits'
import { SurvivorSeasonPreview } from './SurvivorSeasonPreview'
import { isSurvivorDefaultFormatSport } from '@/lib/survivor/survivorCreationAvailability'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, Lock, Minus, Plus, X } from 'lucide-react'
import Image from 'next/image'
import { CreateLeagueVideoTile } from '@/components/create-league-v2/CreateLeagueVideoTile'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { canRunSeasonForSport } from '@/lib/sport-scope'
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
import {
  getDraftTypeOptions,
  getIdpDraftTypeOptions,
  getDefaultTeamCount,
  getTeamCountOptions,
  getSurvivorTribeOptions,
  getScoringPresetOptionsForSelection,
  isSportAllowedForType,
  resolveValidScoringPresetIdForSelection,
} from '@/lib/create-league-v2/rules-engine'
import { teamCountOptionsWithImported } from '@/lib/league-creation/importedTeamCount'
import { ODD_TEAM_MEDIAN_LEAGUE_TYPES, isOddTeamCount, lockedOddTeamCounts, teamCountOptionsForPlan } from '@/lib/league/oddTeamLeagues'
import {
  IMPORT_LEAGUE_PROVIDERS,
  PREMIUM_ADVANCED_CREATE_KEYS,
  PREMIUM_ADVANCED_CREATE_LABELS,
  getEnabledPremiumAdvancedSettings,
  type ImportProviderOption,
  type PremiumAdvancedCreateKey,
} from '@/lib/create-league-v2/simple-create'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA } from '@/lib/create-league-v2/theme'
import { getClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import { timezoneLabel, timezoneOptions } from '@/lib/create-league-v2/device-timezone'
import { CheckBox, HelpTip } from '@/components/create-league-v2/WizardControls'
import { TE_PREMIUM_POINT_OPTIONS } from '@/lib/nfl-scoring/nflScoringSeedForCreate'
import { getDraftTypeMedia } from '@/lib/league-media/draftTypeMedia'
import { ScoringLabel } from '@/components/league-labels/ScoringLabel'
import { scoringLabelIdForWizard } from '@/lib/league-labels/liveValues'
import type { DraftTypeId, LeagueTypeId } from '@/lib/league-creation-wizard/types'
import {
  applyDynastySportPresetToSetup,
  findDynastySportPreset,
  getDynastySportPresets,
  matchDynastySportPreset,
} from '@/lib/dynasty-core/DynastySportPresets'
import { DYNASTY_FORMAT_UI_COPY, dynastyFormatLang, dynastySportPresetCopy } from '@/lib/i18n/dynasty-format-copy'

type WizardStep = 'sport' | 'basics' | 'draft' | 'review'

type WizardProps = {
  state: CreateLeagueV2State
  onChange: (patch: Partial<CreateLeagueV2State>) => void
  completionIssues: { code: string; message: string }[]
  fieldErrors: Partial<Record<string, string>> | null
  submitError: string | null
  submitting: boolean
  importSourceName?: string
  importCarryover?: boolean
  acceptWeeklyLineups?: boolean
  onAcceptWeeklyLineups?: (accepted: boolean) => void
  createdLeagueHref?: string | null
  creationWarning?: string | null
  retryingFinalization?: boolean
  onRetryFinalization?: () => void
  onSubmit: () => void
  onCancel: () => void
  /** Imported leagues this manager commissions, which can be converted to native leagues. */
  importedLeagues?: ImportedLeagueSummary[]
}

/*
 * Four steps. Summary used to sit between Draft and Review and repeated four settings plus the
 * AF Commissioner panel; both now live on Review, where the manager confirms anyway.
 */
const STEP_ORDER: readonly WizardStep[] = ['sport', 'basics', 'draft', 'review']

/** The four familiar formats, shown as a compact row beneath the specialties. */
const CLASSIC_FORMATS: readonly string[] = ['redraft', 'dynasty', 'keeper', 'best_ball']
/** Specialty order on the Basics step: the elimination and social formats lead. */
const SPECIALTY_ORDER: readonly string[] = ['survivor', 'guillotine', 'big_brother', 'zombie', 'salary_cap', 'devy', 'c2c', 'idp']

function specialtyRank(id: string): number {
  const index = SPECIALTY_ORDER.indexOf(id)
  return index === -1 ? SPECIALTY_ORDER.length : index
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/*
 * ⚠ 16PX BELOW `sm`, NOT 14. iOS Safari zooms the whole page into any focused field whose font is
 * under 16px and does not zoom back out, so every tap on the name, date or time field left the
 * wizard magnified and scrolled sideways. 48px tall is the touch floor on Android (Material) and
 * clears Apple's 44pt.
 */
function fieldClass(hasError = false): string {
  return cx(
    'block min-h-12 w-full min-w-0 rounded-xl border bg-[color:var(--surface-card)] px-3 py-2 text-base font-semibold text-[color:var(--text-primary)] shadow-sm outline-none transition focus:ring-2 focus:ring-violet-500/25 sm:min-h-11 sm:text-sm',
    hasError
      ? 'border-rose-400 focus:border-rose-500'
      : 'border-[color:var(--border-subtle)] focus:border-violet-500',
  )
}

function getLeagueTypeLabel(t: (key: string) => string, leagueType: LeagueTypeId, fallback = leagueType.replaceAll('_', ' ')): string {
  const key = `createLeague.g30.leagueType.${leagueType}`
  const translated = t(key)
  return translated === key ? fallback : translated
}

/** The "?" explanations, English fallback beside each dictionary key. */
const HELP = {
  formats: ['createLeague.g30.help.formats', 'Specialty formats add a twist to the season: Survivor votes managers off, Guilly cuts the lowest score every week, Big Brother has weekly nominations, and Zombie spreads like an infection. Classic formats play a normal season. Each tile says how it plays.'],
  teams: ['createLeague.g30.help.teams', 'How many managers play in the league. Some formats only allow certain sizes, so − and + step through the sizes this format allows.'],
  privacy: ['createLeague.g30.help.privacy', "Private leagues are invite-only. Public leagues can also show up in AllFantasy's league finder, where other players can find them."],
  draftType: ['createLeague.g30.help.draftType', 'Snake: the pick order reverses every round. Linear: the same order every round. Auction: managers bid a budget on players. Auto: the computer drafts for every team. Offline: draft in person, then the commissioner enters the picks.'],
  scoring: ['createLeague.g30.help.scoring', 'How players earn points. PPR means points per reception: Full PPR gives 1 point per catch, Half PPR gives 0.5, and Standard gives none. Category leagues (some NBA and MLB options) rank teams by stat categories instead of points.'],
  draftDate: ['createLeague.g30.help.draftDate', 'Pick a date and time now, or choose Schedule later to invite managers first. You can set or change the draft date any time in Commissioner settings → Draft.'],
  timezone: ['createLeague.g30.help.timezone', "The draft time is set in this timezone, and it is your league's home timezone. It starts on your device's timezone."],
  tePremium: ['createLeague.g30.help.tePremium', 'TE premium gives tight ends extra points for every catch, on top of the league\'s normal points per catch. Turn it on, then choose how much each tight-end catch is worth.'],
  advanced: ['createLeague.g30.help.advanced', 'Optional extras that come with an AF Commissioner plan: Commissioner Intelligence tools, automatic trade approval and league health monitoring. Every format and setting above is free.'],
} as const

function help(t: (key: string) => string, which: keyof typeof HELP): string {
  const [key, fallback] = HELP[which]
  return tx(t, key, fallback)
}

/** When the draft is, as the summary and preview show it. */
function draftWhenLabel(t: (key: string) => string, state: CreateLeagueV2State): string {
  if (state.draftScheduleLater === true) return tx(t, 'createLeague.g30.draftWhen.later', 'Schedule later')
  if (state.draftDate && state.draftTime) return `${state.draftDate} ${state.draftTime}`
  return state.draftDate || t('createLeague.g30.empty')
}

/** The format as a manager reads it — "Best Ball", not `best_ball`. */
function conceptLabel(t: (key: string) => string, state: CreateLeagueV2State): string {
  if (state.idpSelected) return 'IDP'
  const leagueType = getEffectiveLeagueType(state) ?? 'redraft'
  return getLeagueTypeLabel(t, leagueType, getClientLeagueCreateOptionsCatalog().concepts.find((concept) => concept.id === leagueType)?.title)
}

/** `t()` returns the key itself when a dictionary lacks it; fall back to English rather than show a key. */
function tx(t: (key: string) => string, key: string, fallback: string): string {
  const translated = t(key)
  return translated === key ? fallback : translated
}

/** A scoring preset's name. Presets with a `createLeague.scoringPreset.<id>` key are translated; the rest keep their English label. */
function scoringPresetLabel(t: (key: string) => string, preset: { id: string; label: string }): string {
  return tx(t, `createLeague.scoringPreset.${preset.id}`, preset.label)
}

function getPremiumLabel(t: (key: string) => string, key: PremiumAdvancedCreateKey): string {
  const translated = t(`createLeague.g30.advanced.${key}`)
  return translated === `createLeague.g30.advanced.${key}`
    ? PREMIUM_ADVANCED_CREATE_LABELS[key]
    : translated
}

export function nextStateForSport(state: CreateLeagueV2State, sport: SupportedSport): Partial<CreateLeagueV2State> {
  // A format the manager has not picked follows the sport's default. A picked format is kept when
  // the new sport allows it; one it does not (guillotine is not offered for NCAAB or soccer) falls
  // back to the sport's default too, or the wizard would submit a pairing the server refuses.
  const chosen = getEffectiveLeagueType(state) ?? 'redraft'
  const leagueType = state.leagueTypeTouched === true && isSportAllowedForType(sport, chosen)
    ? chosen
    : defaultLeagueTypeForSport(sport)
  const idpSelected = state.idpSelected && (sport === 'NFL' || sport === 'NCAAF')
  const scoringPresetId = resolveValidScoringPresetIdForSelection('', {
    leagueType,
    sport,
    idpSelected,
  })
  const draftOptions = idpSelected ? getIdpDraftTypeOptions() : getDraftTypeOptions(leagueType, sport)
  const draftType = draftOptions.some((option) => option.id === state.draftType)
    ? state.draftType
    : (draftOptions[0]?.id ?? 'snake') as WizardDraftType

  return {
    sport,
    ...(leagueType !== chosen ? { leagueType } : {}),
    idpSelected,
    draftType,
    // The server refuses a soccer league without a pipeline, and the wizard had no control for
    // it, so soccer could never be submitted. The player pool is European whichever is chosen
    // (the pipeline is stored, not read by the pool), so default to it rather than offer a
    // choice that changes nothing.
    soccerPipeline: sport === 'SOCCER' ? (state.soccerPipeline ?? 'euro') : null,
    scoringPresetId,
    teamCount: getTeamCountOptions(sport, leagueType, state.soccerPipeline).includes(state.teamCount)
      ? state.teamCount : getDefaultTeamCount(sport, leagueType, state.soccerPipeline),
    ...(leagueType === 'survivor' ? { survivorTribeCount: getSurvivorTribeOptions(
      getTeamCountOptions(sport, leagueType, state.soccerPipeline).includes(state.teamCount)
        ? state.teamCount : getDefaultTeamCount(sport, leagueType, state.soccerPipeline),
    ).includes(state.survivorTribeCount) ? state.survivorTribeCount : 2 } : {}),
    dynasty: fitDynastySetupToTeamCount(getDefaultDynastySetup(sport, state.draftType), getTeamCountOptions(sport, leagueType, state.soccerPipeline).includes(state.teamCount) ? state.teamCount : getDefaultTeamCount(sport, leagueType, state.soccerPipeline)),
    keeper: getDefaultKeeperSetup(),
    bestBall: bestBallSetupForTeamCount(sport, state.draftType, getTeamCountOptions(sport, leagueType, state.soccerPipeline).includes(state.teamCount) ? state.teamCount : getDefaultTeamCount(sport, leagueType, state.soccerPipeline)),
  }
}

function fitDynastySetupToTeamCount(setup: CreateLeagueV2State['dynasty'], teamCount: number) {
  const playoffTeamCount = Math.min(setup.playoffTeamCount, Math.max(2, teamCount))
  return { ...setup, playoffTeamCount, playoffByeCount: 2 ** Math.ceil(Math.log2(playoffTeamCount)) - playoffTeamCount }
}

function bestBallSetupForTeamCount(sport: CreateLeagueV2State['sport'], draftType: WizardDraftType, teamCount: number) {
  const setup = getDefaultBestBallSetup(sport, 'standard', draftType)
  return { ...setup, playoffTeams: Math.min(setup.playoffTeams, teamCount) }
}

export function nextStateForLeagueType(state: CreateLeagueV2State, leagueType: LeagueTypeId): Partial<CreateLeagueV2State> {
  const draftTypeOptions = getDraftTypeOptions(leagueType, state.sport)
  const draftType = draftTypeOptions.some((option) => option.id === state.draftType)
    ? state.draftType
    : (draftTypeOptions[0]?.id ?? 'snake') as WizardDraftType
  const scoringPresetId = resolveValidScoringPresetIdForSelection('', {
    leagueType,
    sport: state.sport,
    idpSelected: false,
  })

  return {
    leagueType,
    idpSelected: false,
    scoringPresetId,
    draftType,
    teamCount: getTeamCountOptions(state.sport, leagueType, state.soccerPipeline).includes(state.teamCount)
      ? state.teamCount : getDefaultTeamCount(state.sport, leagueType, state.soccerPipeline),
    ...(leagueType === 'survivor' ? { survivorTribeCount: getSurvivorTribeOptions(
      getTeamCountOptions(state.sport, leagueType, state.soccerPipeline).includes(state.teamCount)
        ? state.teamCount : getDefaultTeamCount(state.sport, leagueType, state.soccerPipeline),
    ).includes(state.survivorTribeCount) ? state.survivorTribeCount : 2 } : {}),
    dynasty: fitDynastySetupToTeamCount(getDefaultDynastySetup(state.sport, draftType), getTeamCountOptions(state.sport, leagueType, state.soccerPipeline).includes(state.teamCount) ? state.teamCount : getDefaultTeamCount(state.sport, leagueType, state.soccerPipeline)),
    keeper: getDefaultKeeperSetup(),
    bestBall: bestBallSetupForTeamCount(state.sport, draftType, getTeamCountOptions(state.sport, leagueType, state.soccerPipeline).includes(state.teamCount) ? state.teamCount : getDefaultTeamCount(state.sport, leagueType, state.soccerPipeline)),
  }
}

/** The format a brand-new create starts on. */
/**
 * Each sport starts on its first currently available specialty. NBA opens the Survivor
 * creation pilot; the underlying format engine remains available for existing leagues.
 */
export const SPORT_DEFAULT_FORMATS: readonly LeagueTypeId[] = ['survivor', 'guillotine', 'big_brother']

export function defaultLeagueTypeForSport(sport: SupportedSport): LeagueTypeId {
  return SPORT_DEFAULT_FORMATS.find((leagueType) =>
    isSportAllowedForType(sport, leagueType) &&
    // NFL Survivor is offered but not preselected: a fresh NFL create still starts on Guillotine.
    (leagueType !== 'survivor' || isSurvivorDefaultFormatSport(sport))) ?? 'redraft'
}

/**
 * The starting state for a fresh create (no import, nothing restored from this tab): the sport's
 * default format, built with the same transition a tap on that tile runs, so the draft type, team
 * size and scoring preset are ones the format accepts — not Redraft's left in place.
 */
export function freshCreateLeagueState(base: CreateLeagueV2State): CreateLeagueV2State {
  const leagueType = defaultLeagueTypeForSport(base.sport)
  // Seed the format's own default cast: the transition below keeps any size the format accepts,
  // and Redraft's 12 is a valid Survivor cast now, so a fresh NBA Survivor would otherwise start
  // at 12 instead of 16.
  const start = {
    ...base,
    leagueType: base.leagueType ?? 'redraft',
    leagueTypeTouched: false,
    teamCount: getDefaultTeamCount(base.sport, leagueType, base.soccerPipeline),
  }
  return { ...start, ...nextStateForLeagueType(start, leagueType) }
}

/** IDP is a redraft shell with defensive players; it carries its own draft and scoring lists. */
export function nextStateForIdp(state: CreateLeagueV2State): Partial<CreateLeagueV2State> {
  const next = nextStateForLeagueType(state, 'redraft')
  const draftOptions = getIdpDraftTypeOptions()
  return {
    ...next,
    idpSelected: true,
    draftType: draftOptions.some((option) => option.id === state.draftType)
      ? state.draftType
      : (draftOptions[0]?.id ?? 'snake') as WizardDraftType,
    scoringPresetId: resolveValidScoringPresetIdForSelection('', {
      leagueType: 'redraft', sport: state.sport, idpSelected: true,
    }),
  }
}

function useEnsureSimpleDefaults(state: CreateLeagueV2State, onChange: WizardProps['onChange']) {
  useEffect(() => {
    if (state.leagueType && state.scoringPresetId) return
    const leagueType = state.leagueType ?? 'redraft'
    onChange({
      leagueType,
      scoringPresetId: resolveValidScoringPresetIdForSelection(state.scoringPresetId, {
        leagueType,
        sport: state.sport,
        idpSelected: state.idpSelected,
      }),
    })
  }, [onChange, state.idpSelected, state.leagueType, state.scoringPresetId, state.sport])
}

/** Which step owns each completion issue, so Review can send the manager straight to the fix. */
const ISSUE_STEP: Record<string, WizardStep> = {
  sport_required: 'sport',
  concept_required: 'basics',
  team_count_required: 'basics',
  team_count_invalid: 'basics',
  survivor_tribes_invalid: 'basics',
  survivor_season_too_short: 'basics',
  survivor_dues_invalid: 'basics',
  league_name_invalid: 'basics',
  tournament_pool_invalid: 'basics',
  tournament_pool_mismatch: 'basics',
}

export function stepForIssue(code: string): WizardStep {
  return ISSUE_STEP[code] ?? 'draft'
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

export function CreateLeagueWizard(props: WizardProps) {
  const { t, language } = useLanguage()
  const [interactive, setInteractive] = useState(false)
  useEffect(() => setInteractive(true), [])
  const [activeStep, setActiveStep] = useState<WizardStep>('sport')
  const [importOpen, setImportOpen] = useState(false)
  const entitlements = useEntitlements()
  const isCommissioner = entitlements.hasCommissioner
  const reducedMotion = usePrefersReducedMotion()
  const navRef = useRef<HTMLElement | null>(null)
  const firstRender = useRef(true)

  useEnsureSimpleDefaults(props.state, props.onChange)

  const enabledPremium = getEnabledPremiumAdvancedSettings(props.state.advancedSetup)

  // A premium toggle restored from sessionStorage (or left on after a plan lapsed) is still sent
  // on submit, and the server answers 403 — while the checkbox is disabled, so it cannot be
  // cleared. Drop them once we know the manager is not entitled.
  const { onChange } = props
  const hasStalePremium = !entitlements.loading && !isCommissioner && enabledPremium.length > 0
  useEffect(() => {
    if (hasStalePremium) onChange({ advancedSetup: {} })
  }, [hasStalePremium, onChange])
  const canCreate = props.completionIssues.length === 0 && !props.createdLeagueHref

  /*
   * ⚠ ON A PHONE THE NEXT BUTTON IS BELOW A LONG STEP, so changing step without scrolling leaves
   * the manager in the middle of the new step with no sign that it changed. Bring the progress
   * bar back into view — only when it has scrolled off, so a desktop click on a step tab that is
   * already on screen does not jump the page.
   */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const nav = navRef.current
    if (!nav || typeof nav.scrollIntoView !== 'function') return
    if (nav.getBoundingClientRect().top < 0) {
      nav.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    }
  }, [activeStep, reducedMotion])

  const activeIndex = STEP_ORDER.indexOf(activeStep)
  const nextStep = STEP_ORDER[Math.min(STEP_ORDER.length - 1, activeIndex + 1)] ?? 'review'
  const goBack = () => setActiveStep(STEP_ORDER[Math.max(0, activeIndex - 1)] ?? 'sport')
  const goNext = () => setActiveStep(nextStep)
  const stepsWithIssues = new Set(props.completionIssues.map((issue) => stepForIssue(issue.code)))

  return (
    <div className="min-h-screen bg-[color:var(--surface-app)] text-[color:var(--text-primary)]" data-testid="g30-create-league-wizard">
      <fieldset disabled={!interactive || props.submitting} aria-busy={!interactive || props.submitting} className="m-0 min-w-0 border-0 p-0">
      {/*
        Bottom padding below `sm` is the fixed action bar plus the home indicator, so the last
        field on a step is never hidden behind Back / Next. Side padding honours the notch in
        landscape on iPhone.
      */}
      <main className="mx-auto grid max-w-7xl gap-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 sm:gap-6 sm:px-6 sm:pb-10 sm:pt-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-10">
        <section className="min-w-0 space-y-4 sm:space-y-5">
          <header className="space-y-3">
            {/* The theme toggle is fixed to the top-right corner on this route; keep the logo row clear of it. */}
            <div className="flex min-h-11 items-center pr-16 lg:pr-0">
              <Image src="/brand/allfantasy-wordmark-transparent.png" alt="AllFantasy" width={1198} height={306} priority className="h-auto w-36 max-w-full sm:w-52" />
            </div>
            {props.importSourceName ? (
              <p className="rounded-xl border border-violet-500/35 bg-violet-600/10 p-3 text-sm leading-6" data-testid="standalone-import-template-notice">
                Creating a native AllFantasy league from {props.importSourceName}. Teams, current player rosters, and available season history carry over. Claimed managers keep their seats; other managers must claim theirs. Supported baseball points rules or standard category rules are preserved; unsupported rules stop creation for review. The imported roster snapshot is recorded separately from historical drafts. Baseball imports after the regular season prepare for next season; past results remain archived. Chat stays in the original import. Keep the sport and team count the same to preserve every roster.
              </p>
            ) : null}
            {props.importCarryover && props.state.sport === 'MLB' ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm leading-6">
                <CheckBox className="mt-1" checked={props.acceptWeeklyLineups ?? false} onChange={(checked) => props.onAcceptWeeklyLineups?.(checked)} />
                <span>Use weekly lineups in this native baseball league. One lineup locks at the first game of each week and scores the entire week. Daily lineup changes from the source platform remain in the archive.</span>
              </label>
            ) : null}
            {props.creationWarning && props.createdLeagueHref ? (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm leading-6" role="status">
                {props.creationWarning}{' '}
                <a href={props.createdLeagueHref} className="font-bold underline">Open your league</a>
                {props.onRetryFinalization ? (
                  <button type="button" onClick={props.onRetryFinalization} disabled={props.retryingFinalization} className="ml-3 font-bold underline disabled:opacity-50">
                    {props.retryingFinalization ? 'Retrying setup…' : 'Retry roster setup'}
                  </button>
                ) : null}
              </div>
            ) : null}
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300 sm:text-xs">
              {t('createLeague.g30.eyebrow')}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h1 className="text-[1.75rem] font-black leading-tight tracking-tight sm:text-4xl">
                  {t('createLeague.g30.title')}
                </h1>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)] sm:mt-2">
                  {t('createLeague.g30.subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="inline-flex min-h-11 w-full shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl border border-violet-500/35 bg-violet-600/10 px-4 text-sm font-bold text-violet-700 transition hover:bg-violet-600/15 dark:text-violet-200 sm:w-auto"
                data-testid="g30-import-league-button"
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                {t('createLeague.g30.import.button')}
              </button>
            </div>
            {props.importedLeagues && props.importedLeagues.length > 0 ? (
              <ImportedLeaguesCard leagues={props.importedLeagues} />
            ) : null}
          </header>

          {/* scroll-mt clears the theme toggle fixed to the top-right corner on this route. */}
          <nav ref={navRef} className="scroll-mt-[4.5rem] lg:scroll-mt-3" aria-label={t('createLeague.g30.steps.aria')}>
            <ol className="grid grid-cols-4 gap-1 sm:gap-2">
              {STEP_ORDER.map((step, index) => {
                const selected = activeStep === step
                const visited = index < activeIndex
                const needsAttention = visited && stepsWithIssues.has(step)
                return (
                  <li key={step} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setActiveStep(step)}
                      aria-current={selected ? 'step' : undefined}
                      className={cx(
                        'flex min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-bold transition sm:min-h-12 sm:flex-row sm:justify-start sm:gap-2 sm:border sm:px-2.5 sm:text-xs',
                        selected
                          ? 'text-violet-700 dark:text-violet-200 sm:border-violet-500 sm:bg-violet-600 sm:text-[#ffffff] sm:shadow-lg sm:shadow-violet-600/20 sm:dark:text-[#ffffff]'
                          : 'text-[color:var(--text-secondary)] sm:border-[color:var(--border-subtle)] sm:bg-[color:var(--surface-card)] [@media(hover:hover)]:hover:text-[color:var(--text-primary)] sm:[@media(hover:hover)]:hover:border-violet-400',
                      )}
                      data-testid={`g30-step-${step}`}
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-black transition sm:h-6 sm:w-6 sm:text-[11px]',
                          selected
                            ? 'border-violet-500 bg-violet-600 text-[#ffffff] sm:border-[rgba(255,255,255,0.4)] sm:bg-[rgba(255,255,255,0.15)]'
                            : needsAttention
                              ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-200'
                              : visited
                                ? 'border-violet-500/60 bg-violet-600/15 text-violet-700 dark:text-violet-200'
                                : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card)]',
                        )}
                      >
                        {needsAttention ? '!' : visited ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                      </span>
                      <span className="block max-w-full truncate">{t(`createLeague.g30.steps.${step}`)}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[color:var(--border-subtle)] sm:hidden" aria-hidden="true">
              <div
                className="h-full rounded-full bg-violet-600 transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${((activeIndex + 1) / STEP_ORDER.length) * 100}%` }}
              />
            </div>
          </nav>

          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-3.5 shadow-xl shadow-black/5 sm:p-5">
            {activeStep === 'sport' ? (
              <SportStep state={props.state} onChange={props.onChange} importCarryover={props.importCarryover} />
            ) : null}
            {activeStep === 'basics' ? (
              <LeagueBasicsStep state={props.state} onChange={props.onChange} fieldErrors={props.fieldErrors} importCarryover={props.importCarryover} hasCommissioner={isCommissioner} />
            ) : null}
            {activeStep === 'draft' ? (
              <DraftStep state={props.state} onChange={props.onChange} fieldErrors={props.fieldErrors} />
            ) : null}
            {activeStep === 'review' ? (
              <ReviewCreateStep
                state={props.state}
                completionIssues={props.completionIssues}
                submitError={props.submitError}
                onFixIssue={(code) => setActiveStep(stepForIssue(code))}
                onScheduleLater={() => props.onChange({ draftScheduleLater: true })}
                onEditStep={setActiveStep}
                onChange={props.onChange}
                hasCommissioner={isCommissioner}
                entitlementsLoading={entitlements.loading}
              />
            ) : null}
          </div>

          {/*
            Below `sm` the action row is a bar fixed to the bottom of the screen, where a thumb is,
            padded for the iPhone home indicator and the Android gesture bar. From `sm` up it is the
            ordinary inline row. Cancel stays in the page flow on a phone: it is the one action a
            stray tap should not reach.
          */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--border-subtle)] bg-[color:var(--surface-app)]/95 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
            <div className="flex items-center gap-3 sm:justify-between">
              <button
                type="button"
                onClick={props.onCancel}
                disabled={props.submitting}
                className="hidden min-h-11 rounded-xl border border-[color:var(--border-subtle)] px-4 text-sm font-bold text-[color:var(--text-secondary)] transition hover:border-violet-400 disabled:opacity-60 sm:inline-flex sm:items-center"
              >
                {t('createLeague.v2.cancel')}
              </button>
              <div className="flex flex-1 gap-3 sm:flex-none">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={activeStep === 'sport' || props.submitting}
                  className="inline-flex min-h-12 touch-manipulation items-center justify-center gap-1 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] px-4 text-sm font-bold text-[color:var(--text-secondary)] transition hover:border-violet-400 disabled:opacity-50 sm:min-h-11 sm:bg-transparent"
                >
                  <ChevronLeft aria-hidden="true" className="-ml-1 h-4 w-4" />
                  {t('createLeague.g30.back')}
                </button>
                {activeStep === 'review' ? (
                  <button
                    type="button"
                    onClick={props.onSubmit}
                    disabled={!canCreate || props.submitting}
                    className="inline-flex min-h-12 flex-1 touch-manipulation items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-black text-[#ffffff] shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 active:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-11 sm:flex-none"
                    data-testid="g30-create-league-submit"
                  >
                    {props.submitting ? t('createLeague.g30.creating') : t('createLeague.v2.create')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex min-h-12 flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-5 text-sm font-black text-[#ffffff] shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 active:bg-violet-700 sm:min-h-11 sm:flex-none"
                  >
                    {t('createLeague.g30.next')}
                    <span className="font-semibold text-[rgba(255,255,255,0.75)]">· {t(`createLeague.g30.steps.${nextStep}`)}</span>
                    <ChevronRight aria-hidden="true" className="-mr-1 h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-center sm:hidden">
            <button
              type="button"
              onClick={props.onCancel}
              disabled={props.submitting}
              className="min-h-11 touch-manipulation px-4 text-sm font-bold text-[color:var(--text-tertiary)] underline-offset-4 hover:underline disabled:opacity-60"
            >
              {t('createLeague.v2.cancel')}
            </button>
          </div>
        </section>

        <aside className="min-w-0 lg:sticky lg:top-20 lg:h-fit">
          <LeaguePreviewCard
            state={props.state}
            language={language}
            enabledPremiumCount={enabledPremium.length}
          />
        </aside>
      </main>
      </fieldset>

      {importOpen ? <ImportLeagueModal onClose={() => setImportOpen(false)} /> : null}
    </div>
  )
}

export type ImportedLeagueSummary = { id: string; name: string; sport: string }

/**
 * Imported leagues this manager commissions, offered for conversion to a native league. The id
 * is the anchor the `/core` import screen links to (`/create-league#imported-leagues`), and it
 * opens itself when arrived at that way.
 */
function ImportedLeaguesCard({ leagues }: { leagues: ImportedLeagueSummary[] }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#imported-leagues') setOpen(true)
  }, [])
  return (
    <details
      id="imported-leagues"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="group scroll-mt-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)]"
      data-testid="g30-imported-leagues"
    >
      <summary className="flex min-h-12 cursor-pointer touch-manipulation list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
        <span>
          {tx(t, 'createLeague.g30.imported.title', 'Make an imported league native')}
          <span className="ml-2 rounded-full bg-violet-600/15 px-2 py-0.5 text-[11px] font-black text-violet-700 dark:text-violet-200">{leagues.length}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className="space-y-2 border-t border-[color:var(--border-subtle)] p-3">
        {leagues.map((league) => (
          <li key={league.id}>
            <a
              href={`/create-league?fromLeague=${encodeURIComponent(league.id)}`}
              className="flex min-h-12 touch-manipulation items-center justify-between gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] px-3 py-2 text-sm transition hover:border-violet-400"
            >
              <span className="min-w-0">
                <span className="block truncate font-bold">{league.name || tx(t, 'createLeague.g30.imported.unnamed', 'Imported league')}</span>
                <span className="block text-xs text-[color:var(--text-tertiary)]">{league.sport}</span>
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function SportStep({ state, onChange, importCarryover }: Pick<WizardProps, 'state' | 'onChange' | 'importCarryover'>) {
  const { t } = useLanguage()

  return (
    <section className="space-y-4" data-testid="g30-sport-step">
      <StepHeader title={t('createLeague.g30.sport.title')} body={t('createLeague.g30.sport.body')} />
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        {SUPPORTED_SPORTS.map((sport) => {
          const selected = state.sport === sport
          const media = SPORT_MEDIA[sport]
          /*
           * ⚠ SAY WHAT WILL NOT WORK, AT THE MOMENT OF CHOOSING. A sport outside
           * `SEASON_CAPABLE_SPORTS` (lib/sport-scope.ts) cannot run a season end
           * to end: its matchups never finalize and the league sits at week 1
           * forever with nothing red anywhere. Choosing the sport is the last
           * point where that is cheap to know. That list is the authority — this
           * comment once said "only NFL" long after it stopped being true.
           *
           * ⚠ LABELLED, NOT BLOCKED, AND THAT IS A DELIBERATE CHOICE. The tile
           * supports `disabled`, and using it would also remove draft-only and
           * Decision-OS use of those sports, which work fine. The harm here is
           * being MISLED, not being able to choose — so the fix is to stop
           * misleading. Swap to `disabled` if the product decision changes.
           */
          const seasonCapable = canRunSeasonForSport(sport)
          return (
            <CreateLeagueVideoTile
              key={sport}
              title={t(`createLeague.sport.${sport.toLowerCase()}`)}
              hint={
                seasonCapable
                  ? t('createLeague.g30.sport.cardHint')
                  : tx(t, 'createLeague.g30.sport.noScoringHint', 'Draft and league tools only — no weekly scoring yet')
              }
              selected={selected}
              disabled={importCarryover && !selected}
              media={media}
              onSelect={() => onChange(nextStateForSport(state, sport))}
              testId={`g30-sport-${sport}`}
            />
          )
        })}
      </div>
      {/* The tile hint is short enough for a two-column phone grid; say it in full once chosen. */}
      {canRunSeasonForSport(state.sport) ? null : (
        <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm leading-6" data-testid="g30-sport-season-note">
          {tx(t, 'createLeague.g30.sport.noScoringNote', 'Weekly scoring is not wired for this sport yet. You can draft and use league tools, but weekly matchups will not be scored.')}
        </p>
      )}
    </section>
  )
}

export function LeagueBasicsStep({
  state,
  onChange,
  fieldErrors,
  importCarryover,
  hasCommissioner = false,
}: Pick<WizardProps, 'state' | 'onChange' | 'fieldErrors' | 'importCarryover'> & { hasCommissioner?: boolean }) {
  const { t } = useLanguage()
  // Only the concepts the server accepts for this sport (the catalog's allowedSportsByConcept).
  // A carryover keeps the imported league's team count, which the import-flexible types accept
  // even when their native list lacks it (lib/league-creation/importedTeamCount.ts).
  const importedTeamCount = importCarryover ? state.teamCount : null
  // Odd keeper sizes are an AF Commissioner option: without the plan they leave the stepper and are
  // shown locked below instead (lib/league/oddTeamLeagues.ts). A carryover keeps its own size.
  const teamCountOptionsFor = (leagueType: LeagueTypeId) =>
    teamCountOptionsWithImported(
      importCarryover
        ? getTeamCountOptions(state.sport, leagueType, state.soccerPipeline)
        : teamCountOptionsForPlan(getTeamCountOptions(state.sport, leagueType, state.soccerPipeline), leagueType, hasCommissioner),
      leagueType,
      importedTeamCount,
    )
  const teamCountOptions = teamCountOptionsFor(getEffectiveLeagueType(state) ?? 'redraft')
  const lockedTeamCounts = importCarryover
    ? []
    : lockedOddTeamCounts(getTeamCountOptions(state.sport, getEffectiveLeagueType(state) ?? 'redraft', state.soccerPipeline), getEffectiveLeagueType(state), hasCommissioner)
  const teamCountStep = teamCountOptions.length > 1 ? teamCountOptions[1] - teamCountOptions[0] : 1
  const catalog = getClientLeagueCreateOptionsCatalog()
  const typeOptions = catalog.concepts.filter((concept) =>
    concept.id !== 'idp' && isSportAllowedForType(state.sport, concept.id as LeagueTypeId) &&
      (!importCarryover || teamCountOptionsFor(concept.id as LeagueTypeId).includes(state.teamCount)),
  )
  const showIdp = catalog.concepts.some((concept) => concept.id === 'idp') &&
    (state.sport === 'NFL' || state.sport === 'NCAAF') &&
    (!importCarryover || teamCountOptionsFor('redraft').includes(state.teamCount))
  const setTeamCount = (teamCount: number) => {
    const tribeOptions = getSurvivorTribeOptions(teamCount)
    // League median follows the size's parity until the commissioner sets it: an odd league leaves one
    // team without an opponent each week, and the median game is what still gives it a result.
    const medianFollowsSize = ODD_TEAM_MEDIAN_LEAGUE_TYPES.has(getEffectiveLeagueType(state) ?? 'redraft') &&
      isOddTeamCount(teamCount) !== isOddTeamCount(state.teamCount)
    onChange({ teamCount, ...(medianFollowsSize ? { medianGame: isOddTeamCount(teamCount) } : {}),
      ...(getEffectiveLeagueType(state) === 'survivor' && !tribeOptions.includes(state.survivorTribeCount)
      ? { survivorTribeCount: tribeOptions[0] ?? 2 } : {}),
      ...(state.leagueType === 'dynasty' ? { dynasty: fitDynastySetupToTeamCount(state.dynasty, teamCount) } : {}),
      ...(state.leagueType === 'best_ball' ? { bestBall: { ...state.bestBall, playoffTeams: Math.min(state.bestBall.playoffTeams, Math.max(0, teamCount)) } } : {}) })
  }
  const canFewer = teamCountOptions.some((count) => count < state.teamCount)
  const canMore = teamCountOptions.some((count) => count > state.teamCount)
  /** Walks to the next allowed size, so a typed off-step value (7 in a 4, 6, 8 list) snaps back on. */
  const stepTeamCount = (direction: 1 | -1) => {
    const next = direction > 0
      ? teamCountOptions.find((count) => count > state.teamCount)
      : [...teamCountOptions].reverse().find((count) => count < state.teamCount)
    if (next != null) setTeamCount(next)
  }
  const nameTooShort = state.nameTouched === true && state.name.trim().length > 0 && state.name.trim().length < 3

  type FormatTile = { id: string; title: string; hint: string; selected: boolean; onSelect: () => void; media: (typeof LEAGUE_TYPE_MEDIA)[keyof typeof LEAGUE_TYPE_MEDIA] }
  const tiles: FormatTile[] = typeOptions.map((concept) => {
    const leagueType = concept.id as LeagueTypeId
    return {
      id: leagueType,
      title: getLeagueTypeLabel(t, leagueType, concept.title),
      hint: tx(t, `createLeague.g30.leagueType.${leagueType}.hint`, concept.subtitle),
      selected: !state.idpSelected && getEffectiveLeagueType(state) === leagueType,
      onSelect: () => onChange({ ...nextStateForLeagueType(state, leagueType), leagueTypeTouched: true }),
      media: LEAGUE_TYPE_MEDIA[leagueType],
    }
  })
  if (showIdp) {
    tiles.push({
      id: 'idp',
      title: 'IDP',
      hint: tx(t, 'createLeague.g30.leagueType.idp.hint', 'Draft individual defensive players'),
      selected: state.idpSelected,
      onSelect: () => onChange({ ...nextStateForIdp(state), leagueTypeTouched: true }),
      media: LEAGUE_TYPE_MEDIA.idp,
    })
  }
  // Any format not named as a classic is a specialty, so a new catalog concept lands up front.
  const specialtyTiles = tiles
    .filter((tile) => !CLASSIC_FORMATS.includes(tile.id))
    .sort((x, y) => specialtyRank(x.id) - specialtyRank(y.id))
  const classicTiles = tiles
    .filter((tile) => CLASSIC_FORMATS.includes(tile.id))
    .sort((x, y) => CLASSIC_FORMATS.indexOf(x.id) - CLASSIC_FORMATS.indexOf(y.id))
  const renderFormatTile = (sizeClass: string) => function FormatTileRender(tile: FormatTile) { return (
    <CreateLeagueVideoTile
      key={tile.id}
      title={tile.title}
      hint={tile.hint}
      selected={tile.selected}
      media={tile.media}
      onSelect={tile.onSelect}
      className={sizeClass}
      testId={`g30-league-type-${tile.id}`}
    />
  ) }

  return (
    <section className="space-y-5" data-testid="g30-basics-step">
      <StepHeader title={t('createLeague.g30.basics.title')} body={t('createLeague.g30.basics.body')} />
      {/*
        Specialty formats lead — they are what AllFantasy is built around — and the classics follow
        as a compact row. Both groups are always visible: nothing is hidden behind a "more" toggle.
      */}
      {specialtyTiles.length > 0 ? (
        <div className="space-y-2.5" data-testid="g30-specialty-formats">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
              {tx(t, 'createLeague.g30.formats.specialty', 'Specialty formats')}
              <HelpTip label={tx(t, 'createLeague.g30.formats.specialty', 'Specialty formats')} testId="g30-help-formats">{help(t, 'formats')}</HelpTip>
            </p>
            <p className="mt-0.5 text-xs leading-5 text-[color:var(--text-secondary)]">
              {tx(t, 'createLeague.g30.formats.specialtyBody', 'Eliminations, alliances, college stars and more.')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            {specialtyTiles.map(renderFormatTile('min-h-[7.25rem] sm:min-h-36'))}
          </div>
        </div>
      ) : null}
      {classicTiles.length > 0 ? (
        <div className="space-y-2.5" data-testid="g30-classic-formats">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[color:var(--text-tertiary)]">
            {tx(t, 'createLeague.g30.formats.classic', 'Classic formats')}
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            {classicTiles.map(renderFormatTile('min-h-[4.75rem] sm:min-h-20'))}
          </div>
        </div>
      ) : null}

      {(getEffectiveLeagueType(state) === 'devy' || getEffectiveLeagueType(state) === 'c2c') ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6">
          {tx(t, 'createLeague.g30.collegeNote', 'College formats are new. Check the roster, scoring and future-season rules before you invite managers.')}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="space-y-2">
          <label htmlFor="g30-league-name-input" className="block text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.name.label')}
          </label>
          <input
            id="g30-league-name-input"
            value={state.name}
            onChange={(event) => onChange({ name: event.target.value, nameTouched: true })}
            className={fieldClass(Boolean(fieldErrors?.leagueName) || nameTooShort)}
            placeholder={t('createLeague.g30.name.placeholder')}
            maxLength={100}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="done"
            aria-invalid={Boolean(fieldErrors?.leagueName) || nameTooShort || undefined}
            aria-describedby="g30-league-name-hint"
            data-testid="g30-league-name"
          />
          <span id="g30-league-name-hint" className={cx('block text-xs', fieldErrors?.leagueName || nameTooShort ? 'text-rose-600 dark:text-rose-300' : 'text-[color:var(--text-secondary)]')}>
            {fieldErrors?.leagueName ?? (nameTooShort
              ? tx(t, 'createLeague.g30.name.tooShort', 'Use at least 3 characters.')
              : tx(t, 'createLeague.g30.name.hint', '3 to 100 characters'))}
          </span>
        </div>
        <div className="space-y-2">
          <label htmlFor="g30-team-count-input" className="block text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.teamCount.label')}
            <HelpTip label={t('createLeague.g30.teamCount.label')} testId="g30-help-teams">{help(t, 'teams')}</HelpTip>
          </label>
          {/*
            Typing a number on a phone keypad and getting it refused is the slow path, so the
            steppers walk the sizes this format actually allows (4, 6, 8… for dynasty). The input
            stays for typing and keeps its min / max / step for the server's rules.
          */}
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => stepTeamCount(-1)}
              disabled={importCarryover || !canFewer}
              aria-label={tx(t, 'createLeague.g30.teamCount.fewer', 'Fewer teams')}
              className="grid min-h-12 w-12 shrink-0 touch-manipulation place-items-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-primary)] transition hover:border-violet-400 disabled:opacity-40 sm:min-h-11 sm:w-11"
              data-testid="g30-team-count-decrease"
            >
              <Minus aria-hidden="true" className="h-4 w-4" />
            </button>
            <input
              id="g30-team-count-input"
              type="number"
              inputMode="numeric"
              min={teamCountOptions[0] ?? 2}
              max={teamCountOptions.at(-1) ?? 32}
              step={teamCountStep}
              aria-describedby="g30-team-count-options"
              value={state.teamCount}
              disabled={importCarryover}
              onChange={(event) => setTeamCount(Number(event.target.value))}
              className={cx(fieldClass(Boolean(fieldErrors?.teamCount)), 'text-center tabular-nums')}
              data-testid="g30-team-count"
            />
            <button
              type="button"
              onClick={() => stepTeamCount(1)}
              disabled={importCarryover || !canMore}
              aria-label={tx(t, 'createLeague.g30.teamCount.more', 'More teams')}
              className="grid min-h-12 w-12 shrink-0 touch-manipulation place-items-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-primary)] transition hover:border-violet-400 disabled:opacity-40 sm:min-h-11 sm:w-11"
              data-testid="g30-team-count-increase"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <span id="g30-team-count-options" className="block text-xs text-[color:var(--text-secondary)]">
            {teamCountStep === 1 ? `${teamCountOptions[0]} to ${teamCountOptions.at(-1)}` : teamCountOptions.join(', ')}
          </span>
          {lockedTeamCounts.length > 0 ? (
            <span className="block text-xs text-[color:var(--text-secondary)]" data-testid="g30-team-count-locked">
              <Lock aria-hidden="true" className="mr-1 inline h-3 w-3" />
              {lockedTeamCounts.includes(state.teamCount)
                ? tx(t, 'createLeague.g30.teamCount.oddLockedChosen', `A ${state.teamCount}-team keeper league is part of AF Commissioner. Choose an even size, or upgrade.`)
                : tx(t, 'createLeague.g30.teamCount.oddLocked', `Odd sizes (${lockedTeamCounts.join(', ')}) are part of AF Commissioner.`)}{' '}
              <a href="/pricing?plan=commissioner" className="font-bold text-violet-600 underline dark:text-violet-300" data-testid="g30-team-count-upgrade">
                {tx(t, 'createLeague.g30.teamCount.oddUpgrade', 'Upgrade')}
              </a>
            </span>
          ) : null}
          {getEffectiveLeagueType(state) === 'guillotine' && guillotineNeedsDoubleElimination(state.teamCount) ? (
            <span className="block text-xs text-amber-300" data-testid="g30-guilly-double-elimination-note">
              {tx(t, 'createLeague.g30.teamCount.guillyDouble', `Over ${GUILLOTINE_SINGLE_ELIMINATION_MAX_TEAMS} teams needs double-elimination weeks — add them in league settings after creating.`)}
            </span>
          ) : null}
        </div>
      </div>

      {getEffectiveLeagueType(state) === 'survivor' ? (
        <div className="space-y-4 rounded-2xl border border-violet-500/25 bg-violet-600/5 p-4" data-testid="g30-survivor-setup">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">Commissioner role</p>
            <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">A playing commissioner takes one cast seat. Chimmy runs private votes and idols without revealing them to that commissioner.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([
                { value: 'non_participating_host', label: 'Host only', hint: 'All cast seats are available for invited managers.' },
                { value: 'participating_player', label: 'Play as a manager', hint: 'Your team takes one of the cast seats.' },
              ] as const).map((option) => (
                <button key={option.value} type="button"
                  aria-pressed={state.survivorCommissionerParticipationMode === option.value}
                  onClick={() => onChange({ survivorCommissionerParticipationMode: option.value })}
                  className={cx('min-h-12 rounded-xl border p-3 text-left transition',
                    state.survivorCommissionerParticipationMode === option.value
                      ? 'border-violet-500 bg-violet-600/12' : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)]')}
                  data-testid={`g30-survivor-role-${option.value}`}>
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="block text-xs text-[color:var(--text-secondary)]">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">Starting tribes</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {getSurvivorTribeOptions(state.teamCount).map((count) => (
                <button key={count} type="button" aria-pressed={state.survivorTribeCount === count}
                  onClick={() => onChange({ survivorTribeCount: count })}
                  className={cx('min-h-11 min-w-12 rounded-xl border px-4 text-sm font-bold',
                    state.survivorTribeCount === count
                      ? 'border-violet-500 bg-violet-600/12' : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)]')}
                  data-testid={`g30-survivor-tribes-${count}`}>{count}</button>
              ))}
            </div>
          </div>
          <p className="text-xs leading-5 text-[color:var(--text-secondary)]">Exile Island is on by default. Fill every cast seat with a unique manager before starting the draft.</p>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
          {t('createLeague.g30.privacy.label')}
          <HelpTip label={t('createLeague.g30.privacy.label')} testId="g30-help-privacy">{help(t, 'privacy')}</HelpTip>
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(['private', 'public'] as const).map((privacy) => (
            <button
              key={privacy}
              type="button"
              onClick={() => onChange({ privacy })}
              aria-pressed={state.privacy === privacy}
              className={cx(
                'flex min-h-12 touch-manipulation items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm font-bold transition',
                state.privacy === privacy
                  ? 'border-violet-500 bg-violet-600/12 text-violet-700 dark:text-violet-200'
                  : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-secondary)] [@media(hover:hover)]:hover:border-violet-400',
              )}
              data-testid={`g30-privacy-${privacy}`}
            >
              {t(`createLeague.g30.privacy.${privacy}`)}
              {state.privacy === privacy ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={3} /> : null}
            </button>
          ))}
        </div>
      </div>

      {/* A guillotine week has no opponent — every team plays the chop line — so there is no
          head-to-head game for a median game to double. */}
      {getEffectiveLeagueType(state) === 'guillotine' ? null : (
      <label
        className={cx(
          'flex min-h-12 cursor-pointer touch-manipulation items-start gap-3 rounded-xl border px-4 py-3 text-sm transition',
          state.medianGame === true
            ? 'border-violet-500 bg-violet-600/10'
            : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)]',
        )}
        data-testid="g30-median-game"
      >
        <CheckBox
          className="mt-0.5"
          checked={state.medianGame === true}
          onChange={(checked) => onChange({ medianGame: checked })}
        />
        <span>
          <span className="block font-bold">{t('createLeague.g30.medianGame.label')}</span>
          <span className="block text-xs leading-5 text-[color:var(--text-secondary)]">
            {t('createLeague.g30.medianGame.body')}
          </span>
        </span>
      </label>
      )}

      {/* Guilly only: lineups set themselves (lib/guillotine/guillotineBestBall.ts). */}
      {getEffectiveLeagueType(state) === 'guillotine' ? (
      <label
        className={cx(
          'flex min-h-12 cursor-pointer touch-manipulation items-start gap-3 rounded-xl border px-4 py-3 text-sm transition',
          state.guillotineBestBall === true
            ? 'border-violet-500 bg-violet-600/10'
            : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)]',
        )}
        data-testid="g30-guillotine-best-ball"
      >
        <CheckBox
          className="mt-0.5"
          checked={state.guillotineBestBall === true}
          onChange={(checked) => onChange({ guillotineBestBall: checked })}
        />
        <span>
          <span className="block font-bold">{t('createLeague.g30.guillotineBestBall.label')}</span>
          <span className="block text-xs leading-5 text-[color:var(--text-secondary)]">
            {t('createLeague.g30.guillotineBestBall.body')}
          </span>
        </span>
      </label>
      ) : null}
    </section>
  )
}

/**
 * NBA / NHL / MLB dynasty format presets. Choosing one writes the scoring preset and the bench / IR /
 * taxi depth the dynasty conceptSetup already sends; editing any of those afterwards shows "Custom".
 */
export function DynastySportPresetPicker({
  state,
  onChange,
}: Pick<WizardProps, 'state' | 'onChange'>) {
  const { language } = useLanguage()
  const lang = dynastyFormatLang(language)
  const presets = getDynastySportPresets(state.sport)
  if (getEffectiveLeagueType(state) !== 'dynasty' || state.idpSelected || presets.length === 0) return null
  const copy = DYNASTY_FORMAT_UI_COPY[lang]
  const selected = matchDynastySportPreset(state.sport, state.scoringPresetId, state.dynasty)
  return (
    <label className="block space-y-2 md:max-w-sm" data-testid="g30-dynasty-sport-preset-field">
      <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">{copy.formatLabel}</span>
      <select
        value={selected?.id ?? ''}
        onChange={(event) => {
          const preset = findDynastySportPreset(event.target.value)
          if (!preset) return
          onChange({ scoringPresetId: preset.scoringPresetId, dynasty: applyDynastySportPresetToSetup(state.dynasty, preset) })
        }}
        className={fieldClass(false)}
        data-testid="g30-dynasty-sport-preset"
      >
        {selected ? null : <option value="">{copy.custom}</option>}
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {dynastySportPresetCopy(preset.id, lang).label}
          </option>
        ))}
      </select>
      <span className="block text-xs leading-5 text-[color:var(--text-secondary)]" data-testid="g30-dynasty-sport-preset-hint">
        {selected ? dynastySportPresetCopy(selected.id, lang).hint : copy.formatHelp}
      </span>
    </label>
  )
}

export function DraftStep({
  state,
  onChange,
  fieldErrors,
}: Pick<WizardProps, 'state' | 'onChange' | 'fieldErrors'>) {
  const { t } = useLanguage()
  const leagueType = getEffectiveLeagueType(state) ?? 'redraft'
  const draftTypes = state.idpSelected ? getIdpDraftTypeOptions() : getDraftTypeOptions(leagueType, state.sport)
  // Only presets the server accepts for this concept and sport. The unfiltered list offered
  // duplicate "Standard"/"Full PPR" rows, TE Premium/Superflex/2QB and NBA 9-cat/8-cat — every
  // one of them rejected at submit.
  const scoringPresets = getScoringPresetOptionsForSelection({
    leagueType,
    sport: state.sport,
    idpSelected: state.idpSelected,
  })

  return (
    <section className="space-y-5" data-testid="g30-draft-step">
      <StepHeader title={t('createLeague.g30.draft.title')} body={t('createLeague.g30.draft.body')} />
      {/*
        The tiles are the one draft-type control. A dropdown below them used to offer the same
        list a second time; it is gone, and so is the "Draft type" eyebrow every tile repeated.
      */}
      <div className="space-y-2.5">
        <p id="g30-draft-type-label" className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
          {t('createLeague.g30.draftType.label')}
          <HelpTip label={t('createLeague.g30.draftType.label')} testId="g30-help-draft-type">{help(t, 'draftType')}</HelpTip>
        </p>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-3" role="group" aria-labelledby="g30-draft-type-label" data-testid="g30-draft-type-tiles">
          {draftTypes.map((option) => {
            const media = getDraftTypeMedia(option.id as DraftTypeId)
            const selected = state.draftType === option.id
            const video = media.selectionVideo || undefined
            return (
              <CreateLeagueVideoTile
                key={option.id}
                title={option.label}
                hint={option.hint}
                selected={selected}
                media={{
                  video,
                  poster: media.thumbnail,
                }}
                onSelect={() => onChange({ draftType: option.id as WizardDraftType })}
                className="sm:min-h-28"
                testId={`g31-draft-type-${option.id}`}
              />
            )
          })}
        </div>
        {fieldErrors?.draftType ? (
          <p role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-300">{fieldErrors.draftType}</p>
        ) : null}
      </div>
      <div className="grid gap-4 md:max-w-sm">
        <label className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.scoring.label')}
            <HelpTip label={t('createLeague.g30.scoring.label')} testId="g30-help-scoring">{help(t, 'scoring')}</HelpTip>
          </span>
          <select
            value={state.scoringPresetId}
            onChange={(event) => onChange({ scoringPresetId: event.target.value })}
            className={fieldClass(Boolean(fieldErrors?.scoringPreset))}
            data-testid="g30-scoring-preset"
          >
            {scoringPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {scoringPresetLabel(t, preset)}
              </option>
            ))}
          </select>
        </label>
        {/* The chosen option's label plate. TE premium is part of the label (Full PPR + 0.5 = TE+). */}
        <ScoringLabel
          id={scoringLabelIdForWizard({
            scoringPresetId: state.scoringPresetId,
            tePremiumPoints: state.sport === 'NFL' && state.tePremium === true && typeof state.tePremiumPoints === 'number' ? state.tePremiumPoints : null,
          })}
          size="md"
        />
      </div>

      <DynastySportPresetPicker state={state} onChange={onChange} />

      {/* NFL scoring add-ons. TE premium has to say its amount — the commissioner picks it. */}
      {state.sport === 'NFL' ? (
        <div
          className={cx(
            'space-y-3 rounded-xl border p-4 transition',
            state.tePremium === true ? 'border-violet-500 bg-violet-600/10' : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)]',
          )}
          data-testid="g30-te-premium"
        >
          <label className="flex min-h-11 cursor-pointer touch-manipulation items-center gap-3 text-sm font-bold">
            <CheckBox
              checked={state.tePremium === true}
              onChange={(checked) => onChange({ tePremium: checked, ...(checked ? {} : { tePremiumPoints: null }) })}
              testId="g30-te-premium-toggle"
            />
            <span>
              {tx(t, 'createLeague.g30.tePremium.label', 'TE premium (TEP)')}
              <HelpTip label={tx(t, 'createLeague.g30.tePremium.label', 'TE premium (TEP)')} testId="g30-help-te-premium">{help(t, 'tePremium')}</HelpTip>
            </span>
          </label>
          {state.tePremium === true ? (
            <label className="block max-w-xs space-y-2">
              <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {tx(t, 'createLeague.g30.tePremium.amount', 'Extra points per TE catch')}
              </span>
              <select
                value={typeof state.tePremiumPoints === 'number' ? String(state.tePremiumPoints) : ''}
                onChange={(event) => onChange({ tePremiumPoints: event.target.value === '' ? null : Number(event.target.value) })}
                className={fieldClass(typeof state.tePremiumPoints !== 'number')}
                aria-invalid={typeof state.tePremiumPoints !== 'number' || undefined}
                data-testid="g30-te-premium-points"
              >
                <option value="">{tx(t, 'createLeague.g30.tePremium.choose', 'Choose an amount')}</option>
                {TE_PREMIUM_POINT_OPTIONS.map((points) => (
                  <option key={points} value={String(points)}>
                    +{points} {tx(t, 'createLeague.g30.tePremium.perCatch', 'per TE catch')}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {leagueType === 'dynasty' && state.sport === 'NFL' && state.draftType !== 'auction' ? (
        <div
          className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-4"
          data-testid="g30-devy-rounds-panel"
        >
          <label className="flex min-h-12 cursor-pointer touch-manipulation items-center gap-3 text-sm font-bold">
            <CheckBox
              checked={state.dynasty.devyRoundsEnabled === true}
              onChange={(checked) => onChange({ dynasty: { ...state.dynasty, devyRoundsEnabled: checked } })}
              testId="g30-devy-rounds-toggle"
            />
            <span>{t('createLeague.g30.devyRounds.enable')}</span>
          </label>
          <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
            {t('createLeague.g30.devyRounds.body')}
          </p>
          {state.dynasty.devyRoundsEnabled === true ? (
            <label className="mt-3 block max-w-[160px] space-y-2">
              <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t('createLeague.g30.devyRounds.count')}
              </span>
              <select
                value={state.dynasty.devyRoundCount ?? 2}
                onChange={(event) =>
                  onChange({ dynasty: { ...state.dynasty, devyRoundCount: Number(event.target.value) } })
                }
                className={fieldClass()}
                data-testid="g30-devy-rounds-count"
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {leagueType === 'keeper' ? (
        <div
          className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-4"
          data-testid="g30-keeper-panel"
        >
          <p className="text-sm font-bold">{t('createLeague.g30.keeper.title')}</p>
          <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
            {t('createLeague.g30.keeper.body')}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
            <label className="space-y-2">
              <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t('createLeague.g30.keeper.maxKeepers')}
              </span>
              <select
                value={state.keeper.keeperMaxKeepers}
                onChange={(event) =>
                  onChange({ keeper: { ...state.keeper, keeperMaxKeepers: Number(event.target.value) } })
                }
                className={fieldClass()}
                data-testid="g30-keeper-max-keepers"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t('createLeague.g30.keeper.roundPenalty')}
              </span>
              <select
                value={state.keeper.keeperRoundPenalty}
                onChange={(event) =>
                  onChange({ keeper: { ...state.keeper, keeperRoundPenalty: Number(event.target.value) } })
                }
                className={fieldClass()}
                data-testid="g30-keeper-round-penalty"
              >
                {[0, 1, 2, 3].map((rounds) => (
                  <option key={rounds} value={rounds}>
                    {rounds === 0 ? t('createLeague.g30.keeper.roundPenaltyNone') : rounds}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
                {t('createLeague.g30.keeper.maxYears')}
              </span>
              <select
                value={state.keeper.keeperMaxYears}
                onChange={(event) =>
                  onChange({ keeper: { ...state.keeper, keeperMaxYears: Number(event.target.value) } })
                }
                className={fieldClass()}
                data-testid="g30-keeper-max-years"
              >
                {/* 0 is "no limit" to the keeper eligibility engine (`maxY > 0 && …`). */}
                {[1, 2, 3, 4, 5, 0].map((years) => (
                  <option key={years} value={years}>
                    {years === 0 ? t('createLeague.g30.keeper.maxYearsUnlimited') : years}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {/*
        Most managers creating a league do not know the draft night yet — they want to invite
        friends first. Requiring a date blocked them at the last step, so "Schedule later" is an
        answer of equal weight: the league is created without a draft date and the commissioner
        sets it in League → Commissioner settings → Draft.
      */}
      <div className="space-y-2">
        <p className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
          {tx(t, 'createLeague.g30.draftWhen.label', 'Draft date')}
          <HelpTip label={tx(t, 'createLeague.g30.draftWhen.label', 'Draft date')} testId="g30-help-draft-date">{help(t, 'draftDate')}</HelpTip>
        </p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={tx(t, 'createLeague.g30.draftWhen.label', 'Draft date')}>
          {([
            { later: false, testId: 'g30-draft-schedule-now', label: tx(t, 'createLeague.g30.draftWhen.now', 'Pick a date') },
            { later: true, testId: 'g30-draft-schedule-later', label: tx(t, 'createLeague.g30.draftWhen.later', 'Schedule later') },
          ] as const).map((option) => {
            const selected = (state.draftScheduleLater === true) === option.later
            return (
              <button
                key={option.testId}
                type="button"
                onClick={() => onChange({ draftScheduleLater: option.later })}
                aria-pressed={selected}
                className={cx(
                  'flex min-h-12 touch-manipulation items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm font-bold transition',
                  selected
                    ? 'border-violet-500 bg-violet-600/12 text-violet-700 dark:text-violet-200'
                    : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-secondary)] [@media(hover:hover)]:hover:border-violet-400',
                )}
                data-testid={option.testId}
              >
                {option.label}
                {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={3} /> : null}
              </button>
            )
          })}
        </div>
        {state.draftScheduleLater === true ? (
          <p className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-3 text-sm leading-6 text-[color:var(--text-secondary)]" data-testid="g30-draft-schedule-later-note">
            {tx(t, 'createLeague.g30.draftWhen.laterNote', 'Invite managers now and set the draft date once everyone agrees. You will find it in your league under Commissioner settings → Draft.')}
          </p>
        ) : null}
      </div>

      {/* Date and time share a row on a phone; the native pickers need about half the width each. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        {state.draftScheduleLater === true ? null : (
        <>
        <label className="min-w-0 space-y-2">
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
        <label className="min-w-0 space-y-2">
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
        </>
        )}
        <label className="col-span-2 min-w-0 space-y-2 md:col-span-1">
          <span className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">
            {t('createLeague.g30.timezone.label')}
            <HelpTip label={t('createLeague.g30.timezone.label')} testId="g30-help-timezone">{help(t, 'timezone')}</HelpTip>
          </span>
          <select
            value={state.timezone}
            onChange={(event) => onChange({ timezone: event.target.value })}
            className={fieldClass(Boolean(fieldErrors?.timezone))}
            data-testid="g30-timezone"
          >
            {timezoneOptions(state.timezone).map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezoneLabel(timezone)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}

export function ReviewCreateStep({
  state,
  completionIssues,
  submitError,
  onFixIssue,
  onScheduleLater,
  onEditStep,
  onChange,
  hasCommissioner,
  entitlementsLoading,
}: {
  state: CreateLeagueV2State
  completionIssues: WizardProps['completionIssues']
  submitError: string | null
  /** Jumps to the step that owns an issue. Without it the issues are listed as plain text. */
  onFixIssue?: (code: string) => void
  /** Resolves a missing draft date by choosing "Schedule later". */
  onScheduleLater?: () => void
  /** Opens the step that owns a setting, from its tile. Without it the tiles are read-only. */
  onEditStep?: (step: WizardStep) => void
  /** With these three the AF Commissioner panel renders here (it used to be its own step). */
  onChange?: WizardProps['onChange']
  hasCommissioner?: boolean
  entitlementsLoading?: boolean
}) {
  const { t } = useLanguage()
  const edit = (step: WizardStep) => (onEditStep ? () => onEditStep(step) : undefined)

  return (
    <section className="space-y-5" data-testid="g30-review-step">
      <StepHeader title={t('createLeague.g30.review.title')} body={t('createLeague.g30.review.body')} />
      <div className="rounded-2xl border border-violet-500/25 bg-violet-600/8 p-4">
        <h2 className="break-words text-lg font-black">{state.name || t('createLeague.g30.preview.unnamed')}</h2>
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-3" data-testid="g30-review-settings">
          <SummaryTile label={t('createLeague.summary.sport')} value={state.sport} onEdit={edit('sport')} testId="g30-review-edit-sport" />
          <SummaryTile label={t('createLeague.summary.concept')} value={conceptLabel(t, state)} onEdit={edit('basics')} testId="g30-review-edit-format" />
          <SummaryTile label={t('createLeague.summary.teams')} value={String(state.teamCount)} onEdit={edit('basics')} testId="g30-review-edit-teams" />
          {getEffectiveLeagueType(state) === 'survivor' ? (
            <SummaryTile label="Commissioner" value={state.survivorCommissionerParticipationMode === 'participating_player' ? 'Playing manager' : 'Host only'} onEdit={edit('basics')} testId="g30-review-edit-survivor-role" />
          ) : null}
          {getEffectiveLeagueType(state) === 'survivor' ? (
            <SummaryTile label="Starting tribes" value={String(state.survivorTribeCount)} onEdit={edit('basics')} testId="g30-review-edit-survivor-tribes" />
          ) : null}
          <SummaryTile label={t('createLeague.summary.draft')} value={draftWhenLabel(t, state)} onEdit={edit('draft')} testId="g30-review-edit-draft" />
        </div>
      </div>

      <SurvivorSeasonPreview state={state} />
      {completionIssues.length > 0 ? (
        <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-4" data-testid="g30-review-issues">
          <p className="text-sm font-black text-amber-700 dark:text-amber-200">{t('createLeague.g30.review.needsAttention')}</p>
          <ul className="mt-2 space-y-2 text-sm text-[color:var(--text-secondary)]">
            {completionIssues.map((issue) => (
              <li key={`${issue.code}-${issue.message}`} className="flex items-start justify-between gap-3">
                <span className="min-w-0 leading-6">{issue.message}</span>
                <span className="flex shrink-0 flex-wrap justify-end gap-2">
                {onScheduleLater && (issue.code === 'draft_date_required' || issue.code === 'draft_time_required') ? (
                  <button
                    type="button"
                    onClick={onScheduleLater}
                    className="inline-flex min-h-9 shrink-0 touch-manipulation items-center rounded-lg border border-amber-500/40 px-3 text-xs font-black text-amber-800 transition hover:bg-amber-500/15 dark:text-amber-100"
                    data-testid={`g30-review-later-${issue.code}`}
                  >
                    {tx(t, 'createLeague.g30.draftWhen.later', 'Schedule later')}
                  </button>
                ) : null}
                {onFixIssue ? (
                  <button
                    type="button"
                    onClick={() => onFixIssue(issue.code)}
                    className="inline-flex min-h-9 shrink-0 touch-manipulation items-center gap-1 rounded-lg border border-amber-500/40 px-3 text-xs font-black text-amber-800 transition hover:bg-amber-500/15 dark:text-amber-100"
                    data-testid={`g30-review-fix-${issue.code}`}
                  >
                    {tx(t, 'createLeague.g30.review.fix', 'Fix')}
                    <ChevronRight aria-hidden="true" className="-mr-1 h-3.5 w-3.5" />
                  </button>
                ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {onChange ? (
        <div className="border-t border-[color:var(--border-subtle)] pt-5">
          <LockedAdvancedSetupPanel
            state={state}
            onChange={onChange}
            hasCommissioner={hasCommissioner === true}
            entitlementsLoading={entitlementsLoading === true}
          />
        </div>
      ) : null}

      {submitError ? (
        <div role="alert" className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-200">
          {submitError}
        </div>
      ) : null}
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
  // Collapsed below `lg`, where the card sits under the step rather than beside it: the one-line
  // summary is what a phone has room for, and every row is still in the DOM for the open state.
  const [expanded, setExpanded] = useState(false)
  const leagueType = getEffectiveLeagueType(state) ?? 'redraft'
  const scoring = getScoringPresetOptionsForSelection({
    leagueType,
    sport: state.sport,
    idpSelected: state.idpSelected,
  }).find((option) => option.id === state.scoringPresetId)

  return (
    <section
      className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-4 shadow-xl shadow-black/5 sm:p-5"
      data-testid="g30-league-preview"
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls="g30-league-preview-rows"
        className="flex w-full touch-manipulation items-start justify-between gap-3 text-left lg:pointer-events-none lg:cursor-default"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300 sm:text-xs">
            {t('createLeague.g30.preview.eyebrow')}
          </span>
          <span className="mt-1.5 block break-words text-xl font-black tracking-tight sm:text-2xl">{state.name || t('createLeague.g30.preview.unnamed')}</span>
          <span className="mt-1 block text-xs font-semibold text-[color:var(--text-secondary)] lg:hidden">
            {state.sport} · {conceptLabel(t, state)} · {state.teamCount} {t('createLeague.summary.teams')}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={cx('mt-1 h-5 w-5 shrink-0 text-[color:var(--text-tertiary)] transition motion-reduce:transition-none lg:hidden', expanded && 'rotate-180')} />
      </button>
      <div id="g30-league-preview-rows" className={cx(expanded ? 'block' : 'hidden', 'lg:block')}>
        <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
          {t('createLeague.g30.preview.body')}
        </p>
        <div className="mt-4 space-y-3 text-sm sm:mt-5">
          <PreviewRow label={t('createLeague.summary.sport')} value={state.sport} />
          <PreviewRow label={t('createLeague.summary.concept')} value={conceptLabel(t, state)} />
          <PreviewRow label={t('createLeague.summary.teams')} value={String(state.teamCount)} />
          <PreviewRow label={t('createLeague.g30.privacy.label')} value={t(`createLeague.g30.privacy.${state.privacy}`)} />
          <PreviewRow label={t('createLeague.summary.draft')} value={draftWhenLabel(t, state)} />
          <PreviewRow label={t('createLeague.g30.timezone.label')} value={timezoneLabel(state.timezone)} />
          <PreviewRow label={t('createLeague.summary.scoring')} value={scoring ? scoringPresetLabel(t, scoring) : t('createLeague.g30.empty')} />
          <PreviewRow label={t('createLeague.g30.preview.language')} value={language.toUpperCase()} />
          <PreviewRow label={t('createLeague.g30.preview.advanced')} value={enabledPremiumCount > 0 ? String(enabledPremiumCount) : t('createLeague.g30.preview.advancedNone')} />
        </div>
      </div>
    </section>
  )
}

export function ImportLeagueModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // A modal that cannot be dismissed with Escape, and that lets the page scroll underneath it on
  // iOS, reads as broken on every platform. Focus starts on Close so a keyboard or switch user
  // lands inside the dialog.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('createLeague.g30.import.title')}
      data-testid="g30-import-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/* A bottom sheet on a phone — reachable with one thumb, clear of the home indicator. */}
      <div className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-3xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[color:var(--border-subtle)] sm:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300 sm:text-xs">
              {t('createLeague.g30.import.eyebrow')}
            </p>
            <h2 className="mt-1 text-xl font-black sm:text-2xl">{t('createLeague.g30.import.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
              {t('createLeague.g30.import.body')}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-[color:var(--border-subtle)] transition hover:border-violet-400"
            aria-label={t('createLeague.g30.import.close')}
          >
            <X aria-hidden="true" className="h-5 w-5" />
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
      /* A card whose only action is a disabled "Coming soon" is a placeholder — not in the iOS app (2.1). */
      data-hide-in-ios-app={available && provider.route ? undefined : ''}
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
          className="mt-4 inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-black text-[#ffffff] transition hover:bg-violet-500"
        >
          {t('createLeague.g30.import.start')}
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="mt-4 min-h-11 w-full cursor-not-allowed rounded-xl bg-[color:var(--surface-card-soft)] px-4 text-sm font-black text-[color:var(--text-tertiary)]"
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
        className="mt-4 inline-flex min-h-11 touch-manipulation items-center rounded-xl bg-violet-600 px-4 text-sm font-black text-[#ffffff]"
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
          <h3 className="text-lg font-black">
            {t('createLeague.g30.advanced.title')}
            <HelpTip label={t('createLeague.g30.advanced.title')} testId="g30-help-advanced">{help(t, 'advanced')}</HelpTip>
          </h3>
          <p className="mt-1 text-sm leading-6 text-[color:var(--text-secondary)]">
            {hasCommissioner ? t('createLeague.g30.advanced.unlockedBody') : t('createLeague.g30.advanced.lockedBody')}
          </p>
        </div>
        <span className="self-start rounded-full border border-[color:var(--border-subtle)] px-3 py-1 text-xs font-black text-[color:var(--text-secondary)] sm:self-auto">
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
                'flex min-h-12 touch-manipulation items-center gap-3 rounded-xl border px-3 text-sm font-bold transition',
                hasCommissioner ? 'cursor-pointer' : 'cursor-not-allowed text-[color:var(--text-tertiary)]',
                checked
                  ? 'border-violet-500 bg-violet-600/10'
                  : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)]',
              )}
              data-testid={`g30-advanced-${key}`}
            >
              <CheckBox
                checked={checked}
                disabled={!hasCommissioner}
                onChange={(next) =>
                  onChange({
                    advancedSetup: {
                      ...state.advancedSetup,
                      [key]: next,
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
      <h2 className="text-lg font-black tracking-tight sm:text-xl">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--text-secondary)]">{body}</p>
    </div>
  )
}

function SummaryTile({ label, value, onEdit, testId }: { label: string; value: string; onEdit?: () => void; testId?: string }) {
  const body = (
    <>
      <span className="block text-xs font-bold uppercase tracking-wide text-[color:var(--text-tertiary)]">{label}</span>
      <span className="mt-1 block break-words text-sm font-black">{value}</span>
    </>
  )
  if (!onEdit) {
    return <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-3">{body}</div>
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${label}: ${value}. Change`}
      className="group relative min-h-16 touch-manipulation rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-3 pr-9 text-left transition [@media(hover:hover)]:hover:border-violet-400"
      data-testid={testId}
    >
      {body}
      <ChevronRight aria-hidden="true" className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-tertiary)] transition group-hover:text-violet-500" />
    </button>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[color:var(--border-subtle)] pb-2 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-[color:var(--text-tertiary)]">{label}</span>
      <span className="min-w-0 break-words text-right font-black">{value}</span>
    </div>
  )
}
