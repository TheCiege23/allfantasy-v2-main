/**
 * Client-side preview of what canonical POST /api/leagues will persist.
 * Mirrors key branches in `createCanonicalLeagueInTransaction.ts` so the Review step stays trustworthy.
 */

import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { normalizeBestBallSettings } from '@/lib/bestball/rules'
import type { LeagueSport } from '@prisma/client'
import { analyzeCreateLeagueCompletion, type CreateLeagueCompletionIssue } from '@/lib/create-league-v2/form-completion'
import { buildCanonicalCreatePayload } from '@/lib/create-league-v2/submit'
import type { CreateLeagueV2State, TradeReviewMode } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType, isDynastyConcept } from '@/lib/create-league-v2/state'
import type { FormatRosterDefaults } from '@/lib/league/roster-defaults'
import type { DefaultPlayoffConfig } from '@/lib/sport-defaults/types'
import {
  resolveCanonicalLeagueMonetization,
  resolveCanonicalLeagueVisibility,
  resolveHomepagePaymentEnabled,
} from '@/lib/league-creation/canonical/createLeagueVisibilityMonetization'

export type ReviewWarningLevel = 'error' | 'warn' | 'info'

export type ReviewWarning = {
  level: ReviewWarningLevel
  code: string
  message: string
}

export type ReviewConfirmation = {
  label: string
  detail?: string
}

export type CreateLeagueReviewSnapshot = {
  usesCanonicalCreateApi: boolean
  completionIssues: CreateLeagueCompletionIssue[]
  warnings: ReviewWarning[]
  confirmations: ReviewConfirmation[]
  presetKey: string | null
  formatId: LeagueTypeId | null
  engineOk: boolean
  engineError: string | null
  /** Finder listing visibility (matches transaction + `resolveCanonicalLeagueVisibility`). */
  finderVisibility: string
  finderListingWillBeActive: boolean
  /** `redraftLeagueExtendedSettings.isPublic` — true when discovery mode is public. */
  extendedProfilePublicFlag: boolean
  tradeReviewPersisted: string
  tradeReviewLabel: string
  tradeReviewExplain: string | null
  waiverLeagueTableSummary: string
  waiverDynastyRecommendation: string | null
  rosterEngineSummary: string
  rosterDynastyDetail: string | null
  playoffEngineSummary: string
  playoffDynastyDetail: string | null
  draftSummary: string
  scoringPresetId: string
  paymentEnabledPersisted: boolean
  paymentPersistedNote: string
  leagueFinanceSummary: string
  commissionerDuesWillBeCreated: boolean
  persistedEntryFeeCents?: number
  persistedPayoutType?: string
  commissionerPayoutResponsiblePersisted?: boolean
  chatEnabled: boolean
  draftRoomEnabled: boolean
  monetizationFromPayload: 'free' | 'paid' | null
  aiCommissionerSummary: string
  aiUserSummary: string
  taxiDevySummary: string
}

const TRADE_REVIEW_LABEL: Record<TradeReviewMode, string> = {
  none: 'No review',
  commissioner: 'Commissioner review',
  league_vote: 'League vote',
}

function countEnabledToggles(toggles: Record<string, boolean>): number {
  return Object.values(toggles).filter((v) => v === true).length
}

function formatRosterEngine(roster: FormatRosterDefaults): string {
  const starters = Object.entries(roster.starterSlots)
    .map(([k, v]) => `${k}×${v}`)
    .slice(0, 8)
    .join(', ')
  const more = Object.keys(roster.starterSlots).length > 8 ? '…' : ''
  return `Total ${roster.rosterSize} slots · Starters (${starters}${more}) · Bench ${roster.benchSlots} · IR ${roster.irSlots} · Taxi ${roster.taxiSlots} · Devy ${roster.devySlots}`
}

function formatPlayoffEngine(p: DefaultPlayoffConfig): string {
  const teams = p.playoff_team_count ?? '—'
  const byes = p.first_round_byes ?? '—'
  const weeks = p.playoff_weeks ?? '—'
  const start = p.playoff_start_week ?? '—'
  return `${teams} teams · ${byes} byes · ${weeks} playoff weeks · start week ${start}`
}

function labelPersistedTradeReview(raw: string): string {
  if (raw === 'none') return TRADE_REVIEW_LABEL.none
  if (raw === 'league_vote') return TRADE_REVIEW_LABEL.league_vote
  if (raw === 'commissioner') return TRADE_REVIEW_LABEL.commissioner
  if (raw === 'instant') return 'Instant'
  return raw || '—'
}

function coerceBodyFromPayload(payload: Record<string, unknown>): {
  concept: string
  sport: LeagueSport
  teamCount: number
  draftType: string
  scoringPreset: string
  leagueName: string
  conceptSetup: Record<string, unknown> | null
  tradeReviewMode: string | null | undefined
} | null {
  const concept = typeof payload.concept === 'string' ? payload.concept : null
  const sport = typeof payload.sport === 'string' ? (payload.sport as LeagueSport) : null
  const teamCount = typeof payload.teamCount === 'number' ? payload.teamCount : null
  const draftType = typeof payload.draftType === 'string' ? payload.draftType : null
  const scoringPreset = typeof payload.scoringPreset === 'string' ? payload.scoringPreset : null
  const leagueName = typeof payload.leagueName === 'string' ? payload.leagueName : null
  if (!concept || !sport || teamCount == null || !draftType || !scoringPreset || !leagueName) return null
  const rawSetup = payload.conceptSetup
  const conceptSetup =
    rawSetup && typeof rawSetup === 'object' && !Array.isArray(rawSetup) ? (rawSetup as Record<string, unknown>) : null
  return {
    concept,
    sport,
    teamCount,
    draftType,
    scoringPreset,
    leagueName,
    conceptSetup,
    tradeReviewMode: payload.tradeReviewMode as string | null | undefined,
  }
}

/**
 * Build a deterministic preview aligned with `createCanonicalLeagueInTransaction`.
 */
export function buildCreateLeagueReviewSnapshot(state: CreateLeagueV2State): CreateLeagueReviewSnapshot {
  const lt = getEffectiveLeagueType(state)
  const completionIssues = analyzeCreateLeagueCompletion(state)
  const usesCanonicalCreateApi = lt !== 'tournament'

  const baseWarnings: ReviewWarning[] = completionIssues.map((i) => ({
    level: 'error' as const,
    code: i.code,
    message: i.message,
  }))

  if (!lt) {
    return {
      usesCanonicalCreateApi,
      completionIssues,
      warnings: baseWarnings,
      confirmations: [],
      presetKey: null,
      formatId: null,
      engineOk: false,
      engineError: 'Choose a league concept first.',
      finderVisibility: 'private',
      finderListingWillBeActive: false,
      extendedProfilePublicFlag: false,
      tradeReviewPersisted: '—',
      tradeReviewLabel: '—',
      tradeReviewExplain: null,
      waiverLeagueTableSummary: '—',
      waiverDynastyRecommendation: null,
      rosterEngineSummary: '—',
      rosterDynastyDetail: null,
      playoffEngineSummary: '—',
      playoffDynastyDetail: null,
      draftSummary: '—',
      scoringPresetId: state.scoringPresetId ?? '',
      paymentEnabledPersisted: false,
      paymentPersistedNote: 'Complete the wizard to preview finance persistence.',
      leagueFinanceSummary: '—',
      commissionerDuesWillBeCreated: false,
      chatEnabled: true,
      draftRoomEnabled: true,
      monetizationFromPayload: null,
      aiCommissionerSummary: '—',
      aiUserSummary: '—',
      taxiDevySummary: '—',
    }
  }

  if (!usesCanonicalCreateApi) {
    const pool = state.tournamentPoolSize || state.teamCount
    const confirmations: ReviewConfirmation[] = [
      {
        label: 'Create tournament shell and feeder leagues',
        detail: 'Server runs POST /api/tournament/create (not the canonical league transaction).',
      },
      { label: 'You remain organizer / commissioner context for the tournament flow' },
    ]
    return {
      usesCanonicalCreateApi: false,
      completionIssues,
      warnings: baseWarnings,
      confirmations,
      presetKey: null,
      formatId: 'tournament',
      engineOk: true,
      engineError: null,
      finderVisibility: 'private',
      finderListingWillBeActive: false,
      extendedProfilePublicFlag: false,
      tradeReviewPersisted: '—',
      tradeReviewLabel: '—',
      tradeReviewExplain: 'Trade review is configured after feeder leagues are created.',
      waiverLeagueTableSummary: 'Set per feeder league after creation.',
      waiverDynastyRecommendation: null,
      rosterEngineSummary: `Participant pool ${pool} (from wizard).`,
      rosterDynastyDetail: null,
      playoffEngineSummary: 'Tournament bracket rules apply on the server.',
      playoffDynastyDetail: null,
      draftSummary: `${state.draftType} (tournament startup)`,
      scoringPresetId: state.scoringPresetId,
      paymentEnabledPersisted: false,
      paymentPersistedNote: 'Tournament dues/payment flows are configured outside this review snapshot.',
      leagueFinanceSummary: '—',
      commissionerDuesWillBeCreated: false,
      chatEnabled: true,
      draftRoomEnabled: true,
      monetizationFromPayload: null,
      aiCommissionerSummary: '—',
      aiUserSummary: '—',
      taxiDevySummary: '—',
    }
  }

  const payload = buildCanonicalCreatePayload(state) as Record<string, unknown>
  const body = coerceBodyFromPayload(payload)

  if (!body) {
    return {
      usesCanonicalCreateApi: true,
      completionIssues,
      warnings: [
        ...baseWarnings,
        { level: 'error', code: 'payload_shape', message: 'Create payload is incomplete; fix wizard fields before submitting.' },
      ],
      confirmations: [],
      presetKey: null,
      formatId: lt,
      engineOk: false,
      engineError: 'Invalid canonical payload shape.',
      finderVisibility: 'private',
      finderListingWillBeActive: false,
      extendedProfilePublicFlag: false,
      tradeReviewPersisted: '—',
      tradeReviewLabel: '—',
      tradeReviewExplain: null,
      waiverLeagueTableSummary: '—',
      waiverDynastyRecommendation: null,
      rosterEngineSummary: '—',
      rosterDynastyDetail: null,
      playoffEngineSummary: '—',
      playoffDynastyDetail: null,
      draftSummary: '—',
      scoringPresetId: state.scoringPresetId,
      paymentEnabledPersisted: false,
      paymentPersistedNote: 'Fix payload errors to preview finance persistence.',
      leagueFinanceSummary: '—',
      commissionerDuesWillBeCreated: false,
      chatEnabled: true,
      draftRoomEnabled: String(state.draftType).toLowerCase() !== 'offline',
      monetizationFromPayload: null,
      aiCommissionerSummary: '—',
      aiUserSummary: '—',
      taxiDevySummary: '—',
    }
  }

  let engine: ReturnType<typeof runPresetEngine>
  try {
    engine = runPresetEngine({
      concept: body.concept,
      sport: body.sport,
      teamCount: body.teamCount,
      draftType: body.draftType,
      scoringPreset: body.scoringPreset,
      leagueName: body.leagueName,
      commissionerId: 'review-preview',
      conceptSetup: body.conceptSetup,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      usesCanonicalCreateApi: true,
      completionIssues,
      warnings: [...baseWarnings, { level: 'error', code: 'preset_engine', message: `Preset preview failed: ${msg}` }],
      confirmations: [],
      presetKey: null,
      formatId: lt,
      engineOk: false,
      engineError: msg,
      finderVisibility: 'private',
      finderListingWillBeActive: false,
      extendedProfilePublicFlag: false,
      tradeReviewPersisted: '—',
      tradeReviewLabel: '—',
      tradeReviewExplain: null,
      waiverLeagueTableSummary: '—',
      waiverDynastyRecommendation: null,
      rosterEngineSummary: '—',
      rosterDynastyDetail: null,
      playoffEngineSummary: '—',
      playoffDynastyDetail: null,
      draftSummary: body.draftType,
      scoringPresetId: body.scoringPreset,
      paymentEnabledPersisted: false,
      paymentPersistedNote: 'Fix preset preview to see finance persistence.',
      leagueFinanceSummary: '—',
      commissionerDuesWillBeCreated: false,
      chatEnabled: true,
      draftRoomEnabled: body.draftType.toLowerCase() !== 'offline',
      monetizationFromPayload: null,
      aiCommissionerSummary: '—',
      aiUserSummary: '—',
      taxiDevySummary: '—',
    }
  }

  const formatId = engine.leagueFormatId as LeagueTypeId
  const resolution = engine.formatResolution
  const waiverDefaults = resolution.waiverDefaults as {
    waiver_type?: string
    FAAB_budget_default?: number | null
    processing_days?: number[]
  }
  const waiverType = String(waiverDefaults?.waiver_type ?? 'standard')
  const faab = waiverDefaults?.FAAB_budget_default
  const waiverLeagueTableSummary =
    waiverType.toLowerCase().includes('faab') || waiverType === 'FAAB'
      ? `League waivers table: FAAB (default budget ${faab ?? 'from preset'})`
      : `League waivers table: ${waiverType}`

  const roster = resolution.roster
  const rosterEngineSummary = formatRosterEngine(roster)

  const playoff = resolution.playoffDefaults as DefaultPlayoffConfig
  const playoffEngineSummary = formatPlayoffEngine(playoff)

  const draftDefaults = resolution.draftDefaults
  const isOffline = body.draftType.toLowerCase() === 'offline'
  const isAuto = body.draftType.toLowerCase() === 'auto'
  const coreTimer = draftDefaults.timer_seconds_default ?? 90
  const draftSummary = `${body.draftType} · ${draftDefaults.rounds_default} rounds · ~${coreTimer}s pick clock${isOffline ? ' · offline board' : ''}${isAuto ? ' · auto-pick enabled' : ''}`

  const bestBallSettings =
    formatId === 'best_ball'
      ? normalizeBestBallSettings({
          sport: body.sport,
          conceptSetup: (payload.conceptSetup ?? null) as Record<string, unknown> | null,
          draftType: body.draftType,
          timezone: typeof payload.timezone === 'string' ? payload.timezone : null,
          language: typeof payload.language === 'string' ? payload.language : null,
        })
      : null

  const tradeReviewRaw =
    bestBallSettings && !bestBallSettings.tradesEnabled
      ? 'none'
      : body.tradeReviewMode === 'none' || body.tradeReviewMode == null
        ? 'commissioner'
        : body.tradeReviewMode

  const tradeReviewPersisted = String(tradeReviewRaw)
  const tradeReviewExplain =
    bestBallSettings && !bestBallSettings.tradesEnabled
      ? 'Best Ball has trades disabled → stored trade review is forced to none.'
      : body.tradeReviewMode == null
        ? 'Server upgrades unset trade review to commissioner review.'
        : null

  const visibilityResolution = resolveCanonicalLeagueVisibility({
    formatId,
    conceptSetup: body.conceptSetup,
    bestBallVisibility: bestBallSettings?.visibility ?? null,
  })
  const monetizationResolution = resolveCanonicalLeagueMonetization({
    conceptSetup: body.conceptSetup,
  })
  const homepagePaymentEnabled = resolveHomepagePaymentEnabled(visibilityResolution, monetizationResolution)

  const finderListingWillBeActive = visibilityResolution.finderListingActive
  const extendedProfilePublicFlag = visibilityResolution.extendedSettingsPublic
  const finderVisibility = visibilityResolution.mode

  const csRaw =
    body.conceptSetup && typeof body.conceptSetup === 'object' && !Array.isArray(body.conceptSetup)
      ? (body.conceptSetup as Record<string, unknown>)
      : {}
  const visRaw = typeof csRaw.visibility === 'string' ? csRaw.visibility.trim().toLowerCase() : ''

  const extraWarnings: ReviewWarning[] = [...baseWarnings]

  for (const w of engine.warnings) {
    extraWarnings.push({ level: 'warn', code: w.code ?? 'preset', message: w.message })
  }

  const monetizationFromPayload = monetizationResolution.isPaidLeague ? 'paid' : 'free'

  if (csRaw.isPublic === true && visRaw === 'private') {
    extraWarnings.push({
      level: 'warn',
      code: 'visibility_flags_conflict',
      message:
        'conceptSetup mixes isPublic=true with visibility=private; the explicit visibility string wins → persisted discovery stays private.',
    })
  }

  const formatSupportsPaidEconomy = formatId === 'best_ball' || isDynastyConcept(formatId as LeagueTypeId)
  if (monetizationResolution.isPaidLeague && !formatSupportsPaidEconomy) {
    extraWarnings.push({
      level: 'warn',
      code: 'paid_unsupported_format',
      message:
        'Paid monetization is present on the payload but this league format does not expose paid setup in the wizard; verify LeagueFinance intent before submitting.',
    })
  }

  if (monetizationResolution.isPaidLeague && monetizationResolution.entryFeeCents <= 0) {
    extraWarnings.push({
      level: 'warn',
      code: 'paid_no_entry',
      message: 'Paid league selected but entry fee is $0 — homepage payment tools stay off until you set a positive entry.',
    })
  }

  if (monetizationResolution.isPaidLeague && monetizationResolution.payoutType === 'not_configured') {
    extraWarnings.push({
      level: 'warn',
      code: 'paid_no_payout',
      message: 'Choose a payout type (commissioner managed or external escrow) so payment surfaces can activate.',
    })
  }

  if (visibilityResolution.mode === 'public' && monetizationResolution.isPaidLeague && monetizationResolution.payoutType === 'not_configured') {
    extraWarnings.push({
      level: 'warn',
      code: 'public_paid_payout',
      message: 'Public paid leagues should configure payouts before listing for discovery.',
    })
  }

  if (finderListingWillBeActive && !state.description.trim()) {
    extraWarnings.push({
      level: 'info',
      code: 'public_no_blurb',
      message: 'Public discovery is on; adding a short league description helps managers find you (optional).',
    })
  }

  if (visibilityResolution.mode === 'invite_only') {
    extraWarnings.push({
      level: 'info',
      code: 'invite_only_discovery',
      message: 'Invite-only posture: Find League stays off; share the join link with managers you invite.',
    })
  }

  if (monetizationResolution.payoutType === 'external_escrow' && !monetizationResolution.externalEscrowUrl) {
    extraWarnings.push({
      level: 'warn',
      code: 'escrow_missing_url',
      message: 'External escrow payout is selected but no escrow URL was provided.',
    })
  }

  let waiverDynastyRecommendation: string | null = null
  let rosterDynastyDetail: string | null = null
  let playoffDynastyDetail: string | null = null
  let taxiDevySummary = `Engine devy slots: ${roster.devySlots}`

  if (isDynastyConcept(lt)) {
    const d = state.dynasty
    waiverDynastyRecommendation = `Dynasty config recommendation: ${
      d.waiverType === 'faab' ? `FAAB (${d.faabBudget})` : d.waiverType === 'rolling' ? 'Rolling' : 'Reverse standings'
    }`
    rosterDynastyDetail = `Startup depth ${d.startupRosterDepth} · Bench ${d.benchCount} · IR ${d.irCount} · Taxi ${d.taxiSlotCount} (also written to DynastyLeagueConfig)`
    playoffDynastyDetail = `${d.playoffTeamCount} playoff teams · ${d.playoffByeCount} byes · ${d.regularSeasonLength} regular-season weeks`
    taxiDevySummary = `Taxi ${d.taxiSlotCount} (eligibility ${d.taxiEligibilityYears} yr, lock week ${d.taxiLockDeadlineWeek}) · Rookie draft ${d.rookieDraftRounds} rds (${d.rookieDraftType}) · Engine devy slots ${roster.devySlots}`
  } else if (lt === 'keeper' && state.keeper) {
    rosterDynastyDetail = `Keeper policy: max ${state.keeper.keeperMaxKeepers} · ${state.keeper.keeperMaxYears} yrs · penalty rnd ${state.keeper.keeperRoundPenalty}`
  } else if (lt === 'best_ball' && state.bestBall) {
    rosterDynastyDetail = `Best Ball templates: roster ${state.bestBall.rosterTemplateId} · lineup ${state.bestBall.lineupTemplateId}`
    playoffDynastyDetail = `${state.bestBall.playoffTeams} playoff teams · ${state.bestBall.regularSeasonLength} regular-season weeks`
    taxiDevySummary = 'Best Ball taxi/devy follows contest template (see Best Ball settings).'
  }

  const aiCommissionerSummary = isDynastyConcept(lt)
    ? `${countEnabledToggles(state.dynasty.commissionerAi)} / ${Object.keys(state.dynasty.commissionerAi).length} commissioner AI tools on (stored in league settings snapshot)`
    : 'Dynasty-style commissioner AI toggles apply to dynasty/devy/c2c only.'

  const aiUserSummary = isDynastyConcept(lt)
    ? `${countEnabledToggles(state.dynasty.userAi)} / ${Object.keys(state.dynasty.userAi).length} manager AI tools on (stored in league settings snapshot)`
    : 'Manager AI toggles apply to dynasty/devy/c2c only.'

  const confirmations: ReviewConfirmation[] = [
    { label: 'Create the league row and merged settings snapshot', detail: `Preset ${engine.presetKey}` },
    { label: 'Create LeagueFinance row (paid/free + entry fee cents + treasury provider)' },
    ...(monetizationResolution.createCommissionerDuesRow
      ? [{ label: 'Seed commissioner LeagueDues row (pending collection)', detail: `Amount ${monetizationResolution.entryFeeCents}¢` }]
      : []),
    { label: 'Create your commissioner team and roster shell' },
    { label: 'Create an active league invite link (join code on the server)' },
    { label: 'Create league chat room (type: league)' },
    {
      label: isOffline ? 'Draft profile + draft session (offline board)' : 'Draft profile, draft session, and live draft room access',
      detail: isOffline ? 'Draft room UI stays available for offline coordination.' : 'Draft room enabled in homepage state unless offline.',
    },
    {
      label: finderListingWillBeActive
        ? 'Publish a Find League listing (public discovery)'
        : 'Keep the league off public discovery (private or invite-only)',
      detail: finderListingWillBeActive ? 'FindLeagueListing.isActive = true' : 'FindLeagueListing.isActive = false (row still upserted)',
    },
  ]

  const leagueFinanceSummary = `isPaidLeague=${monetizationResolution.isPaidLeague} · entryFeeCents=${monetizationResolution.entryFeeCents} · treasury=${monetizationResolution.treasuryProvider} · payout=${monetizationResolution.payoutType}`

  const paymentPersistedNote = homepagePaymentEnabled
    ? 'Homepage paymentEnabled will be true: paid league with entry fee and payout model configured (no processor charges yet).'
    : 'Homepage paymentEnabled stays false until paid entry, payout type, and public/standard discovery gates are satisfied.'

  return {
    usesCanonicalCreateApi: true,
    completionIssues,
    warnings: extraWarnings,
    confirmations,
    presetKey: engine.presetKey,
    formatId,
    engineOk: true,
    engineError: null,
    finderVisibility,
    finderListingWillBeActive,
    extendedProfilePublicFlag,
    tradeReviewPersisted,
    tradeReviewLabel: labelPersistedTradeReview(tradeReviewPersisted),
    tradeReviewExplain,
    waiverLeagueTableSummary,
    waiverDynastyRecommendation,
    rosterEngineSummary,
    rosterDynastyDetail,
    playoffEngineSummary,
    playoffDynastyDetail,
    draftSummary,
    scoringPresetId: body.scoringPreset,
    paymentEnabledPersisted: homepagePaymentEnabled,
    paymentPersistedNote,
    leagueFinanceSummary,
    commissionerDuesWillBeCreated: monetizationResolution.createCommissionerDuesRow,
    persistedEntryFeeCents: monetizationResolution.entryFeeCents,
    persistedPayoutType: monetizationResolution.payoutType,
    commissionerPayoutResponsiblePersisted: monetizationResolution.commissionerPayoutResponsible,
    chatEnabled: true,
    draftRoomEnabled: !isOffline,
    monetizationFromPayload,
    aiCommissionerSummary,
    aiUserSummary,
    taxiDevySummary,
  }
}
