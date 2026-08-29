import Link from 'next/link'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import '@/components/core-app/af-pick-league.css'
import type { ReactNode } from 'react'

/**
 * The no-league state for a league-scoped screen.
 *
 * ⚠ THIS REPLACES A DEAD END. Every league-scoped tab used to render one
 * sentence — "Pick a league from the rail" — which is true, useless, and the
 * most common state on an account with sixty leagues. The rail is right there;
 * being told to use it is not information.
 *
 * What a user actually wants at this moment is "which of my leagues needs me",
 * and that list already exists: `deriveOutstandingIssues` computes it for the
 * Commissioner and Notifications badges. It was being thrown away here.
 *
 * ⚠ EVERY ROW LANDS ON THE TAB YOU WERE ALREADY ON. A row links to
 * `/core/<thisTab>?league=<id>`, not to a generic league home — clicking an
 * issue from Waivers puts you in that league's Waivers, which is where the
 * issue lives. Sending you to a league home and making you re-navigate is how
 * the old empty state wasted the click it asked for.
 */

export type PickALeagueProps = {
  /** The /core segment this screen renders, e.g. 'waivers'. Rows link back to it. */
  tabKey: string
  title: string
  /** Why this screen is per-league. Kept from the old empty state — it was correct. */
  blurb: string
  issues: CoreIssue[]
  /**
   * `imageUrl` and `mark` are the rail's already-resolved crest and letter
   * fallback.
   *
   * ⚠ THEY WERE BEING DISCARDED. The caller passes `rail`, whose rows carry a
   * resolved `imageUrl` (Sleeper avatar hash already expanded to its CDN URL),
   * and this prop's type narrowed them away — so every tile in the picker
   * rendered as text while the same leagues showed real crests one screen over.
   */
  leagues: Array<{
    id: string
    name: string
    platform?: string | null
    imageUrl?: string | null
    mark?: string
  }>
  /**
   * Rendered between the header and "Needs you first".
   *
   * The handoff puts the cross-league pulse ABOVE the queue and the picker and
   * leaves both otherwise unchanged, so it is composed in rather than forking a
   * second copy of this screen for one tab.
   */
  above?: ReactNode
}

/** Most severe first, and only rows that name a league — a row we cannot route is noise here. */
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export function PickALeague({
  tabKey,
  title,
  blurb,
  issues,
  leagues,
  above,
}: PickALeagueProps) {
  const routable = issues
    .filter((i) => i.leagueId != null)
    .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9))
    .slice(0, 10)

  const leagueCount = new Set(routable.map((i) => i.leagueId)).size

  return (
    <div className="af-pl">
      <header className="af-pl-head">
        <p className="af-label af-pl-eyebrow">Core · {title}</p>
        <h1 className="af-display af-pl-title">{title}</h1>
        <p className="af-pl-blurb">{blurb}</p>
      </header>

      {above}

      {routable.length > 0 ? (
        <section className="af-pl-panel" aria-labelledby="af-pl-queue">
          <header className="af-pl-panel-head">
            <h2 className="af-label" id="af-pl-queue">
              Needs you first
            </h2>
            <span className="af-pl-panel-note">
              {routable.length} across {leagueCount} {leagueCount === 1 ? 'league' : 'leagues'}
            </span>
          </header>

          <ul className="af-pl-rows">
            {routable.map((i) => (
              <li key={i.id}>
                <Link
                  className="af-pl-row"
                  href={`/core/${tabKey}?league=${encodeURIComponent(i.leagueId as string)}`}
                >
                  <span className="af-pl-sev" data-sev={i.severity} aria-hidden>
                    {i.glyph}
                  </span>
                  <span className="af-pl-row-text">
                    <span className="af-pl-row-title">{i.title}</span>
                    <span className="af-pl-row-meta">{i.meta}</span>
                  </span>
                  {/*
                    The league name is the point of the row on this screen — it is
                    the answer to "which one", so it is not buried in the meta line.
                  */}
                  <span className="af-pl-row-league">{i.leagueName ?? 'Unnamed league'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="af-pl-panel" data-empty="true">
          <h2 className="af-label">Needs you first</h2>
          {/*
            "Nothing needs you" and "we could not work out what needs you" are
            different facts and must not share a rendering. This branch is only
            the first: the queue ran and came back empty.
          */}
          <p className="af-pl-quiet">
            Nothing in your leagues is waiting on a decision right now. Pick one below to look
            around anyway.
          </p>
        </section>
      )}

      <section className="af-pl-panel" aria-labelledby="af-pl-leagues">
        <header className="af-pl-panel-head">
          <h2 className="af-label" id="af-pl-leagues">
            Or pick a league
          </h2>
          <span className="af-pl-panel-note">{leagues.length} on file</span>
        </header>

        {leagues.length > 0 ? (
          <div className="af-pl-grid">
            {leagues.map((l) => (
              <Link
                key={l.id}
                className="af-pl-league"
                href={`/core/${tabKey}?league=${encodeURIComponent(l.id)}`}
              >
                {/*
                  The crest, with the rail's own letter mark as the fallback —
                  never a broken <img>, and never nothing.
                */}
                {l.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="af-pl-league-crest"
                    src={l.imageUrl}
                    alt=""
                    width={22}
                    height={22}
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="af-pl-league-crest af-pl-league-crest--none"
                    data-platform={l.platform ?? undefined}
                    aria-hidden
                  >
                    {l.mark ?? l.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="af-pl-league-name">{l.name}</span>
                {l.platform ? (
                  <span className="af-platform af-pl-league-plat" data-platform={l.platform}>
                    {l.platform.toUpperCase()}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <p className="af-pl-quiet">
            No leagues are connected yet. <Link href="/import">Connect a platform</Link> and
            this screen fills in.
          </p>
        )}
      </section>
    </div>
  )
}

export default PickALeague
