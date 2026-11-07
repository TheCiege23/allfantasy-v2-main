'use client'

import Link from 'next/link'
import { leagueWorkspaceHref, leagueWorkspaceMode } from '@/lib/league/league-workspace-navigation'
import { useEffect, useRef } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { LeagueTabsPrewarm } from '@/components/core-app/LeagueTabsPrewarm'
import { LeagueTabsScroller } from '@/components/core-app/LeagueTabsScroller'
import { navLabel } from '@/lib/core-app/navLabels'
import { useMessages } from '@/components/i18n/useMessages'
import { messagesFor } from '@/lib/i18n/messages'
import { leagueTabsMessages } from '@/lib/core-app/messages/leagueTabs'
import { leagueDestinationHidden } from '@/lib/core-app/leagueDestinations'
import '@/components/core-app/af-league-tabs.css'

/**
 * The in-league tab bar — 38a's segmented control.
 *
 * ⚠ SINCE 2026-11-05 ITS VIEW LINKS ARE HIDDEN INSIDE THE SHELL. The argument below was right when
 * the rail mixed league views with cross-league screens under no heading and dropped `?league=`.
 * Neither is true now: the rail groups the league's views (This week · League · Plan ahead) from one
 * list, lib/core-app/leagueDestinations.ts, and every league entry carries the league. Inside the
 * shell this bar now draws only the Open League pill and the "why a view is missing" notes.
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
  /**
   * The page draws Open League in the league context bar's identity line instead (the bar is on
   * this screen), so this row omits its own and, inside the shell, takes no space at all.
   */
  workspaceLinkElsewhere?: boolean
}

/**
 * "Open League ↗" — the league's own workspace. Shared by this row and the context bar, which
 * carries it when present so the pill does not cost a row of its own (2026-11-05).
 */
export function OpenLeagueLink({ leagueId, platform = null }: { leagueId: string; platform?: string | null }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(leagueTabsMessages)
  return (
    <Link className="af-lt-workspace-open" href={leagueWorkspaceHref(leagueId)} title={leagueWorkspaceMode(platform, language).description}>
      <span className="af-lt-workspace-label">{m.openLeague}</span> <span aria-hidden>↗</span>
    </Link>
  )
}

/** The compact strip's five, in order, with their short labels. `''` is the league home. */
const COMPACT_PRIMARY: Array<{ key: string; label: string }> = [
  { key: '', label: navLabel('overview') },
  { key: 'my-team', label: navLabel('my-team') },
  { key: 'matchup', label: navLabel('matchup') },
  { key: 'players', label: navLabel('players', 'short') },
  { key: 'moves', label: navLabel('moves') },
]

/* Which of these a league can show is decided by lib/core-app/leagueDestinations.ts — the gates the rail applies too. */
const TABS: Array<{ key: string; label: string }> = [
  { key: '', label: navLabel('overview') },
  { key: 'moves', label: navLabel('moves') },
  { key: 'schedule', label: navLabel('schedule') },
  { key: 'my-team', label: navLabel('my-team') },
  { key: 'matchup', label: navLabel('matchup') },
  { key: 'trades', label: navLabel('trades') },
  { key: 'waivers', label: navLabel('waivers') },
  { key: 'players', label: navLabel('players', 'short') },
  { key: 'war-room', label: navLabel('war-room') },
  { key: 'draft-hq', label: navLabel('draft-hq') },
  { key: 'week', label: navLabel('week') },
  { key: 'live', label: navLabel('live', 'short') },
  { key: 'standings', label: navLabel('standings') },
  { key: 'season-outlook', label: navLabel('season-outlook', 'short') },
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
  workspaceLinkElsewhere = false,
}: LeagueTabsProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const m = useMessages(leagueTabsMessages)
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
  const caps = { hasScoredWeek, trades: tradeSupported, draft: draftSupported }
  const visibleTabs = TABS.filter((tab) => !leagueDestinationHidden(tab.key, caps))
  const notes = describeHiddenTabs({ hasScoredWeek, tradeSupported, draftSupported, platform }, language)

  return (
    <nav className="af-lt" aria-label={m.navAria(leagueName)}>
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
        /*
         * ⚠ ONE ROW, NOT THREE (2026-11-05). Measured on allfantasy.ai at 375px, this nav was a
         * full-width "Open League" button, its explainer, five tabs that cut off at "Mo…", and
         * Live / More wrapped onto a row of their own — the whole first screen before any content.
         * "Open League" is now the row's last item, a compact pill whose explainer travels as its
         * title everywhere and is printed only on the Overview, the one screen that is ABOUT the
         * league. The destination itself is unchanged.
         */
        return (
          <div className="af-lt-compact" data-compact={compact} data-workspace-elsewhere={workspaceLinkElsewhere ? 'true' : undefined}>
            {/*
              ⚠ THE VIEW LINKS ARE HIDDEN INSIDE THE SHELL (2026-11-05), NOT REMOVED. There the rail
              (desktop), the icon nav (tablet) and the bottom bar + More sheet (phone) already list every
              one of these views, read from the same list (lib/core-app/leagueDestinations.ts), so the
              row was a second copy of the navigation on every page. Rendered outside the shell (the
              dev previews) it is still the league's navigation. See af-league-tabs.css.
            */}
            <div className="af-lt-views">
              <LeagueTabsScroller className="af-lt-compact-row" activeKey={activeKey}>{primary.map((t) => tab(t.key, m.compactTab(t.key, t.label)))}</LeagueTabsScroller>
              {tab('live', copy(navLabel('live', 'short')))}
              {commissionerHref && <Link className="af-lt-tab" href={commissionerHref}>{m.commissioner}</Link>}
              {rest.length ? (
                <details className="af-lt-more" ref={moreRef}>
                  {/* The active view is its own span so a phone can drop it and keep "More" one tab wide — see af-league-tabs.css. */}
                  <summary className="af-lt-tab" data-active={restActive}>{copy('More')}{restActiveTab ? <span className="af-lt-more-active"> · {copy(restActiveTab.label)}</span> : null}</summary>
                  <div className="af-lt-more-list" onClick={() => { if (moreRef.current) moreRef.current.open = false }}>{rest.map((t) => tab(t.key, copy(t.label)))}</div>
                </details>
              ) : null}
            </div>
            {workspaceLinkElsewhere ? null : <OpenLeagueLink leagueId={leagueId} platform={platform} />}
          </div>
        )
      })()}
      {activeKey === 'home' ? <p className="af-lt-workspace-note">{leagueWorkspaceMode(platform, language).description}</p> : null}

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
  const m = messagesFor(leagueTabsMessages, language)
  const label = (platform ?? '').trim() || m.thisPlatform

  /*
   * ⚠ `=== false`, NOT `!hasScoredWeek`. `null` means the signal was not read —
   * the loader catches its own failure and returns null — and a failed read is
   * not evidence that the season has not started. Saying "no week has been
   * scored" there states a fact we do not have.
   */
  if (hasScoredWeek === false) {
    notes.push(m.noScoredWeek)
  }
  if (!tradeSupported) {
    notes.push(m.noTrades(label))
  }
  if (!draftSupported) {
    notes.push(m.noDraft(label))
  }
  return notes
}

export default LeagueTabs
