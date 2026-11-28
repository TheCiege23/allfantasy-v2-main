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
import { applyRequestedFormat, type RequestableFormat } from '@/lib/create-league-v2/requestedFormat'

interface CreateLeagueV2ClientProps {
  userId: string
  /** Opened from the demo league: offer "Create a test league" pre-selected. */
  fromDemo?: boolean
  /** `?type=<format>` (from a format demo): start the wizard on that format. */
  requestedFormat?: RequestableFormat
  /** A rule template's settings (lib/rule-templates) to start from. Nothing of its source league carries over. */
  importTemplate?: CreateLeagueV2State
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
    survivorCommissionerParticipationMode: state.survivorCommissionerParticipationMode === 'non_participating_host'
      ? 'non_participating_host' : 'participating_player',
  }
}

export function CreateLeagueV2Client({ userId: _userId, importTemplate, importedLeagues, fromDemo, requestedFormat }: CreateLeagueV2ClientProps) {
  const { t } = useLanguage()
  const router = useRouter()
  // A rule template carries its own format; a fresh create starts on the sport's default format
  // (Survivor for the default NFL). A form restored from
  // this device's saved draft (below, localStorage) keeps whatever the manager had chosen.
  const [state, setState] = useState<CreateLeagueV2State>(() => {
    const start = importTemplate ?? freshCreateLeagueState(DEFAULT_V2_STATE)
    return normalizeInitialState(!importTemplate && requestedFormat ? applyRequestedFormat(start, requestedFormat) : start)
  })
  const [testLeague, setTestLeague] = useState(fromDemo === true)
  const [hydrated, setHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<CreateLeagueFieldErrors | null>(null)
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
      // A requested format is applied ON TOP of the restored draft: the manager keeps their
      // name and choices, only the format changes to the one the link asked for.
      setState((current) => {
        const restored = { ...current, ...persisted }
        return normalizeInitialState(requestedFormat ? applyRequestedFormat(restored, requestedFormat) : restored)
      })
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
  }, [importTemplate, requestedFormat])

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
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const completionIssues = useMemo(() => analyzeCreateLeagueCompletion(state), [state])

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    setFieldErrors(null)
    // Funnel meta is format-level only: no league name, no dates, nothing a person typed.
    const funnelMeta = {
      leagueType: state.leagueType ?? 'redraft',
      sport: state.sport,
      teamCount: state.teamCount,
      draftType: state.draftType,
    }
    // A test league is a tester's throwaway: it must not count in the create-league funnel.
    const isTest = testLeague
    if (!isTest) sendProductAnalyticsBeacon(CREATE_LEAGUE.SUBMIT, funnelMeta)
    try {
      const result = await submitCreateLeagueV2(state, isTest)
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
      router.push(result.redirectTo ?? '/dashboard')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('createLeague.v2.submitError'))
    } finally {
      setSubmitting(false)
    }
  }, [router, state, t, testLeague])

  return (
    <>
    <TestLeagueToggle checked={testLeague} onChange={setTestLeague} fromDemo={fromDemo === true} />
    <CreateLeagueWizard
      state={state}
      onChange={onChange}
      completionIssues={completionIssues}
      fieldErrors={fieldErrors}
      submitError={submitError}
      submitting={submitting}
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
          className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] px-4 py-3 pr-16 sm:pr-20 lg:pr-4"
        >
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-primary)]"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          {/*
            One line until it is switched on. The full explanation filled a phone's first screen and
            pushed every sport card below the fold; it opens when the box is ticked (or from the demo).
          */}
          <span>
            <span className="block text-sm font-bold">Create a test league</span>
            {checked || fromDemo ? (
              <span className="mt-1 block text-sm leading-6 text-[color:var(--text-secondary)]" data-testid="create-test-league-details">
                Every empty team gets a placeholder Chimmy manager, so you can run the whole flow — draft, lineups,
                trades, scoring — on your own. Test leagues send no invites and don&apos;t count as real leagues.
                {fromDemo ? ' Pre-selected because you came from the demo league.' : ''}
              </span>
            ) : (
              <span className="mt-0.5 block text-xs leading-5 text-[color:var(--text-secondary)]">Chimmy runs the empty teams. No invites sent.</span>
            )}
          </span>
        </label>
      </section>
    </div>
  )
}
