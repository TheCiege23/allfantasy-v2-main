'use client'

import Link from 'next/link'
import { leagueWorkspaceMode } from '@/lib/league/league-workspace-navigation'
import { useEffect, useId, useState, type ReactNode } from 'react'

import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { CORE_SURFACE_LABELS, type CoreSurfaceKey } from '@/lib/core-app/coreSurface'
import {
  LEAGUE_CONCEPT_OPTIONS,
  PIRATE_BASE_FORMAT_OPTIONS,
  isLeagueConceptType,
  isPirateBaseFormat,
  leagueConceptLabel,
  pirateBaseFormatLabel,
  type LeagueConceptType,
  type PirateBaseFormat,
} from '@/lib/league/leagueConceptOptions'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { leagueConceptText, SURFACE_LABEL_ES } from '@/lib/core-app/shellCopy'
import { leagueRecommendationText } from '@/lib/core-app/leagueRecommendationText'
import { useMessages } from '@/components/i18n/useMessages'
import { leagueContextBarMessages } from '@/lib/core-app/messages/leagueContextBar'
import '@/components/core-app/af-league-tabs.css'

/**
 * The bar's words in the reader's language (2026-10-03). It heads every in-league /core screen, and
 * a live Spanish check found its chips, league-type control and statuses all English.
 */
function useBarCopy() {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const surfaceLabel = (surface: CoreSurfaceKey) => {
    const english = CORE_SURFACE_LABELS[surface]
    return es ? (SURFACE_LABEL_ES[english] ?? coreUiCopy(english, language)) : english
  }
  const concept = (label: string) => leagueConceptText(label, language)
  return { language, surfaceLabel, concept }
}

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
  /**
   * Where the source chip leads: the Overview's "what's on file" panel. Null for a
   * native league, which has no import to describe — the chip is then plain text.
   */
  coverageHref?: string | null
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

/**
 * `available: null` is "not read yet": a muted chip that claims neither state.
 *
 * ⚠ THE CHIP SAYS "League insights", NOT "Decision OS". `docs/CLOSED_BETA_UI_QA_FIXES.md`
 * already renamed that phrase out of every surface it could reach, because it reads as
 * internal engineering jargon to a fantasy manager — but that pass covered
 * `app/league/[leagueId]/**` and never reached `/core`, where this chip renders on EVERY
 * in-league screen. The internal module name stays `decision-os`; only the label changed.
 */
export function CoreLeagueDecisionChip({ available }: { available: boolean | null }) {
  const m = useMessages(leagueContextBarMessages)
  const tone = available === null ? 'muted' : available ? 'decision' : 'muted'
  const label = available === null ? m.checking : available ? m.ready : m.building
  return (
    <span className="af-lctx-chip" data-tone={tone}>
      {m.leagueInsights} {label}
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
  const { language, surfaceLabel } = useBarCopy()
  const m = useMessages(leagueContextBarMessages)
  const askChimmy = () => {
    window.dispatchEvent(
      new CustomEvent(COMMS_OPEN_EVENT, {
        detail: {
          tab: 'chimmy',
          // The question lands in the reader's own composer, so it is asked in their language.
          prefill: m.askChimmyPrefill(leagueName, surfaceLabel(surface)),
        },
      }),
    )
  }
  return (
    <div className="af-lctx-action">
      <span className="af-lctx-action-copy">
        {/* The Decision OS writes these in English; translated here, where the language is known. */}
        <strong>{leagueRecommendationText(recommendation.action, language)}</strong>
        <span>{leagueRecommendationText(recommendation.rationale, language)}</span>
      </span>
      <button type="button" onClick={askChimmy}>{m.askChimmy}</button>
    </div>
  )
}

export default function CoreLeagueContextBar({
  leagueId,
  leagueName,
  platform,
  logoUrl = null,
  logoLetter,
  coverageHref = null,
  syncLabel,
  syncStale,
  gameDayActive,
  decisionAvailable,
  recommendation,
  surface,
  decisionSlot,
  recommendationSlot,
}: CoreLeagueContextBarProps) {
  const { language, surfaceLabel, concept } = useBarCopy()
  const m = useMessages(leagueContextBarMessages)
  const selectId = useId()
  const baseSelectId = useId()
  const [leagueType, setLeagueType] = useState<LeagueConceptType | null>(null)
  /** The saved Pirate answer — dynasty or redraft. Null for every other type. */
  const [pirateBase, setPirateBase] = useState<PirateBaseFormat | null>(null)
  /*
   * ⚠ PIRATE IS NOT SAVED UNTIL IT IS ANSWERED. Choosing it opens the follow-up
   * and holds the save: the API rejects a Pirate confirmation without a base,
   * and the base is what decides the league's value book.
   */
  const [pirateDraft, setPirateDraft] = useState(false)
  const [canConfirm, setCanConfirm] = useState(false)
  /*
   * 🛑 WHETHER A PERSON HAS CONFIRMED THE TYPE, SAID OUT LOUD (2026-09-25). The select used to be
   * pre-filled with the imported guess and look exactly like an answer, and choosing the value it
   * already showed fired no change — so a correct guess could not be confirmed at all. Every trade
   * grade in the league is priced on this type.
   */
  const [confirmed, setConfirmed] = useState(false)
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
          confirmation?: { type?: unknown; baseFormat?: unknown } | null
          suggestion?: { suggested?: unknown }
          storedType?: unknown
          /** The type trade grades are priced under right now (`leagueTypeBasis`). */
          gradedAs?: { type?: unknown } | null
          canConfirm?: boolean
        }>
      })
      .then((payload) => {
        // What the grades use comes before the stored column, which can lag it (a Sleeper keeper
        // league is stored `redraft` and graded as keeper). A confirmation outranks both.
        const raw =
          payload.confirmation?.type ?? payload.gradedAs?.type ?? payload.storedType ?? payload.suggestion?.suggested
        const base = payload.confirmation?.baseFormat
        setLeagueType(isLeagueConceptType(raw) ? raw : null)
        setPirateBase(raw === 'pirate' && isPirateBaseFormat(base) ? base : null)
        setPirateDraft(false)
        setCanConfirm(Boolean(payload.canConfirm))
        setConfirmed(isLeagueConceptType(payload.confirmation?.type))
        setTypeStatus('ready')
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== 'AbortError') setTypeStatus('error')
      })
    return () => controller.abort()
  }, [leagueId])

  const saveLeagueType = async (next: LeagueConceptType, base: PirateBaseFormat | null) => {
    const previous = { leagueType, pirateBase }
    setLeagueType(next)
    setPirateBase(base)
    setPirateDraft(false)
    setTypeStatus('saving')
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/league-type`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // `baseFormat` travels only with Pirate — no other type has the question.
        body: JSON.stringify(next === 'pirate' ? { type: next, baseFormat: base } : { type: next }),
      })
      if (!response.ok) throw new Error('save failed')
      setConfirmed(true)
      setTypeStatus('saved')
      window.setTimeout(() => setTypeStatus('ready'), 2400)
    } catch {
      setLeagueType(previous.leagueType)
      setPirateBase(previous.pirateBase)
      setTypeStatus('error')
    }
  }

  const chooseLeagueType = (next: LeagueConceptType) => {
    if (next === 'pirate') {
      setPirateDraft(true)
      setTypeStatus('ready')
      return
    }
    void saveLeagueType(next, null)
  }

  const shownType = pirateDraft ? 'pirate' : leagueType
  const askPirateBase = canConfirm && shownType === 'pirate'
  const busy = typeStatus === 'loading' || typeStatus === 'saving'
  const pirateBaseLabel = leagueType === 'pirate' ? pirateBaseFormatLabel(pirateBase) : null
  return (
    <section className="af-lctx" aria-label={m.systemStatus(leagueName)}>
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

      <details className="af-lctx-details"><summary>{m.leagueDetails}</summary>
      <div className="af-lctx-statuses">
        {coverageHref && leagueWorkspaceMode(platform, language).authority !== 'NATIVE' ? (
          /*
           * ⚠ A CLIENT NAVIGATION CANNOT BE TRUSTED TO LAND ON THE ANCHOR BY ITSELF. The
           * panel streams in behind its own Suspense boundary, so when Next looks for the
           * hash target after navigating, the element usually does not exist yet. The
           * panel scrolls itself into view on mount when the hash names it
           * (`ScrollToHashOnMount`), which covers a fresh load and a tab switch alike.
           * A plain <a> would have side-stepped none of that and cost a full reload.
           */
          <Link
            className="af-lctx-chip af-lctx-chip--link"
            data-tone="source"
            href={coverageHref}
            title={m.importTitle}
          >
            {m.importChip(platform.toUpperCase())}
          </Link>
        ) : (
          <span className="af-lctx-chip" data-tone="source">
            {leagueWorkspaceMode(platform, language).badge}
          </span>
        )}
        <span className="af-lctx-chip" data-tone={gameDayActive ? 'live' : syncStale ? 'warn' : 'fresh'}>
          {gameDayActive
            ? m.gameDay
            : syncStale ? m.updatesDelayed : m.connected}
        </span>
        {decisionSlot !== undefined ? decisionSlot : <CoreLeagueDecisionChip available={Boolean(decisionAvailable)} />}
        <span className="af-lctx-chip" data-tone="chimmy">
          Chimmy · {surfaceLabel(surface)}
        </span>
        {/* `#league-type`: every trade grade's "Confirm your league type" link lands here. */}
        <div className="af-lctx-type" id="league-type" data-confirmed={confirmed ? 'true' : 'false'}>
          <label htmlFor={selectId}>{m.leagueType}</label>
          {canConfirm ? (
            <select
              id={selectId}
              value={shownType ?? ''}
              disabled={busy}
              onChange={(event) => {
                if (isLeagueConceptType(event.target.value)) chooseLeagueType(event.target.value)
              }}
            >
              <option value="" disabled>{concept('Choose league type')}</option>
              {LEAGUE_CONCEPT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{concept(option.label)}</option>
              ))}
            </select>
          ) : (
            <span>
              {typeStatus === 'loading'
                ? m.loading
                : pirateBaseLabel
                  ? `${concept(leagueConceptLabel(leagueType))} · ${concept(pirateBaseLabel)}`
                  : concept(leagueConceptLabel(leagueType))}
            </span>
          )}
          {askPirateBase ? (
            /*
             * The Pirate follow-up. Sits inside the same `.af-lctx-type` group, so on
             * a phone it scrolls with the status row rather than wrapping under it,
             * and it picks up the same select styling.
             */
            <>
              <label htmlFor={baseSelectId}>{m.rostersCarryOver}</label>
              <select
                id={baseSelectId}
                value={pirateDraft ? '' : (pirateBase ?? '')}
                disabled={busy}
                onChange={(event) => {
                  if (isPirateBaseFormat(event.target.value)) void saveLeagueType('pirate', event.target.value)
                }}
              >
                <option value="" disabled>{m.choose}</option>
                {PIRATE_BASE_FORMAT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{concept(option.label)}</option>
                ))}
              </select>
            </>
          ) : null}
          {/*
            Confirming the type already shown. A select cannot do it — picking the value it holds
            fires no change — so an unconfirmed league gets an explicit button.
          */}
          {canConfirm && !confirmed && typeStatus === 'ready' && leagueType && !pirateDraft ? (
            <button
              type="button"
              className="af-lctx-confirm"
              onClick={() => void saveLeagueType(leagueType, leagueType === 'pirate' ? pirateBase : null)}
              disabled={leagueType === 'pirate' && !pirateBase}
            >
              {m.confirm} {concept(leagueConceptLabel(leagueType))}
            </button>
          ) : null}
          <small role="status" aria-live="polite">
            {typeStatus === 'saving'
              ? m.saving
              : typeStatus === 'saved'
                ? m.saved(concept(leagueConceptLabel(leagueType)))
                : typeStatus === 'error'
                  ? m.loadSaveError
                  : pirateDraft
                    ? m.pickPirateBase
                    : typeStatus === 'ready' && !confirmed
                      ? m.notConfirmed
                      : ''}
          </small>
        </div>
      </div></details>

      {recommendationSlot !== undefined ? (
        recommendationSlot
      ) : recommendation ? (
        <CoreLeagueRecommendation leagueName={leagueName} surface={surface} recommendation={recommendation} />
      ) : null}
    </section>
  )
}
