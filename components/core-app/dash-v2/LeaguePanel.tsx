'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ModeToggle } from '@/components/theme/ModeToggle'
import type { Dash34League } from '@/components/core-app/screens/Dashboard34'

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

const SPORT_FILTERS = ['ALL', 'NFL', 'NBA', 'NHL'] as const
type SportFilter = (typeof SPORT_FILTERS)[number]

function hasChip(league: Dash34League, label: string): boolean {
  return (league.chips ?? []).some((chip) => chip.label === label)
}

/** Mirrors dash34's rank() ordering so both surfaces sort the same way. */
function groupOf(league: Dash34League): string {
  if (league.priority === 'urgent' || league.priority === 'draft') return 'needs'
  if (hasChip(league, 'PRE DRAFT')) return 'predraft'
  if (hasChip(league, 'YOU COMMISH')) return 'commish'
  return 'other'
}

const GROUP_LABELS: Record<string, string> = {
  needs: 'NEEDS YOU',
  predraft: 'PRE DRAFT',
  commish: 'YOU COMMISSION',
  other: 'YOUR LEAGUES',
}

const GROUP_ORDER = ['needs', 'predraft', 'commish', 'other']

export function LeaguePanel({
  leagues,
  totalLeagues,
  quietSummary = null,
  user = null,
  commissionerCount = 0,
}: {
  leagues: Dash34League[]
  totalLeagues: number
  quietSummary?: { count: number; text: string } | null
  user?: { name: string; levelLabel?: string | null } | null
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
          The L / D / AF switch. Reuses the app's ModeToggle rather than a second
          implementation, so this panel cannot drift out of step with the global
          theme state or write the cookie differently.
        */}
        <ModeToggle className="af-d2-modes" />
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
      <Link href="/core/import" className="af-d2-import-cta">
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
                      href={`/core?league=${encodeURIComponent(league.id)}`}
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
        <Link href="/core/war-room" className="af-d2-panel-link">
          War Room
        </Link>
        <Link href="/core/tools" className="af-d2-panel-link">
          Tools
        </Link>
      </nav>

      <div className="af-d2-panel-foot">
        {/* The import CTA lives at the top of the panel now — see the note there.
            The footer keeps only identity, so the two are not competing. */}
        {user ? (
          <div className="af-d2-user">
            <span className="af-d2-user-avatar" aria-hidden>
              {initialsOf(user.name)}
            </span>
            <span className="af-d2-user-text">
              <span className="af-d2-user-name">{user.name}</span>
              {user.levelLabel ? (
                <span className="af-d2-user-level af-num">{user.levelLabel}</span>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
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
