'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { Dash34League } from '@/components/core-app/screens/Dashboard34'
import { PanelUserMenu } from '@/components/core-app/dash-v2/PanelUserMenu'

/**
 * Dashboard v2 left panel (300px) — the league list, grouped by urgency.
 *
 * ⚠ THE GROUPS ARE DERIVED FROM SIGNALS THAT EXIST, NOT FROM THE MOCKUP'S LABELS.
 * The handoff shows NEEDS YOU / LIVE NOW / LATER TODAY / QUIET with a live score
 * beside every row. Two of those groups have no source on this database:
 * `LeagueTeam` carries a result on 0 of 893 rows, so nothing can be "live now",
 * and no per-league kickoff time is stored, so nothing can be placed in "later
 * today". Rendering those headers over an empty list would assert a measured
 * emptiness that was never measured.
 *
 * So the groups are data-driven and self-hiding: each renders only when it has
 * rows. When sync populates scores, a LIVE NOW group can be added here and will
 * appear on its own. The signals that do exist today are exactly the ones
 * dash34's own rank() uses — an unavailable starter, a draft in progress, and
 * being the commissioner — so the panel and the main column stay in agreement.
 */

type Group = { key: string; label: string; rows: Dash34League[] }

/*
 * ⚠ THE LIST IS A SUPERSET, NOT A PROMISE. Only chips whose sport actually
 * appears on this account render (see availableSports below), so widening this
 * cannot produce a filter that matches nothing. It was NFL/NBA/NHL only, which
 * silently hid the sport filter entirely from anyone whose leagues are MLB,
 * college or soccer — their chip row just never appeared.
 */
const SPORT_FILTERS = ['ALL', 'NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
type SportFilter = (typeof SPORT_FILTERS)[number]

function hasChip(league: Dash34League, label: string): boolean {
  return (league.chips ?? []).some((chip) => chip.label === label)
}

/** Mirrors dash34's rank() ordering so both surfaces sort the same way. */
/*
 * ⚠ "DRAFTING" IS ITS OWN GROUP NOW, NOT A RENAME OF "NEEDS YOU". Those were one
 * bucket (`priority === 'urgent' || priority === 'draft'`) under the heading
 * NEEDS YOU. Simply relabelling it DRAFTING would have put a league with an
 * unavailable starter — urgent, not drafting — under a heading that says it is
 * drafting, which is a false statement about that league rather than a wording
 * choice. Splitting keeps both true: a live draft goes to DRAFTING, everything
 * else urgent stays in NEEDS YOU, and NEEDS YOU self-hides when it is empty
 * (which is why the panel looks like a pure rename today — right now every
 * urgent league IS drafting).
 */
function groupOf(league: Dash34League): string {
  if (league.priority === 'draft' || hasChip(league, 'DRAFTING')) return 'drafting'
  if (league.priority === 'urgent') return 'needs'
  if (hasChip(league, 'PRE DRAFT')) return 'predraft'
  if (hasChip(league, 'YOU COMMISH')) return 'commish'
  return 'other'
}

/*
 * ⚠ THE LAST GROUP IS "YOU JOINED", NOT "YOUR LEAGUES". Every group on this
 * panel is one of your leagues, so "YOUR LEAGUES" named the whole list rather
 * than this slice of it — and sitting under YOU COMMISSION it read as the
 * opposite of what it is. These are the leagues you play in but do not run.
 */
const GROUP_LABELS: Record<string, string> = {
  drafting: 'DRAFTING',
  needs: 'NEEDS YOU',
  predraft: 'PRE DRAFT',
  commish: 'YOU COMMISSION',
  other: 'YOU JOINED',
}

const GROUP_ORDER = ['drafting', 'needs', 'predraft', 'commish', 'other']

export function LeaguePanel({
  leagues,
  totalLeagues,
  quietSummary = null,
  levelLabel = null,
  commissionerCount = 0,
}: {
  leagues: Dash34League[]
  totalLeagues: number
  quietSummary?: { count: number; text: string } | null
  /*
   * ⚠ REPLACED A `user` PROP THAT NO CALLER EVER PASSED. DashboardV2 renders this
   * panel without it, so the identity footer was dead markup on every account —
   * it defaulted to null and rendered nothing. Identity now comes from
   * `useSettingsProfile` inside PanelUserMenu; only the career level, which that
   * hook does not carry, is still threaded through.
   */
  levelLabel?: string | null
  /** Leagues you commission — badges the Commissioner Hub link. */
  commissionerCount?: number
}) {
  const [sport, setSport] = useState<SportFilter>('ALL')

  /*
   * Only offer a sport chip when at least one league actually carries that
   * sport. A filter that is always visible but matches nothing looks broken and
   * teaches the user not to trust the controls.
   */
  const availableSports = useMemo(() => {
    const present = new Set(
      leagues.map((l) => (l.sport ?? '').toUpperCase()).filter(Boolean),
    )
    return SPORT_FILTERS.filter((s) => s === 'ALL' || present.has(s))
  }, [leagues])

  const filtered = useMemo(
    () =>
      sport === 'ALL'
        ? leagues
        : leagues.filter((l) => (l.sport ?? '').toUpperCase() === sport),
    [leagues, sport],
  )

  const groups: Group[] = useMemo(() => {
    const byKey = new Map<string, Dash34League[]>()
    for (const league of filtered) {
      const key = groupOf(league)
      const bucket = byKey.get(key)
      if (bucket) bucket.push(league)
      else byKey.set(key, [league])
    }
    return GROUP_ORDER.filter((key) => (byKey.get(key)?.length ?? 0) > 0).map((key) => ({
      key,
      label: GROUP_LABELS[key] ?? key.toUpperCase(),
      rows: byKey.get(key) ?? [],
    }))
  }, [filtered])

  return (
    <aside className="af-d2-panel" aria-label="Your leagues">
      <div className="af-d2-panel-head">
        <Link href="/" className="af-d2-brand" aria-label="AllFantasy — back to home">
          <span className="af-d2-wordmark">AllFantasy</span>
        </Link>
        {/*
          NO THEME SWITCH HERE. This header carried a `ModeToggle` while the app
          ALSO rendered its fixed `GlobalModeToggle` in the bottom-right corner —
          two switches for one setting, both on screen at once. The single
          control now lives in the settings popup under the user's name at the
          foot of this panel, which is also where `GlobalModeToggle` steps aside
          for it. One control, one setting.
        */}
      </div>

      <div className="af-d2-panel-title">
        <h1 className="af-d2-h1">Your leagues</h1>
        <span className="af-d2-total af-num">{totalLeagues}</span>
      </div>

      {/*
        Import is the primary action in this panel, not a footer afterthought.
        It sits above the list and carries the solid accent fill: connecting a
        platform is the one thing a user with no leagues — or with leagues on a
        platform they have not connected yet — has to be able to find without
        hunting. The handoff put a dashed row in the footer; that is the right
        weight once an account is established and the wrong weight for everyone
        else, so the prominent version is the one that ships.
      */}
      {/*
        /import, NOT /core/import. `import` is not in SCREEN_KEYS, so /core/import
        hits the catch-all's "unknown segment → home" fallback and silently
        re-renders the dashboard. A prominent CTA whose whole job is helping
        someone find the importer, quietly returning them to where they already
        were, is worse than no button. The live flow (ImportV4, with provider
        availability from provider-ui-config) is mounted at /import.
      */}
      <Link href="/import" className="af-d2-import-cta">
        <span className="af-d2-import-cta-label">+ Import a league</span>
        <span className="af-d2-import-cta-plats af-num">SLEEPER · ESPN · YAHOO</span>
      </Link>

      {availableSports.length > 1 ? (
        <div className="af-d2-filters" role="group" aria-label="Filter leagues by sport">
          {availableSports.map((option) => (
            <button
              key={option}
              type="button"
              className={`af-d2-filter af-num${option === sport ? ' is-active' : ''}`}
              aria-pressed={option === sport}
              onClick={() => setSport(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}

      <div className="af-d2-groups">
        {groups.length === 0 ? (
          <p className="af-d2-empty">
            {sport === 'ALL'
              ? 'No leagues imported yet.'
              : `No ${sport} leagues. Switch to ALL to see the rest.`}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="af-d2-group">
              <div className="af-d2-group-label af-num">
                {group.label}
                <span className="af-d2-group-count">· {group.rows.length}</span>
              </div>
              <ul className="af-d2-list">
                {group.rows.map((league) => (
                  <li key={league.id}>
                    {/*
                      Sleeper's row anatomy, with our labels: platform avatar,
                      then name / league info / state stacked beside it, and the
                      state carries a colour-coded dot rather than a right-aligned
                      chip. The dot is what makes a long list scannable — the eye
                      finds colour in a column faster than it reads text at the
                      ragged right edge of truncated names.
                    */}
                    {/*
                      Choosing a league opens THAT LEAGUE'S DASHBOARD, always.
                      league.href is action-specific — the loader points it at
                      my-team, or draft-hq, or the league home depending on what
                      is wrong — which is right for a priority card ("do this
                      now") and wrong for a list row. Picking a league from a list
                      means "show me this league", not "jump me into whichever
                      sub-screen we think is most urgent".
                    */}
                    <Link
                      /*
                       * ⚠ /dashboard, NOT /core. Choosing a league is a STATE of
                       * this screen, not a trip to a different product surface —
                       * the league-scoped view now renders at ?league= on the
                       * same route, which is also where the season timeline,
                       * Draft HQ and Commissioner Hub live.
                       */
                      href={`/dashboard?league=${encodeURIComponent(league.id)}`}
                      className="af-d2-row"
                    >
                      <span className="af-d2-tile" data-platform={league.platform} aria-hidden>
                        {/* Same treatment as Dashboard34's LeagueTile — a plain
                            img with an initials fallback, not next/image: these
                            are arbitrary platform CDN hosts. */}
                        {league.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={league.imageUrl} alt="" />
                        ) : (
                          initialsOf(league.name)
                        )}
                      </span>
                      <span className="af-d2-row-text">
                        <span className="af-d2-row-name">{league.name}</span>
                        {/* League info: season, size, type, scoring — already
                            composed by the loader as "2026 · 12-team · Dynasty ·
                            PPR". This is the line the direction asked for. */}
                        {league.formatLabel ? (
                          <span className="af-d2-row-meta af-num">{league.formatLabel}</span>
                        ) : null}
                        {league.chips?.[0] ? (
                          <span
                            className={`af-d2-row-state af-num af-d2-row-state--${
                              league.priority ?? 'plain'
                            }`}
                          >
                            <span className="af-d2-dot" aria-hidden />
                            {league.chips[0].label}
                          </span>
                        ) : null}
                      </span>
                      {/*
                        No score is rendered. 0 of 893 LeagueTeam rows carry a
                        result, so any number here would be invented rather than
                        read. Scored weeks live in WeeklyMatchup and are shown in
                        Your Week, where their season can be labelled honestly.
                      */}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        {quietSummary && quietSummary.count > 0 ? (
          <div className="af-d2-quiet">
            <span className="af-d2-quiet-text">{quietSummary.text}</span>
          </div>
        ) : null}
      </div>

      {/*
        Commissioner and Communications live in AfCoreShell's nav, and this screen
        renders outside that shell — so without these entries the two capabilities
        would simply vanish from the dashboard rather than move. They are links to
        the existing screens, not reimplementations.
      */}
      <nav className="af-d2-panel-links" aria-label="More">
        <Link href="/core/commissioner" className="af-d2-panel-link">
          Commissioner Hub
          {commissionerCount && commissionerCount > 0 ? (
            <span className="af-d2-panel-link-count af-num">{commissionerCount}</span>
          ) : null}
        </Link>
        {/*
          ⚠ THE HREF MOVED WITH THE LABEL, DELIBERATELY. Renaming this to
          "Legacy & Rankings" while it still pointed at /core/war-room would have
          been a link that lies about where it goes. `career` is the Legacy
          screen and is a real key in SCREEN_KEYS, so the label and the
          destination now agree.

          ⚠ WAR ROOM IS NOW UNLINKED FROM THIS PANEL, and it is not in the Tools
          grid either (that grid is Player finder / Trade lab / Waiver plan /
          Rankings / Career & Legacy / Commissioner HQ). This screen renders
          OUTSIDE AfCoreShell, whose nav normally carries it — which is the whole
          reason these panel links exist. So /core/war-room is currently reachable
          only by typing the URL. Kept as requested; add a tile if that access
          matters.
        */}
        <Link href="/core/career" className="af-d2-panel-link">
          Legacy &amp; Rankings
        </Link>
        <Link href="/core/tools" className="af-d2-panel-link">
          Tools
        </Link>
      </nav>

      {/*
        Identity sits under the league list, and opening it is how you reach
        settings and the one appearance control on this screen. The import CTA
        lives at the top of the panel — see the note there — so the two primary
        actions are not competing for the same corner.
      */}
      <PanelUserMenu levelLabel={levelLabel} />
    </aside>
  )
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

export default LeaguePanel
