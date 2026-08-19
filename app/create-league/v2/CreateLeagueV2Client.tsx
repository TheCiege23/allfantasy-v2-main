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

export function CreateLeagueV2Client({ userId: _userId }: CreateLeagueV2ClientProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const [state, setState] = useState<CreateLeagueV2State>(() => normalizeInitialState(DEFAULT_V2_STATE))
  const [hydrated, setHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<CreateLeagueFieldErrors | null>(null)

  useEffect(() => {
    const persisted = loadPersistedV2State()
    if (persisted) {
      setState((current) => normalizeInitialState({ ...current, ...persisted }))
    }
    setHydrated(true)
  }, [])

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
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const completionIssues = useMemo(() => analyzeCreateLeagueCompletion(state), [state])

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    setFieldErrors(null)
    try {
      const result = await submitCreateLeagueV2(state)
      if (!result.ok) {
        setSubmitError(result.error ?? t('createLeague.v2.submitError'))
        if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
          setFieldErrors(result.fieldErrors)
        }
        return
      }
      clearPersistedV2State()
      router.push(result.redirectTo ?? '/dashboard')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('createLeague.v2.submitError'))
    } finally {
      setSubmitting(false)
    }
  }, [router, state, t])

  return (
    <CreateLeagueWizard
      state={state}
      onChange={onChange}
      completionIssues={completionIssues}
      fieldErrors={fieldErrors}
      submitError={submitError}
      submitting={submitting}
      onSubmit={handleSubmit}
      onCancel={() => router.push('/dashboard')}
    />
  )
}
