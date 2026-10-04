import Link from 'next/link'
import type { CoreIssue, IssueSeverity } from '@/lib/core-app/outstandingIssues'
import '@/components/core-app/af-pick-league.css'
import type { ReactNode } from 'react'
import { NoLeaguesYet } from '@/components/core-app/boards/BoardKit'
import { TopicTip } from '@/components/core-app/TopicTip'

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
  /**
   * Why this screen is per-league. Kept from the old empty state — it was correct. A node, not only a
   * string, so a caller can pass client copy that follows the language switch (see `MatchupPickerCopy`).
   */
  blurb: ReactNode
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
  /** Inventory-only views do not compute a decision queue or claim that it is clear. */
  showQueue?: boolean
  /**
   * Where an issue row goes. Defaults to this tab in the issue's league — right for a tab that
   * is where the issue lives (Waivers, Draft HQ). A tab that is NOT (War Room: its league view is
   * Scout, which fixes neither a stale sync nor a draft) passes the issue's own destination.
   */
  issueHref?: (issue: CoreIssue & { leagueId: string }) => string
  /**
   * The queue's all-clear sentence, when the default overclaims. The queue only knows what
   * `deriveOutstandingIssues` detects (stale syncs and drafts), so on a screen that shows other
   * urgent work above it, "Nothing … is waiting on a decision" contradicts the screen.
   */
  queueClearText?: string
}

/**
 * Most severe first, and only rows that name a league — a row we cannot route is noise here.
 *
 * Keyed on `IssueSeverity` itself, so a severity added there is a compile error here rather than
 * another silent miss. It was once keyed on critical/high/medium/low — values no CoreIssue carries —
 * so every lookup fell through to one default and this sort never moved a row.
 */
const RANK: Record<IssueSeverity, number> = { bad: 0, warn: 1, info: 2 }

export function PickALeague({
  tabKey,
  title,
  blurb,
  issues,
  leagues,
  above,
  showQueue = true,
  issueHref,
  queueClearText,
}: PickALeagueProps) {
  const hrefFor = (i: CoreIssue & { leagueId: string }) =>
    issueHref ? issueHref(i) : `/core/${tabKey}?league=${encodeURIComponent(i.leagueId)}`
  const routable = issues
    .filter((i): i is CoreIssue & { leagueId: string } => i.leagueId != null)
    .sort((a, b) => RANK[a.severity] - RANK[b.severity])
    .slice(0, 10)

  const leagueCount = new Set(routable.map((i) => i.leagueId)).size

  /*
   * 🛑 NO LEAGUES IS NOT "NOTHING IS WAITING" (2026-09-29). With an empty account this screen said
   * "Nothing in your leagues is waiting on a decision… Pick one below", then "0 on file" and no
   * league to pick — a false all-clear and a dead end, on the screen a new user or an App Store
   * reviewer lands on when a board has no data. It now offers the same ways forward as the boards.
   */
  if (leagues.length === 0) {
    return (
      <div className="af-pl">
        <header className="af-pl-head">
          <p className="af-label af-pl-eyebrow">Core · {title}</p>
          <h1 className="af-display af-pl-title">{title}</h1>
          <p className="af-pl-blurb">{blurb}</p>
        </header>
        {above}
        <NoLeaguesYet what={`Once one is, ${title} works inside it, with that league's own scoring and rules.`} />
      </div>
    )
  }

  return (
    <div className="af-pl">
      <header className="af-pl-head">
        <p className="af-label af-pl-eyebrow">Core · {title}</p>
        <h1 className="af-display af-pl-title">{title}</h1>
        <p className="af-pl-blurb">{blurb}</p>
      </header>

      {above}

      {showQueue ? routable.length > 0 ? (
        <section className="af-pl-panel" aria-labelledby="af-pl-queue">
          <header className="af-pl-panel-head">
            {/*
              The "?" sits BESIDE the heading, not inside it: the heading names this section
              through aria-labelledby. Grouped so space-between keeps it next to the words.
            */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <h2 className="af-label" id="af-pl-queue">
                Needs you first
              </h2>
              <TopicTip topic="needsYouFirst" />
            </div>
            <span className="af-pl-panel-note">
              {routable.length} across {leagueCount} {leagueCount === 1 ? 'league' : 'leagues'}
            </span>
          </header>

          <ul className="af-pl-rows">
            {routable.map((i) => (
              <li key={i.id}>
                <Link className="af-pl-row" href={hrefFor(i)}>
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
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <h2 className="af-label">Needs you first</h2>
            <TopicTip topic="needsYouFirst" />
          </div>
          {/*
            "Nothing needs you" and "we could not work out what needs you" are
            different facts and must not share a rendering. This branch is only
            the first: the queue ran and came back empty.
          */}
          <p className="af-pl-quiet">
            {queueClearText ??
              'Nothing in your leagues is waiting on a decision right now. Pick one below to look around anyway.'}
          </p>
        </section>
      ) : null}

      <section className="af-pl-panel" aria-labelledby="af-pl-leagues">
        <header className="af-pl-panel-head">
          <h2 className="af-label" id="af-pl-leagues">
            {showQueue ? 'Or pick a league' : 'Pick a league'}
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
                prefetch={false}
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
                  <span className="af-platform af-platform-chip af-pl-league-plat" data-platform={l.platform}>
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
