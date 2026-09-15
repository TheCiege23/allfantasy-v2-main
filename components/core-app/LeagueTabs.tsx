import Link from 'next/link'
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
}

const TABS: Array<{
  key: string
  label: string
  requires?: 'scores' | 'trades' | 'draft'
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
}: LeagueTabsProps) {
  const q = `?league=${encodeURIComponent(leagueId)}`
  const visibleTabs = TABS.filter((tab) => {
    if (tab.requires === 'scores') return hasScoredWeek !== false
    if (tab.requires === 'trades') return tradeSupported
    if (tab.requires === 'draft') return draftSupported
    return true
  })

  return (
    <nav className="af-lt" aria-label={`${leagueName} views`}>
      <div className="af-lt-tabs" role="list">
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
      </div>
    </nav>
  )
}

export default LeagueTabs
