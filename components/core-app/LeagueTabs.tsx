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
 * moving between views quietly cleared the league you had chosen, and nothing
 * on screen said which league you were in to begin with. The named chip below
 * is half the fix — it states the league — and the tabs are the other half:
 * every one of them carries the id forward.
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
}

const TABS: Array<{ key: string; label: string }> = [
  { key: 'my-team', label: 'My team' },
  { key: 'matchup', label: 'Matchup' },
  { key: 'week', label: 'Your week' },
  { key: 'standings', label: 'Standings' },
  { key: 'season-outlook', label: 'Outlook' },
]

export function LeagueTabs({ leagueId, leagueName, activeKey }: LeagueTabsProps) {
  const q = `?league=${encodeURIComponent(leagueId)}`

  return (
    <nav className="af-lt" aria-label={`${leagueName} views`}>
      {/*
        The league is NAMED, not implied by a highlighted rail chip. "Which
        league am I looking at" was answerable only by scanning the rail for
        the active item, which is a poor answer on an account with sixty.
      */}
      <span className="af-lt-league" title={leagueName}>
        <span className="af-label af-lt-league-eyebrow">In league</span>
        <span className="af-lt-league-name">{leagueName}</span>
      </span>

      <div className="af-lt-tabs" role="list">
        {TABS.map((t) => {
          const active = t.key === activeKey
          return (
            <Link
              key={t.key}
              role="listitem"
              href={`/core/${t.key}${q}`}
              className="af-lt-tab"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default LeagueTabs
