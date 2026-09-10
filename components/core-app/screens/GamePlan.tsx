'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'
import { lockState } from '@/lib/core-app/lineupLock'
import { platformLabel } from '@/lib/core-app/platformLinks'
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
 * It flags a starter who is hurt or has no game. It does NOT rank a replacement,
 * because ranking one needs a projection for the week and BOTH projection tables
 * hold a single week — a bench recommendation would be invented, and invented
 * advice at kickoff minus twenty is the worst possible place to guess. The
 * footer says so rather than leaving the absence to be discovered.
 */

export type GamePlanProps = {
  data: GameDayTriage
  /** Server-rendered instant, so the first paint agrees with the loader's sort. */
  nowIso: string
  weekHref: string
  waiversHref: string
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
          <span className="af-gp-name">{row.player.name}</span>
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
            <Link
              key={l.leagueId}
              className="af-gp-league"
              href={`/core/my-team?league=${encodeURIComponent(l.leagueId)}`}
            >
              <span className="af-gp-league-name">{l.leagueName}</span>
              <span className="af-gp-plat" data-platform={l.platform ?? undefined}>
                {platformLabel(l.platform).toUpperCase()}
              </span>
            </Link>
          ))}
        </span>

        {row.description ? <p className="af-gp-note">{row.description}</p> : null}
      </article>
    </li>
  )
}

export function GamePlan({ data, nowIso, weekHref, waiversHref }: GamePlanProps) {
  const rows = data.rows
  const actionable = rows.filter((r) => !r.kickoff || lockState(r.kickoff, nowIso).state !== 'locked')
  const locked = rows.length - actionable.length

  return (
    <div className="af-gp">
      <header className="af-frame af-gp-head">
        <h1 className="af-display af-gp-title">Game plan</h1>
        <p className="af-gp-blurb">
          Every starter across your leagues who is hurt or has no game this week, soonest deadline
          first.
          {data.week ? ` Week ${data.week.week} of ${data.week.season}.` : ''}
        </p>
      </header>

      {/*
        ⚠ THE DENOMINATOR BEFORE THE LIST, as on Scout. "Nothing needs you" and
        "we read nothing" render almost identically and mean opposite things, so
        the count of what was actually inspected is stated either way.
      */}
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

      {rows.length > 0 ? (
        <ul className="af-gp-list">
          {rows.map((r) => (
            <Row key={r.player.sleeperId} row={r} nowIso={nowIso} />
          ))}
        </ul>
      ) : (
        <section className="af-frame af-gp-empty">
          <p className="af-gp-clear">
            {data.startersRead > 0
              ? 'No starter in any of your leagues is flagged this week.'
              : 'No starting lineups could be read, so nothing here has been checked.'}
          </p>
        </section>
      )}

      <footer className="af-gp-foot">
        {/*
          Stated, not left to be discovered — see the header note on why no
          replacement is ranked.
        */}
        <p className="af-gp-limits">
          This flags who is at risk; it does not pick a replacement. Ranking one needs a projection
          for the week ahead, and the projection tables hold a single week — so a suggested swap
          here would be invented rather than measured.
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
