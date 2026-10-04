'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_V2_STATE,
  clearPersistedV2State,
  getDefaultBestBallSetup,
  getDefaultKeeperSetup,
  getEffectiveLeagueType,
  loadPersistedV2State,
  persistV2State,
  type CreateLeagueV2State,
} from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { submitCreateLeagueV2, type CreateLeagueFieldErrors } from '@/lib/create-league-v2/submit'
import { CreateLeagueWizard } from '@/components/create-league-v2/CreateLeagueWizard'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { setClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import type { LeagueCreateOptionsCatalog } from '@/lib/league-creation/options-catalog-seed-data'
import { getDefaultScoringPresetId, resolveScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'

export interface CreateLeagueV2ClientProps {
  userId: string
  importTemplate?: CreateLeagueV2State
  importSourceName?: string
  importSourceLeagueId?: string
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
  }
}

export function CreateLeagueV2Client({ userId: _userId, importTemplate, importSourceName, importSourceLeagueId }: CreateLeagueV2ClientProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const [state, setState] = useState<CreateLeagueV2State>(() => normalizeInitialState(importTemplate ?? DEFAULT_V2_STATE))
  const [acceptWeeklyLineups, setAcceptWeeklyLineups] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<CreateLeagueFieldErrors | null>(null)
  const [createdLeagueHref, setCreatedLeagueHref] = useState<string | null>(null)
  const [createdLeagueId, setCreatedLeagueId] = useState<string | null>(null)
  const [creationWarning, setCreationWarning] = useState<string | null>(null)
  const [retryingFinalization, setRetryingFinalization] = useState(false)

  useEffect(() => {
    if (importTemplate) {
      setState(normalizeInitialState(importTemplate))
      setHydrated(true)
      return
    }
    const persisted = loadPersistedV2State()
    if (persisted) {
      setState((current) => normalizeInitialState({ ...current, ...persisted }))
    }
    setHydrated(true)
  }, [importTemplate])

  useEffect(() => {
    if (!hydrated) return
    persistV2State(state)
  }, [hydrated, state])

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

  const completionIssues = useMemo(() => analyzeCreateLeagueCompletion(state), [state])

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
    try {
      const result = await submitCreateLeagueV2(state, importSourceLeagueId, acceptWeeklyLineups)
      if (!result.ok) {
        setSubmitError(result.error ?? t('createLeague.v2.submitError'))
        if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
          setFieldErrors(result.fieldErrors)
        }
        return
      }
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
  }, [router, state, t, importSourceLeagueId, finishImportedLeague, acceptWeeklyLineups])

  const retryFinalization = useCallback(async () => {
    if (!createdLeagueId || retryingFinalization) return
    await finishImportedLeague(createdLeagueId, createdLeagueHref ?? `/core?league=${encodeURIComponent(createdLeagueId)}`)
  }, [createdLeagueHref, createdLeagueId, retryingFinalization, finishImportedLeague])

  return (
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
    />
  )
}
