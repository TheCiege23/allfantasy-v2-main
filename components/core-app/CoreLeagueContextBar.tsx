'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'

import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { CORE_SURFACE_LABELS, type CoreSurfaceKey } from '@/lib/core-app/coreSurface'
import {
  LEAGUE_CONCEPT_OPTIONS,
  isLeagueConceptType,
  leagueConceptLabel,
  type LeagueConceptType,
} from '@/lib/league/leagueConceptOptions'
import '@/components/core-app/af-league-tabs.css'

export type CoreLeagueRecommendationValue = { action: string; rationale: string }

export type CoreLeagueContextBarProps = {
  leagueId: string
  leagueName: string
  platform: string
  /**
   * The league's artwork and its letter fallback, both resolved by the page's
   * rail mapping.
   *
   * ⚠ PASSED IN, NOT DERIVED HERE. `imageOf` → `getLeagueTypeMedia` →
   * `resolveLeagueCardTypeKey` is a three-step resolution the rail already
   * performs for the same league, and a second copy of it in this bar is how the
   * chip in the rail and the crest in the header start showing different
   * artwork for one league.
   */
  logoUrl?: string | null
  logoLetter?: string
  syncLabel: string
  syncStale: boolean
  gameDayActive: boolean
  decisionAvailable?: boolean
  recommendation?: CoreLeagueRecommendationValue | null
  surface: CoreSurfaceKey
  /*
   * ⚠ SLOTS, SO THE BAR CAN PAINT BEFORE THE DECISION OS READ FINISHES. The page renders this
   * bar with the shell; only the Decision OS chip and the recommendation wait on
   * `resolveUserOsSnapshot`, so they stream into these slots instead of holding the league's
   * name, source and sync age back. The bar must not be re-mounted to swap them in — it owns the
   * league-type fetch and the select's state — which is why they are slots and not a fallback.
   * When a slot is given it replaces the matching prop entirely.
   */
  decisionSlot?: ReactNode
  recommendationSlot?: ReactNode
}

/** `available: null` is "not read yet": a muted chip that claims neither state. */
export function CoreLeagueDecisionChip({ available }: { available: boolean | null }) {
  const tone = available === null ? 'muted' : available ? 'decision' : 'muted'
  const label = available === null ? 'checking' : available ? 'connected' : 'building context'
  return (
    <span className="af-lctx-chip" data-tone={tone}>
      Decision OS {label}
    </span>
  )
}

export function CoreLeagueRecommendation({
  leagueName,
  surface,
  recommendation,
}: {
  leagueName: string
  surface: CoreSurfaceKey
  recommendation: CoreLeagueRecommendationValue
}) {
  const askChimmy = () => {
    window.dispatchEvent(
      new CustomEvent(COMMS_OPEN_EVENT, {
        detail: {
          tab: 'chimmy',
          prefill: `Review ${leagueName}'s ${CORE_SURFACE_LABELS[surface]} and tell me the most important action to take next.`,
        },
      }),
    )
  }
  return (
    <div className="af-lctx-action">
      <span className="af-lctx-action-copy">
        <strong>{recommendation.action}</strong>
        <span>{recommendation.rationale}</span>
      </span>
      <button type="button" onClick={askChimmy}>Ask Chimmy</button>
    </div>
  )
}

export default function CoreLeagueContextBar({
  leagueId,
  leagueName,
  platform,
  logoUrl = null,
  logoLetter,
  syncLabel,
  syncStale,
  gameDayActive,
  decisionAvailable,
  recommendation,
  surface,
  decisionSlot,
  recommendationSlot,
}: CoreLeagueContextBarProps) {
  const selectId = useId()
  const [leagueType, setLeagueType] = useState<LeagueConceptType | null>(null)
  const [canConfirm, setCanConfirm] = useState(false)
  const [typeStatus, setTypeStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    setTypeStatus('loading')
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/league-type`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('league type unavailable')
        return response.json() as Promise<{
          confirmation?: { type?: unknown } | null
          suggestion?: { suggested?: unknown }
          storedType?: unknown
          canConfirm?: boolean
        }>
      })
      .then((payload) => {
        const raw = payload.confirmation?.type ?? payload.storedType ?? payload.suggestion?.suggested
        setLeagueType(isLeagueConceptType(raw) ? raw : null)
        setCanConfirm(Boolean(payload.canConfirm))
        setTypeStatus('ready')
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== 'AbortError') setTypeStatus('error')
      })
    return () => controller.abort()
  }, [leagueId])

  const updateLeagueType = async (next: LeagueConceptType) => {
    const previous = leagueType
    setLeagueType(next)
    setTypeStatus('saving')
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/league-type`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: next }),
      })
      if (!response.ok) throw new Error('save failed')
      setTypeStatus('saved')
      window.setTimeout(() => setTypeStatus('ready'), 1600)
    } catch {
      setLeagueType(previous)
      setTypeStatus('error')
    }
  }
  return (
    <section className="af-lctx" aria-label={`${leagueName} system status`}>
      {/*
        The league, named once.

        🛑 IT WAS NAMED NOWHERE. `LeagueTabs` used to carry an `af-lt-league`
        chip — "In league / <name>" — and it was removed when this bar was
        added, on the reasoning that the page header names the league. This IS
        that header, and it printed the name only into `aria-label`. So on every
        in-league screen the visible answer to "which league am I looking at"
        was the rail's highlighted chip, which is exactly the answer the tab bar
        was built to replace — and on an account with sixty leagues it is not an
        answer at all. (The orphaned `.af-lt-league-name` rules left behind in
        af-league-tabs.css are what this restores.)

        ⚠ `<h1>` DELIBERATELY NOT USED. Screens below this own the page heading,
        and two h1s on one document is worse for a screen reader than the plain
        strong element here. The bar's own `aria-label` already scopes it.
      */}
      <div className="af-lctx-identity">
        <span className="af-lctx-crest" aria-hidden>
          <LeagueMark
            src={logoUrl}
            letter={logoLetter || (Array.from(leagueName.trim() || '•')[0] ?? '•').toUpperCase()}
            className="af-lctx-crest-img"
          />
        </span>
        <strong className="af-lctx-name" title={leagueName}>
          {leagueName}
        </strong>
      </div>

      <div className="af-lctx-statuses">
        <span className="af-lctx-chip" data-tone="source">
          {platform.toUpperCase()} import
        </span>
        <span className="af-lctx-chip" data-tone={gameDayActive ? 'live' : syncStale ? 'warn' : 'fresh'}>
          {gameDayActive ? 'Game-day view refresh · 20s' : `Synced ${syncLabel}`}
        </span>
        {decisionSlot !== undefined ? decisionSlot : <CoreLeagueDecisionChip available={Boolean(decisionAvailable)} />}
        <span className="af-lctx-chip" data-tone="chimmy">
          Chimmy · {CORE_SURFACE_LABELS[surface]}
        </span>
        <div className="af-lctx-type">
          <label htmlFor={selectId}>League type</label>
          {canConfirm ? (
            <select
              id={selectId}
              value={leagueType ?? ''}
              disabled={typeStatus === 'loading' || typeStatus === 'saving'}
              onChange={(event) => {
                if (isLeagueConceptType(event.target.value)) void updateLeagueType(event.target.value)
              }}
            >
              <option value="" disabled>Choose league type</option>
              {LEAGUE_CONCEPT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          ) : (
            <span>{typeStatus === 'loading' ? 'Loading…' : leagueConceptLabel(leagueType)}</span>
          )}
          <small role="status" aria-live="polite">
            {typeStatus === 'saving' ? 'Saving…' : typeStatus === 'saved' ? 'Saved to Sports OS' : typeStatus === 'error' ? 'Could not load or save' : ''}
          </small>
        </div>
      </div>

      {recommendationSlot !== undefined ? (
        recommendationSlot
      ) : recommendation ? (
        <CoreLeagueRecommendation leagueName={leagueName} surface={surface} recommendation={recommendation} />
      ) : null}
    </section>
  )
}
