import Link from 'next/link'
import { LeagueTabsPrewarm } from '@/components/core-app/LeagueTabsPrewarm'
import { LeagueTabsScroller } from '@/components/core-app/LeagueTabsScroller'
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
 * ⚠ ONLY KEYS THAT HAVE A BUILT, LEAGUE-SCOPED SCREEN APPEAR HERE. The designs
 * also show a "Schedule" tab; there is no schedule screen, and a tab that lands
 * on "not built yet" is worse than an absent one — that panel is the thing this
 * whole suite exists to remove.
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
   * ⚠ IT NAMES THE PROVIDER FOR THE REASON `importCoverageSummary` ALREADY
   * STATES IN ITS OWN HEADER: "We couldn't get your trade history" reads as our
   * failure and invites a support ticket; "Fleaflicker doesn't publish trade
   * history" is the truth and is something the reader can act on.
   */
  platform?: string | null
  /**
   * League-first phone shell: five tabs (Match · Team · Players · Trades · League) and the rest
   * under a "More" disclosure, instead of a twelve-tab scroller. A native <details>, so it
   * needs no client state.
   */
  compact?: boolean
}

/** The compact strip's five, in order, with their short labels. `''` is the league home. */
const COMPACT_PRIMARY: Array<{ key: string; label: string }> = [
  { key: 'matchup', label: 'Match' },
  { key: 'my-team', label: 'Team' },
  { key: 'players', label: 'Players' },
  { key: 'trades', label: 'Trades' },
  { key: '', label: 'League' },
]

type TabRequirement = 'scores' | 'trades' | 'draft'

const TABS: Array<{
  key: string
  label: string
  requires?: TabRequirement
}> = [
  { key: '', label: 'Overview' },
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
}: LeagueTabsProps) {
  const q = `?league=${encodeURIComponent(leagueId)}`
  const hiddenFor = (requires: TabRequirement): boolean =>
    requires === 'scores' ? hasScoredWeek === false : requires === 'trades' ? !tradeSupported : !draftSupported

  const visibleTabs = TABS.filter((tab) => !tab.requires || !hiddenFor(tab.requires))
  const notes = describeHiddenTabs({ hasScoredWeek, tradeSupported, draftSupported, platform })

  return (
    <nav className="af-lt" aria-label={`${leagueName} views`}>
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

      {compact ? (() => {
        const visibleKeys = new Set(visibleTabs.map((t) => t.key))
        const primary = COMPACT_PRIMARY.filter((t) => visibleKeys.has(t.key))
        const primaryKeys = new Set(primary.map((t) => t.key))
        const rest = visibleTabs.filter((t) => !primaryKeys.has(t.key))
        const tab = (key: string, label: string) => {
          const active = key ? key === activeKey : activeKey === 'home'
          return (
            <Link
              key={key || 'overview'}
              href={key ? `/core/${key}${q}` : `/core${q}`}
              className="af-lt-tab"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              {label}
            </Link>
          )
        }
        const restActive = rest.some((t) => t.key === activeKey)
        return (
          <div className="af-lt-compact">
            <div className="af-lt-compact-row">{primary.map((t) => tab(t.key, t.label))}</div>
            {rest.length ? (
              <details className="af-lt-more" open={restActive || undefined}>
                <summary className="af-lt-tab" data-active={restActive}>More</summary>
                <div className="af-lt-more-list">{rest.map((t) => tab(t.key, t.label))}</div>
              </details>
            ) : null}
          </div>
        )
      })() : (
        <LeagueTabsScroller activeKey={activeKey}>
          {visibleTabs.map((t) => {
            const active = t.key ? t.key === activeKey : activeKey === 'home'
            const href = t.key ? `/core/${t.key}${q}` : `/core${q}`
            return (
              <span key={t.key || 'overview'} role="listitem">
                <Link
                  href={href}
                  className="af-lt-tab"
                  data-active={active}
                  aria-current={active ? 'page' : undefined}
                >
                  {t.label}
                </Link>
              </span>
            )
          })}
        </LeagueTabsScroller>
      )}

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
        list and not one sentence. "No week has been scored yet" is temporary
        and ours; "the platform doesn't publish this" is permanent and theirs.
        Collapsing them would tell someone to wait for something that is never
        coming, or to give up on something that arrives on Sunday.
      */}
      {notes.length > 0 ? (
        <ul className="af-lt-absent" aria-label="Views not available for this league">
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
}): string[] {
  const notes: string[] = []
  const label = (platform ?? '').trim() || 'This platform'

  /*
   * ⚠ `=== false`, NOT `!hasScoredWeek`. `null` means the signal was not read —
   * the loader catches its own failure and returns null — and a failed read is
   * not evidence that the season has not started. Saying "no week has been
   * scored" there states a fact we do not have.
   */
  if (hasScoredWeek === false) {
    notes.push(
      'Matchup, Your week, Standings and Outlook open once this league has a scored week — they are all built from one.',
    )
  }
  if (!tradeSupported) {
    notes.push(`${label} doesn’t publish trade history, so there is no Trades view for this league.`)
  }
  if (!draftSupported) {
    notes.push(`${label} doesn’t publish draft results, so there is no Draft HQ view for this league.`)
  }
  return notes
}

export default LeagueTabs
