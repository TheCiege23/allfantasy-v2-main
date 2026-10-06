'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { LeagueTabsPrewarm } from '@/components/core-app/LeagueTabsPrewarm'
import '@/components/core-app/af-league-tabs.css'

/**
 * The in-league tab bar — 38a's segmented control.
 *
 * ⚠ THIS IS THE MISSING NAVIGATION LAYER, NOT DECORATION. Every screen in the
 * 38a handoff carries one of these, and the suite shipped without it: all
 * twenty-two destinations went into the left rail instead. The rail is a list
 * of everything the app can show; it is not an answer to "I am inside this
 * league, show me the next thing about it".
 *
 * Losing that layer had a visible cost. Four rail items dropped `?league=`, so
 * moving between views quietly cleared the league you had chosen. The page
 * header names the league once; this control carries that league id forward.
 *
 * Only built league-scoped screens appear here. Schedule uses recorded
 * fixtures and saved rule dates; Moves groups the available trade/waiver flows.
 */

export type LeagueTabsProps = {
  leagueId: string
  leagueName: string
  /** The active /core segment, e.g. 'standings'. */
  activeKey: string
  hasScoredWeek?: boolean | null
  tradeSupported?: boolean
  draftSupported?: boolean
  /**
   * The platform's short name — "Sleeper", "ESPN" — for the absent-view notes.
   *
   * ⚠ IT NAMES THE PROVIDER, BUT NO LONGER BLAMES IT. This said "Fleaflicker
   * doesn't publish trade history", and `importCoverageSummary`'s header records
   * why that was retired: a `missing` bucket means only that THIS import did not
   * bring it across — our adapter may not read an endpoint the platform has, or
   * one call failed. So the note says what is true in every case and still
   * names where the league came from.
   */
  platform?: string | null
  /**
   * League-first shell: five tabs (Overview · My Team · Matchup · Players · Moves) and the rest
   * under a "More" disclosure, instead of a twelve-tab scroller. A native <details>, so it
   * needs no client state.
   */
  compact?: boolean
  commissionerHref?: string | null
}

/** The compact strip's five, in order, with their short labels. `''` is the league home. */
const COMPACT_PRIMARY: Array<{ key: string; label: string; labelEs: string }> = [
  { key: '', label: 'Overview', labelEs: 'Resumen' },
  { key: 'my-team', label: 'My Team', labelEs: 'Equipo' },
  { key: 'matchup', label: 'Matchup', labelEs: 'Partido' },
  { key: 'players', label: 'Players', labelEs: 'Jugad.' },
  { key: 'moves', label: 'Moves', labelEs: 'Movimientos' },
]

type TabRequirement = 'scores' | 'trades' | 'draft'

const TABS: Array<{
  key: string
  label: string
  requires?: TabRequirement
}> = [
  { key: '', label: 'Overview' },
  { key: 'moves', label: 'Moves' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'my-team', label: 'My team' },
  { key: 'matchup', label: 'Matchup', requires: 'scores' },
  { key: 'trades', label: 'Trades', requires: 'trades' },
  { key: 'waivers', label: 'Waivers' },
  { key: 'players', label: 'Players' },
  { key: 'war-room', label: 'War Room' },
  { key: 'draft-hq', label: 'Draft HQ', requires: 'draft' },
  { key: 'week', label: 'Your week', requires: 'scores' },
  { key: 'live', label: 'Live' },
  { key: 'standings', label: 'Standings', requires: 'scores' },
  { key: 'season-outlook', label: 'Outlook', requires: 'scores' },
]

export function LeagueTabs({
  leagueId,
  leagueName,
  activeKey,
  hasScoredWeek = null,
  tradeSupported = true,
  draftSupported = true,
  platform = null,
  compact = false,
  commissionerHref,
}: LeagueTabsProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const q = `?league=${encodeURIComponent(leagueId)}`
  const moreRef = useRef<HTMLDetailsElement>(null)
  /*
   * ⚠ ON A PHONE THE MORE LIST IS A DROPDOWN OVER THE PAGE, so it has to close
   * the way a menu does: a tap outside it, Escape, or picking a view. A bare
   * <details> closes only when its own summary is tapped again, which left the
   * list covering Chimmy's moves until the reader found the word "More".
   */
  useEffect(() => {
    const close = (event: Event) => {
      const el = moreRef.current
      if (!el?.open) return
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !el.contains(event.target as Node)) el.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])
  const hiddenFor = (requires: TabRequirement): boolean =>
    requires === 'scores' ? hasScoredWeek === false : requires === 'trades' ? !tradeSupported : !draftSupported

  const visibleTabs = TABS.filter((tab) => !tab.requires || !hiddenFor(tab.requires))
  const notes = describeHiddenTabs({ hasScoredWeek, tradeSupported, draftSupported, platform }, language)

  return (
    <nav className="af-lt" aria-label={language === 'es' ? `Secciones de ${leagueName}` : `${leagueName} views`}>
      {/*
        Warms My team and Matchup once the screen you asked for has landed.

        ⚠ IT READS `visibleTabs`, NOT THE FULL TAB LIST, so a league whose import
        cannot support a screen never spends a render warming it. That is the
        same `hiddenFor` gate the strip above draws from — one decision about
        what this league can show, used for both, rather than a prewarm list
        that can drift out of step with the tabs it is meant to anticipate.
      */}
      <LeagueTabsPrewarm
        leagueId={leagueId}
        activeKey={activeKey}
        availableKeys={visibleTabs.map((tab) => tab.key)}
      />

      {(() => {
        const visibleKeys = new Set(visibleTabs.map((t) => t.key))
        const primary = COMPACT_PRIMARY.filter((t) => visibleKeys.has(t.key))
        const primaryKeys = new Set(primary.map((t) => t.key))
        const rest = visibleTabs.filter((t) => !primaryKeys.has(t.key) && t.key !== 'live')
        const tab = (key: string, label: string) => {
          const active = key ? key === activeKey : activeKey === 'home'
          return (
            <Link
              key={key || 'overview'}
              href={key ? `/core/${key}${q}` : `/core${q}`}
              className="af-lt-tab"
              data-core-nav=""
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              {label}
            </Link>
          )
        }
        const restActive = rest.some((t) => t.key === activeKey)
        const restActiveTab = rest.find((t) => t.key === activeKey)
        return (
          <div className="af-lt-compact" data-compact={compact}>
            <div className="af-lt-compact-row" style={{ gridTemplateColumns: `repeat(${primary.length}, minmax(0, 1fr))` }}>{primary.map((t) => tab(t.key, language === 'es' ? t.labelEs : t.label))}</div>
            {tab('live', language === 'es' ? 'En vivo' : 'Live')}
            {commissionerHref && <Link className="af-lt-tab" href={commissionerHref}>{language === 'es' ? 'Comisionado' : 'Commissioner'}</Link>}
            {rest.length ? (
              <details className="af-lt-more" ref={moreRef}>
                {/* The active view is its own span so a phone can drop it and keep "More" one tab wide — see af-league-tabs.css. */}
                <summary className="af-lt-tab" data-active={restActive}>{copy('More')}{restActiveTab ? <span className="af-lt-more-active"> · {copy(restActiveTab.label)}</span> : null}</summary>
                <div className="af-lt-more-list" onClick={() => { if (moreRef.current) moreRef.current.open = false }}>{rest.map((t) => tab(t.key, copy(t.label)))}</div>
              </details>
            ) : null}
          </div>
        )
      })()}

      {/*
        🛑 A TAB THAT VANISHES WITHOUT A REASON IS THE BUG THIS GATING CREATED.
        Removing an unusable tab is right — the note at the top of this file
        argues it, and `importCoverageSummary` was built to decide it. But the
        three gates above delete up to six of the twelve entries and said
        nothing, so a Fleaflicker league and a Sleeper league differed by half
        the navigation with no visible cause, and the honest answer
        (`ImportCoverageSummary.sentence`) was already computed and rendered on
        exactly one screen — the Overview — which is the one screen you may not
        be on when you go looking for Trades.

        ⚠ AND THE THREE REASONS ARE NOT THE SAME KIND, which is why this is a
        list and not one sentence. "No week has been scored yet" arrives on
        Sunday by itself; "we couldn't bring this across from <Platform>" does
        not, and may never. Collapsing them would tell someone to wait for
        something that is not coming, or to give up on something that is.
      */}
      {notes.length > 0 ? (
        <ul className="af-lt-absent" aria-label={copy('Views not available for this league')}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </nav>
  )
}

/**
 * Why a tab is missing, in the league's own terms.
 *
 * Exported for its test: the mapping from three booleans to the sentences a
 * user reads is the whole behaviour here, and asserting it through a rendered
 * component would test JSX instead.
 */
export function describeHiddenTabs({
  hasScoredWeek,
  tradeSupported,
  draftSupported,
  platform,
}: {
  hasScoredWeek: boolean | null
  tradeSupported: boolean
  draftSupported: boolean
  platform?: string | null
}, language = 'en'): string[] {
  const notes: string[] = []
  const es = language === 'es'
  const label = (platform ?? '').trim() || (es ? 'esta plataforma' : 'this platform')

  /*
   * ⚠ `=== false`, NOT `!hasScoredWeek`. `null` means the signal was not read —
   * the loader catches its own failure and returns null — and a failed read is
   * not evidence that the season has not started. Saying "no week has been
   * scored" there states a fact we do not have.
   */
  if (hasScoredWeek === false) {
    notes.push(
      es ? 'Enfrentamiento, Tu semana, Clasificación y Pronóstico se abren cuando esta liga tenga una semana puntuada.' : 'Matchup, Your week, Standings and Outlook open once this league has a scored week — they are all built from one.',
    )
  }
  if (!tradeSupported) {
    notes.push(es ? `Aún no pudimos importar el historial de intercambios de ${label} para esta liga; la vista de Intercambios no está disponible.` : `We couldn’t bring across trade history from ${label} for this league yet, so there is no Trades view.`)
  }
  if (!draftSupported) {
    notes.push(es ? `Aún no pudimos importar los resultados del draft de ${label} para esta liga; la vista de Draft HQ no está disponible.` : `We couldn’t bring across draft results from ${label} for this league yet, so there is no Draft HQ view.`)
  }
  return notes
}

export default LeagueTabs
