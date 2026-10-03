'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { GameDayTriage, TriageLeague, TriageRow } from '@/lib/core-app/gameDayTriage'
import { lockState } from '@/lib/core-app/lineupLock'
import { lineupLink, platformLabel } from '@/lib/core-app/platformLinks'
import { playerRef } from '@/lib/core-app/playerRef'
import { RefreshLineups } from '@/components/core-app/player-finder/RefreshLineups'
import '@/components/core-app/af-game-plan.css'

/**
 * Game Plan — the War Room's second room.
 *
 * "Game plan for the week": every decision you still have to make before a
 * kickoff takes it out of your hands, across every league at once, ordered by
 * the deadline rather than by league.
 *
 * ── 🛑 THIS IS NOT `/core/week`, AND THE DIFFERENCE IS THE WHOLE POINT ───────
 *
 * `/core/week` is the SCOREBOARD — every matchup ranked by how close it is,
 * with win probability. It answers "which of my games matter this week". This
 * screen answers "what do I have to DO, and by when", which is a different
 * question with a different sort order: deadline, not drama.
 *
 * The last War Room was retired for duplicating Draft HQ. If these two screens
 * ever start answering the same question, one of them is redundant — the sort
 * order below is what keeps them apart.
 *
 * ── WHERE THE DATA COMES FROM, AND WHAT IT COSTS ────────────────────────────
 *
 * `loadGameDayTriage`, unchanged. It already reads starters, the injury feed
 * and the week's kickoffs on the finder's own bounded joins, dedupes a player
 * across every league he starts in, and sorts soonest-lock-first. This screen
 * adds no query.
 *
 * 🛑 IT DOES NOT AND MUST NOT CALL `computeLineupActionsForUser`. That engine is
 * far too expensive to run from a page render, which is why the triage loader
 * exists and says so in its own header.
 *
 * ── ⚠ WHAT THIS SCREEN DELIBERATELY DOES NOT CLAIM ─────────────────────────
 *
 * It flags a starter who is hurt or has no game. It does NOT rank a replacement
 * itself: My Team's bench swaps are the one start/sit answer (owner's ruling,
 * 2026-09-29), priced with this week's projections under each league's scoring.
 * A second ranking here would be a second answer that can disagree with the
 * first, so each row LINKS to My Team for it, and the footer says so.
 */

export type GamePlanProps = {
  data: GameDayTriage
  /** Server-rendered instant, so the first paint agrees with the loader's sort. */
  nowIso: string
  weekHref: string
  waiversHref: string
  /**
   * False when this is EMBEDDED under another screen's heading.
   *
   * ⚠ IT EXISTS TO STOP A SECOND `<h1>`, NOT TO SAVE VERTICAL SPACE. The War
   * Room's no-league state renders `PickALeague`, which already emits
   * `<h1>War Room</h1>`; dropping this screen in underneath it with its own
   * `<h1>Game plan</h1>` gives the document two top-level headings, and a
   * screen-reader user navigating by heading lands on a page that claims to be
   * two pages. The blurb moves up into the host's own blurb instead.
   *
   * ⚠ THE COVERAGE LINE IS NOT PART OF THE HEAD AND NEVER HIDES. "Nothing needs
   * you" and "we read nothing" render almost identically and mean opposite
   * things — that count is the only thing separating them, and an embedded copy
   * needs it more than a standalone one, not less.
   */
  showHead?: boolean
  /**
   * 'league' when this is ONE league's plan, inline on Scout (War Room step 4c). Words that only make
   * sense across leagues — "any of your leagues", a leagues-affected tile — change or drop out.
   */
  scope?: 'all' | 'league'
}

/** Live countdown to a kickoff, re-derived each minute. */
function Lock({ kickoff, nowIso }: { kickoff: string; nowIso: string }) {
  /*
   * ⚠ SEEDED FROM THE SERVER'S INSTANT, NOT `Date.now()`. Seeding from the
   * client would let the first paint disagree with the order the loader sorted
   * in — a row rendered "locked" above one rendered "locks in 5 min".
   */
  const [now, setNow] = useState(nowIso)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 30_000)
    return () => clearInterval(t)
  }, [])

  const s = lockState(kickoff, now)
  return (
    <span className="af-gp-lock af-num" data-state={s.state}>
      {s.label}
    </span>
  )
}

/**
 * One league chip, opening the screen where that league's lineup is CHANGED.
 *
 * 🛑 THIS WENT TO `/core/my-team`, WHICH CANNOT CHANGE A LINEUP. My Team reads one and
 * nothing under /core writes a roster (platformLinks.lineupLink says so in as many words),
 * so a flagged starter's only call to action landed on a page where the fix was impossible.
 * `lineupLink` is the Player Finder's own destination for this exact list: the provider's
 * lineup screen, or a native league's in-app team tab.
 */
function LeagueLineupLink({ league }: { league: TriageLeague }) {
  const link = lineupLink({
    id: league.leagueId,
    platform: league.platform,
    platformLeagueId: league.platformLeagueId ?? null,
    season: league.season ?? null,
    name: league.leagueName,
    teamId: league.teamId ?? null,
  })
  const body = (
    <>
      <span className="af-gp-league-name">{league.leagueName}</span>
      <span className="af-gp-plat" data-platform={league.platform ?? undefined}>
        {platformLabel(league.platform).toUpperCase()}
        {link?.external ? ' ↗' : ''}
      </span>
    </>
  )
  if (!link) return <span className="af-gp-league">{body}</span>
  const lands = link.screen === 'Lineup' ? 'lineup' : link.screen.toLowerCase()
  return link.external ? (
    <a
      className="af-gp-league"
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${league.leagueName} — open the ${lands} on ${link.platformLabel}`}
    >
      {body}
    </a>
  ) : (
    <Link className="af-gp-league" href={link.href} aria-label={`${league.leagueName} — open the ${lands}`}>
      {body}
    </Link>
  )
}

/**
 * The week in one line: how much there is to fix, across how many leagues, and when the first of it
 * locks — what a manager wants before reading a single row.
 *
 * ⚠ COUNTED FROM THE ROWS BELOW, NEVER FROM A SEPARATE READ, so the strip and the list cannot
 * disagree. Locked rows are left out of "to fix": nothing can move them now.
 *
 * ⚠ AND IT SAYS WHAT IT DID NOT READ. Best-ball leagues, leagues on a platform we cannot translate,
 * and the age of the oldest lineup were all returned by the loader and printed nowhere — so an
 * all-zero strip could not be told apart from "we skipped your leagues".
 */
function Summary({
  data,
  actionable,
  nowIso,
  oneLeague = false,
}: {
  data: GameDayTriage
  actionable: TriageRow[]
  nowIso: string
  /** League scope: a "leagues affected" tile can only read 0 or 1 there, so it is left out. */
  oneLeague?: boolean
}) {
  const empty = data.emptySlots ?? []
  const emptyCount = empty.reduce((n, l) => n + l.count, 0)
  const leagues = new Set([...actionable.flatMap((r) => r.leagues.map((l) => l.leagueId)), ...empty.map((l) => l.leagueId)])
  const firstKickoff = actionable
    .map((r) => r.kickoff)
    .filter((k): k is string => Boolean(k))
    .sort()[0]
  const skipped = [
    data.bestBallLeagues ? `${data.bestBallLeagues} best-ball ${data.bestBallLeagues === 1 ? 'league' : 'leagues'} skipped — the platform sets those lineups` : null,
    data.unsupportedLeagues ? `${data.unsupportedLeagues} on a platform we can’t read yet` : null,
    data.leaguesNotRead ? `${data.leaguesNotRead} not read — more than this list checks at once` : null,
  ].filter(Boolean)
  const asOfMs = data.rostersAsOf ? new Date(data.rostersAsOf).getTime() : NaN

  return (
    <section className="af-gp-summary" aria-label="This week at a glance">
      <dl className="af-gp-stats">
        <div data-tone={actionable.length > 0 ? 'warn' : undefined}>
          <dt>Flagged starters</dt>
          <dd className="af-num">{actionable.length}</dd>
        </div>
        <div data-tone={emptyCount > 0 ? 'bad' : undefined}>
          <dt>Empty slots</dt>
          <dd className="af-num">{emptyCount}</dd>
        </div>
        {oneLeague ? null : (
          <div>
            <dt>Leagues affected</dt>
            <dd className="af-num">{leagues.size}</dd>
          </div>
        )}
        <div>
          <dt>First lock</dt>
          <dd>{firstKickoff ? <Lock kickoff={firstKickoff} nowIso={nowIso} /> : <span className="af-gp-lock">—</span>}</dd>
        </div>
      </dl>
      {/*
        The Player Finder's own control: the OLDEST lineup's time, and a button that refreshes every
        claimed league through the collector and reloads. A lineup fixed on Sleeper a minute ago stops
        being flagged here — before, the only way was to wait for the next sync.
      */}
      <RefreshLineups asOf={data.rostersAsOf ?? null} nowIso={nowIso} />
      {!Number.isFinite(asOfMs) || skipped.length > 0 ? (
        <p className="af-gp-summary-note">
          {!Number.isFinite(asOfMs) ? 'No lineup sync time on file.' : ''}
          {skipped.length > 0 ? `${!Number.isFinite(asOfMs) ? ' ' : ''}${skipped.join(' · ')}.` : ''}
        </p>
      ) : null}
    </section>
  )
}

function Row({ row, nowIso }: { row: TriageRow; nowIso: string }) {
  const locked = row.kickoff ? lockState(row.kickoff, nowIso).state === 'locked' : false

  return (
    <li>
      <article className="af-gp-row" data-tone={row.status?.tone ?? 'none'} data-locked={locked || undefined}>
        {row.player.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-gp-face" src={row.player.imageUrl} alt="" width={34} height={34} loading="lazy" />
        ) : (
          <span className="af-gp-face af-gp-face--none" aria-hidden>
            {row.player.name.charAt(0).toUpperCase()}
          </span>
        )}

        <span className="af-gp-who">
          {/* His card: injury detail, depth chart, who starts him — the Player Finder's own link. */}
          <Link
            className="af-gp-name"
            href={`/core/players?q=${encodeURIComponent(row.player.name)}&player=${encodeURIComponent(playerRef(row.player.sport, row.player.externalId))}`}
          >
            {row.player.name}
          </Link>
          <span className="af-gp-meta">
            {[row.player.position, row.player.team].filter(Boolean).join(' · ') || 'club unknown'}
          </span>
        </span>

        <span className="af-gp-state">
          {row.status ? (
            <span className="af-gp-chip" data-tone={row.status.tone}>
              {row.status.label}
            </span>
          ) : null}
          {/*
            ⚠ "BYE" AND "NO GAME ON THE SCHEDULE" ARE DIFFERENT CLAIMS. The loader
            only sets `bye` when the week's slate actually has the shape of a bye
            week; a plain gap in what we hold is reported as a gap. Saying "bye"
            for an unresolved club would be inventing a fact about the NFL
            schedule out of a hole in our own data.
          */}
          {row.bye ? (
            <span className="af-gp-chip" data-tone="warn">
              ON BYE
            </span>
          ) : row.noGame ? (
            <span className="af-gp-chip" data-tone="warn">
              NO GAME ON THE SCHEDULE
            </span>
          ) : null}
        </span>

        <span className="af-gp-when">
          {row.kickoff ? (
            <Lock kickoff={row.kickoff} nowIso={nowIso} />
          ) : (
            <span className="af-gp-lock af-num" data-state="none">
              no kickoff on file
            </span>
          )}
        </span>

        {/*
          Which leagues this one decision touches. The loader dedupes a player
          across leagues on purpose: he is ONE decision you make several times,
          not several problems.
        */}
        <span className="af-gp-leagues">
          {row.leagues.map((l) => (
            <LeagueLineupLink key={l.leagueId} league={l} />
          ))}
          {/*
            WHO TO START INSTEAD lives on My Team — the owner's 2026-09-29 ruling made its bench swaps
            the one start/sit answer, so this links there rather than ranking a replacement here. One
            league opens that league's My Team; several open My Team's every-lineup view. A locked row
            gets no link: nothing of his can move now.
          */}
          {locked ? null : (
            <Link
              className="af-gp-swap"
              href={
                row.leagues.length === 1
                  ? `/core/my-team?league=${encodeURIComponent(row.leagues[0]!.leagueId)}`
                  : '/core/my-team'
              }
            >
              Who to start instead &rarr;
            </Link>
          )}
        </span>

        {row.description ? <p className="af-gp-note">{row.description}</p> : null}
      </article>
    </li>
  )
}

export function GamePlan({
  data,
  nowIso,
  weekHref,
  waiversHref,
  showHead = true,
  scope = 'all',
}: GamePlanProps) {
  const oneLeague = scope === 'league'
  const rows = data.rows
  const emptySlots = data.emptySlots ?? []
  const actionable = rows.filter((r) => !r.kickoff || lockState(r.kickoff, nowIso).state !== 'locked')
  const locked = rows.length - actionable.length

  return (
    <div className="af-gp" data-embedded={showHead ? undefined : 'true'}>
      {showHead ? (
        <header className="af-frame af-gp-head">
          <h1 className="af-display af-gp-title">Game plan</h1>
          <p className="af-gp-blurb">
            Every starter across your leagues who is hurt or has no game this week, soonest deadline
            first.
            {data.week ? ` Week ${data.week.week} of ${data.week.season}.` : ''}
          </p>
        </header>
      ) : (
        /*
         * Embedded: an `<h2>`, so the host's `<h1>` stays the page's only top
         * heading and this section is still reachable by heading navigation —
         * which an unlabelled `<div>` would not be.
         */
        <h2 className="af-label af-gp-embedhead">
          {oneLeague
            ? 'Your lineup in this league · what to fix before it locks'
            : 'Flagged starters in active manual lineups · soonest deadline first'}
          {data.week ? ` · week ${data.week.week}` : ''}
        </h2>
      )}

      {/*
        ⚠ THE DENOMINATOR BEFORE THE LIST, as on Scout. "Nothing needs you" and
        "we read nothing" render almost identically and mean opposite things, so
        the count of what was actually inspected is stated either way.
      */}
      {data.startersRead > 0 || emptySlots.length > 0 ? <Summary data={data} actionable={actionable} nowIso={nowIso} oneLeague={oneLeague} /> : null}

      <p className="af-gp-coverage">
        <span className="af-num">{data.startersRead}</span> starters checked across{' '}
        <span className="af-num">{data.leaguesRead}</span>{' '}
        {data.leaguesRead === 1 ? 'league' : 'leagues'}
        {locked > 0 ? (
          <>
            {' · '}
            <span className="af-num">{locked}</span> already locked and shown at the end
          </>
        ) : null}
        .
      </p>

      {/*
        Empty slots first: a hole in a lineup is a certain zero, where a Questionable tag
        is only a risk. One row per league — there is no player to name, only a slot to fill.
      */}
      {emptySlots.length > 0 ? (
        <ul className="af-gp-list" aria-label="Lineups with an empty starting slot">
          {emptySlots.map((l) => (
            <li key={`empty:${l.leagueId}`}>
              <article className="af-gp-row" data-tone="bad">
                <span className="af-gp-face af-gp-face--none" aria-hidden>
                  –
                </span>
                <span className="af-gp-who">
                  <span className="af-gp-name">
                    {l.count} empty starting {l.count === 1 ? 'slot' : 'slots'}
                  </span>
                  <span className="af-gp-meta">an empty slot scores zero</span>
                </span>
                <span className="af-gp-state">
                  <span className="af-gp-chip" data-tone="bad">
                    EMPTY
                  </span>
                </span>
                <span className="af-gp-when">
                  <span className="af-gp-lock af-num" data-state="none">
                    fill before your league locks
                  </span>
                </span>
                <span className="af-gp-leagues">
                  <LeagueLineupLink league={l} />
                </span>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 ? (
        <ul className="af-gp-list">
          {rows.map((r) => (
            /* Sport in the key: a Sleeper id can exist in two sports, and the list now holds both. */
            <Row key={`${r.player.sport}:${r.player.sleeperId}`} row={r} nowIso={nowIso} />
          ))}
        </ul>
      ) : emptySlots.length > 0 ? null : (
        <section className="af-frame af-gp-empty">
          <p className="af-gp-clear">
            {data.startersRead > 0
              ? oneLeague
                ? 'No starter in this lineup is flagged this week.'
                : 'No starter in any of your leagues is flagged this week.'
              : 'No starting lineups could be read, so nothing here has been checked.'}
          </p>
        </section>
      )}

      <footer className="af-gp-foot">
        {/*
          Stated, not left to be discovered — see the header note on why no
          replacement is ranked.
        */}
        {/*
          🛑 THIS SAID "the projection tables hold a single week — so a suggested swap here would be
          invented". This week IS the week held, and My Team already ranks the bench against it; the
          sentence explained an absence that a link now fills. Say where the answer is instead.
        */}
        <p className="af-gp-limits">
          This flags who is at risk. Who to start instead is My Team&apos;s call — it ranks your bench
          with this week&apos;s projections under each league&apos;s scoring. Lineups change on the
          platform; the league buttons open it.
        </p>
        <div className="af-gp-links">
          <Link className="af-gp-cta" href={weekHref}>
            Your week · every matchup &rarr;
          </Link>
          <Link className="af-gp-cta" href={waiversHref}>
            Waivers &rarr;
          </Link>
        </div>
      </footer>
    </div>
  )
}

export default GamePlan
