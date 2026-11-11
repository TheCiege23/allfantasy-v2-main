'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_V2_STATE,
  clearPersistedV2State,
  getPersistedV2SavedAt,
  getDefaultBestBallSetup,
  getDefaultKeeperSetup,
  getEffectiveLeagueType,
  loadPersistedV2State,
  persistV2State,
  type CreateLeagueV2State,
} from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { readDeviceTimezone } from '@/lib/create-league-v2/device-timezone'
import { submitCreateLeagueV2, type CreateLeagueFieldErrors } from '@/lib/create-league-v2/submit'
import { CreateLeagueWizard, freshCreateLeagueState, type ImportedLeagueSummary } from '@/components/create-league-v2/CreateLeagueWizard'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { setClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import type { LeagueCreateOptionsCatalog } from '@/lib/league-creation/options-catalog-seed-data'
import { getDefaultScoringPresetId, resolveScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import { getSurvivorTribeOptions } from '@/lib/create-league-v2/rules-engine'
import { CREATE_LEAGUE } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'

export interface CreateLeagueV2ClientProps {
  userId: string
  /** Opened from the demo league: offer "Create a test league" pre-selected. */
  fromDemo?: boolean
  importTemplate?: CreateLeagueV2State
  importSourceName?: string
  importSourceLeagueId?: string
  importedLeagues?: ImportedLeagueSummary[]
}

function normalizeInitialState(state: CreateLeagueV2State): CreateLeagueV2State {
  const leagueType = getEffectiveLeagueType(state) ?? 'redraft'
  const scoringPresetId =
    state.scoringPresetId ||
    getDefaultScoringPresetId({
      leagueType,
      sport: state.sport,
      idpSelected: state.idpSelected,
    })

  return {
    ...state,
    leagueType,
    scoringPresetId: resolveScoringPresetId(scoringPresetId, {
      leagueType,
      sport: state.sport,
      idpSelected: state.idpSelected,
    }),
    keeper: { ...getDefaultKeeperSetup(), ...(state.keeper ?? {}) },
    bestBall: { ...getDefaultBestBallSetup(state.sport), ...(state.bestBall ?? {}) },
    advancedSetup: state.advancedSetup ?? {},
    privacy: state.privacy ?? 'private',
    draftDate: state.draftDate ?? '',
    draftTime: state.draftTime ?? '',
    draftScheduleLater: state.draftScheduleLater === true,
    tePremiumPoints: typeof state.tePremiumPoints === 'number' ? state.tePremiumPoints : null,
    survivorTribeCount: leagueType === 'survivor' && !getSurvivorTribeOptions(state.teamCount).includes(state.survivorTribeCount)
      ? (getSurvivorTribeOptions(state.teamCount)[0] ?? 2) : state.survivorTribeCount,
    survivorCommissionerParticipationMode: state.survivorCommissionerParticipationMode === 'participating_player'
      ? 'participating_player' : 'non_participating_host',
  }
}

export function CreateLeagueV2Client({ userId: _userId, importTemplate, importSourceName, importSourceLeagueId, importedLeagues, fromDemo }: CreateLeagueV2ClientProps) {
  const { t } = useLanguage()
  const router = useRouter()
  // An import carries its own format; a fresh create starts on the sport's default format
  // (Survivor for the default NFL). A form restored from
  // this device's saved draft (below, localStorage) keeps whatever the manager had chosen.
  const [state, setState] = useState<CreateLeagueV2State>(() => normalizeInitialState(importTemplate ?? freshCreateLeagueState(DEFAULT_V2_STATE)))
  const [acceptWeeklyLineups, setAcceptWeeklyLineups] = useState(false)
  const [testLeague, setTestLeague] = useState(fromDemo === true)
  const [hydrated, setHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<CreateLeagueFieldErrors | null>(null)
  const [createdLeagueHref, setCreatedLeagueHref] = useState<string | null>(null)
  const [createdLeagueId, setCreatedLeagueId] = useState<string | null>(null)
  const [creationWarning, setCreationWarning] = useState<string | null>(null)
  const [retryingFinalization, setRetryingFinalization] = useState(false)
  /** When a saved draft was restored on arrival (ms), for the "we kept your progress" notice. */
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (importTemplate) {
      setState(normalizeInitialState(importTemplate))
      setHydrated(true)
      return
    }
    const persisted = loadPersistedV2State()
    if (persisted) {
      setState((current) => normalizeInitialState({ ...current, ...persisted }))
      const savedAt = getPersistedV2SavedAt()
      setRestoredAt(savedAt ?? Date.now())
      sendProductAnalyticsBeacon(CREATE_LEAGUE.DRAFT_RESTORED, {
        ageMinutes: savedAt ? Math.round((Date.now() - savedAt) / 60_000) : null,
      })
    } else {
      // A fresh create starts on the device's timezone rather than New York. Read here, after
      // hydration, because the server cannot know it: setting it in the initial state would render
      // a different select on the server and the client. The form is still disabled at this point
      // (it enables after mount), so this cannot overwrite a choice the manager made.
      const deviceTimezone = readDeviceTimezone()
      if (deviceTimezone) {
        setState((current) => (current.timezone === deviceTimezone ? current : { ...current, timezone: deviceTimezone }))
      }
    }
    setHydrated(true)
  }, [importTemplate])

  useEffect(() => {
    if (!hydrated) return
    persistV2State(state)
    setLastSavedAt(Date.now())
  }, [hydrated, state])

  const handleStartOver = useCallback(() => {
    clearPersistedV2State()
    setRestoredAt(null)
    setSubmitError(null)
    setFieldErrors(null)
    const fresh = normalizeInitialState(freshCreateLeagueState(DEFAULT_V2_STATE))
    const deviceTimezone = readDeviceTimezone()
    setState(deviceTimezone ? { ...fresh, timezone: deviceTimezone } : fresh)
  }, [])

  useEffect(() => {
    let active = true

    async function loadCatalog() {
      try {
        const res = await fetch('/api/leagues/create-options', { credentials: 'include' })
        if (!res.ok) return
        const json = (await res.json()) as { catalog?: LeagueCreateOptionsCatalog }
        if (!active || !json.catalog) return

        setClientLeagueCreateOptionsCatalog(json.catalog)
        setState((prev) => {
          const nextTimezone = prev.timezone?.trim() ? prev.timezone : json.catalog?.defaultTimezone ?? prev.timezone
          return nextTimezone === prev.timezone ? prev : { ...prev, timezone: nextTimezone }
        })
      } catch {
        // Local registry fallback keeps the create flow usable when options fail to load.
      }
    }

    void loadCatalog()

    return () => {
      active = false
    }
  }, [])

  const onChange = useCallback((patch: Partial<CreateLeagueV2State>) => {
    setSubmitError(null)
    setFieldErrors(null)
    setState((prev) => ({ ...prev, ...patch,
      ...(importSourceLeagueId && importTemplate ? { sport: importTemplate.sport, teamCount: importTemplate.teamCount } : {}),
    }))
  }, [importSourceLeagueId, importTemplate])

  const importedTeamCount = importSourceLeagueId && importTemplate ? importTemplate.teamCount : null
  const completionIssues = useMemo(
    () => analyzeCreateLeagueCompletion(state, { importedTeamCount }),
    [state, importedTeamCount],
  )

  const finishImportedLeague = useCallback(async (leagueId: string, href: string) => {
    setRetryingFinalization(true)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/import-carryover/finalize`, {
        method: 'POST',
        credentials: 'include',
      })
      const result = (await response.json()) as { complete?: boolean; error?: string }
      if (response.ok && result.complete) {
        router.push(href)
      } else {
        setCreationWarning(result.error ?? 'Your league was created, but roster setup is still pending. Retry setup or open the league to review it.')
      }
    } catch {
      setCreationWarning('Your league was created, but roster setup could not be completed. Please retry setup.')
    } finally {
      setRetryingFinalization(false)
    }
  }, [router])

  const handleSubmit = useCallback(async () => {
    if (importSourceLeagueId && state.sport === 'MLB' && !acceptWeeklyLineups) {
      setSubmitError('Confirm weekly lineups for your native baseball league before creating it.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    setFieldErrors(null)
    // Funnel meta is format-level only: no league name, no dates, nothing a person typed.
    const funnelMeta = {
      leagueType: state.leagueType ?? 'redraft',
      sport: state.sport,
      teamCount: state.teamCount,
      draftType: state.draftType,
      fromImport: Boolean(importSourceLeagueId),
    }
    // A test league is a tester's throwaway: it must not count in the create-league funnel.
    const isTest = testLeague && !importSourceLeagueId
    if (!isTest) sendProductAnalyticsBeacon(CREATE_LEAGUE.SUBMIT, funnelMeta)
    try {
      const result = await submitCreateLeagueV2(state, importSourceLeagueId, acceptWeeklyLineups, isTest)
      if (!result.ok) {
        setSubmitError(result.error ?? t('createLeague.v2.submitError'))
        if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
          setFieldErrors(result.fieldErrors)
        }
        if (!isTest) sendProductAnalyticsBeacon(CREATE_LEAGUE.FAIL_CLIENT, {
          ...funnelMeta,
          fields: Object.keys(result.fieldErrors ?? {}).join(','),
        })
        return
      }
      if (!isTest) sendProductAnalyticsBeacon(CREATE_LEAGUE.SUCCESS_CLIENT, funnelMeta)
      clearPersistedV2State()
      if (result.warning) {
        const href = result.redirectTo ?? (result.leagueId ? `/core?league=${encodeURIComponent(result.leagueId)}` : '/core')
        setCreatedLeagueId(result.leagueId ?? null)
        setCreatedLeagueHref(href)
        setCreationWarning(result.warning)
        if (result.leagueId) await finishImportedLeague(result.leagueId, href)
        return
      }
      router.push(result.redirectTo ?? '/dashboard')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('createLeague.v2.submitError'))
    } finally {
      setSubmitting(false)
    }
  }, [router, state, t, importSourceLeagueId, finishImportedLeague, acceptWeeklyLineups, testLeague])

  const retryFinalization = useCallback(async () => {
    if (!createdLeagueId || retryingFinalization) return
    await finishImportedLeague(createdLeagueId, createdLeagueHref ?? `/core?league=${encodeURIComponent(createdLeagueId)}`)
  }, [createdLeagueHref, createdLeagueId, retryingFinalization, finishImportedLeague])

  return (
    <>
    {!importSourceLeagueId ? (
      <TestLeagueToggle checked={testLeague} onChange={setTestLeague} fromDemo={fromDemo === true} />
    ) : null}
    <CreateLeagueWizard
      state={state}
      onChange={onChange}
      completionIssues={completionIssues}
      fieldErrors={fieldErrors}
      submitError={submitError}
      submitting={submitting}
      importSourceName={importSourceName}
      importCarryover={Boolean(importSourceLeagueId)}
      acceptWeeklyLineups={acceptWeeklyLineups}
      onAcceptWeeklyLineups={setAcceptWeeklyLineups}
      createdLeagueHref={createdLeagueHref}
      creationWarning={creationWarning}
      retryingFinalization={retryingFinalization}
      onRetryFinalization={createdLeagueId ? retryFinalization : undefined}
      onSubmit={handleSubmit}
      onCancel={() => router.push('/core')}
      importedLeagues={importedLeagues}
      lastSavedAt={hydrated && !importTemplate ? lastSavedAt : null}
      restoredAt={restoredAt}
      onStartOver={importTemplate ? undefined : handleStartOver}
    />
    </>
  )
}

function TestLeagueToggle({ checked, onChange, fromDemo }: { checked: boolean; onChange: (v: boolean) => void; fromDemo: boolean }) {
  return (
    <div className="bg-[color:var(--surface-app)] text-[color:var(--text-primary)]">
      <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6" aria-label="Test league">
        <label
          data-testid="create-test-league-toggle"
          className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-4 pr-16 sm:pr-20 lg:pr-4"
        >
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-primary)]"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-bold">Create a test league</span>
            <span className="mt-1 block text-sm leading-6 text-[color:var(--text-secondary)]">
              Every empty team gets a placeholder AI manager, so you can run the whole flow — draft, lineups,
              trades, scoring — on your own. Test leagues send no invites and don&apos;t count as real leagues.
              {fromDemo ? ' Pre-selected because you came from the demo league.' : ''}
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}
