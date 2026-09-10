import Link from 'next/link'

import '@/components/core-app/af-scout.css'
import type { ScoutData, ScoutedManager } from '@/lib/core-app/scout'

/**
 * Scout — the first room of the War Room.
 *
 * Every manager in the league read through the psychological-profile engine,
 * with the one you play this week pinned to the top.
 *
 * ── 🛑 WHAT THIS SCREEN REFUSES TO DO ───────────────────────────────────────
 *
 * ❌ IT DOES NOT RENDER A NULL SCORE AS A ZERO. `psychology-os` gates every
 *    score behind an evidence floor and returns null for a dimension that does
 *    not clear it. A zero on a bar reads as a measured certainty that the
 *    manager is passive; null means "we cannot say", and the bar says so in
 *    words instead of drawing a stub.
 *
 * ❌ IT DOES NOT HIDE THE DENOMINATOR. The coverage line is rendered before the
 *    managers, always, because "3 of 12 managers profiled" changes how you read
 *    every card under it — and a reader who sees the cards first has already
 *    formed the belief the caveat corrects. Same rule Draft HQ applies to its
 *    grade caveat.
 *
 * ❌ IT DOES NOT SAY "NO TENDENCIES" FOR A MANAGER WE NEVER LOOKED AT. An
 *    unprofiled manager and a profiled-but-unremarkable one get different copy;
 *    the loader keeps them as different states for exactly this reason.
 */

export type ScoutProps = {
  data: ScoutData
  /**
   * The War Room's other room, on the same screen key behind `?view=plan`.
   *
   * Passed in rather than built here: the league query param belongs to the
   * router, and a screen that assembles its own sibling's href is a screen that
   * can silently disagree with it.
   */
  gamePlanHref: string
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-sc-unavailable">{reason}</p>
}

/**
 * The five gated dimensions, in the order the engine names them.
 *
 * ⚠ `key` IS TYPED AGAINST THE SCORES OBJECT, NOT LOOSELY. A cast here would let
 * a misspelled dimension compile and render a permanent em dash that reads as
 * "not enough evidence" — our typo presented as a fact about a manager.
 */
function ManagerCard({ m }: { m: ScoutedManager }) {
  return (
    <li>
      <article
        className="af-card af-sc-card"
        data-opponent={m.isNextOpponent || undefined}
        data-you={m.isYou || undefined}
      >
        <header className="af-sc-card-head">
          {m.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="af-sc-face" src={m.avatarUrl} alt="" width={36} height={36} loading="lazy" />
          ) : (
            <span className="af-sc-face af-sc-face--none" aria-hidden>
              {m.teamName.charAt(0).toUpperCase()}
            </span>
          )}

          <span className="af-sc-who">
            <span className="af-sc-team">{m.teamName}</span>
            <span className="af-sc-owner">
              {m.ownerName ?? 'Manager not named'}
              {m.record ? (
                <span className="af-num">
                  {' · '}
                  {m.record.wins}-{m.record.losses}
                  {m.record.ties > 0 ? `-${m.record.ties}` : ''}
                </span>
              ) : null}
            </span>
          </span>

          {m.isNextOpponent ? (
            <span className="af-sc-tag" data-sev="bad">
              THIS WEEK
            </span>
          ) : m.isYou ? (
            <span className="af-sc-tag" data-sev="info">
              YOU
            </span>
          ) : null}
        </header>

        {m.profile.available ? (
          <p className="af-sc-unavailable">Open a league decision for Competitive Edge guidance.</p>
        ) : m.profile.locked ? (
          /*
           * ⚠ LOCKED IS NOT EMPTY, AND IT SAYS SO. The profile exists and we say
           * how much was observed — the same split `redactForLock` makes on the
           * API. Rendering a paywall as "no data yet" would tell a manager their
           * league is unprofiled when it is fully profiled.
           */
          <div className="af-sc-locked">
            <p className="af-sc-locked-reason">{m.profile.reason}</p>
            <p className="af-sc-evidence af-num">
              {m.profile.evidenceCount} observation
              {m.profile.evidenceCount === 1 ? '' : 's'} on file
            </p>
          </div>
        ) : (
          <Unavailable reason={m.profile.reason} />
        )}
      </article>
    </li>
  )
}

export function Scout({ data, gamePlanHref }: ScoutProps) {
  const { coverage } = data
  const complete = coverage.profiledCount === coverage.teamCount && coverage.teamCount > 0

  return (
    <div className="af-sc">
      <header className="af-frame af-sc-head">
        <div className="af-sc-head-text">
          <h1 className="af-display af-sc-title">Scout · {data.league.name}</h1>
          <p className="af-sc-blurb">
            How every manager in this league actually plays, read from seasons of their trades,
            waiver claims and drafts.
            {data.week ? ` Week ${data.week.week} of ${data.week.seasonYear}.` : ''}
          </p>
        </div>
        {/*
          The War Room's other room. Scout is about WHO you are playing; Game
          Plan is about what you must do before kickoff — different questions,
          so they are two rooms rather than one crowded screen.
        */}
        <Link className="af-sc-switch" href={gamePlanHref}>
          Game plan &rarr;
        </Link>
      </header>

      {/*
        ⚠ BEFORE THE CARDS, ALWAYS. See the header note — a denominator read
        after the evidence is a caveat that arrives too late to do its job.
      */}
      <p className="af-sc-coverage" data-complete={complete || undefined}>
        <span className="af-num">
          {coverage.profiledCount} of {coverage.teamCount}
        </span>{' '}
        {coverage.teamCount === 1 ? 'manager' : 'managers'} profiled
        {coverage.lastRefreshedAt
          ? ` · last updated ${new Date(coverage.lastRefreshedAt).toLocaleDateString()}`
          : ''}
        {coverage.profiledCount === 0
          ? ' — the profiler runs on a schedule and has not reached this league yet.'
          : complete
            ? '.'
            : ' — the rest have not been profiled yet, so this is a partial read of the room.'}
        {/*
          ⚠ SAID SEPARATELY FROM THE GAP. A withheld profile is not missing data, and
          folding the two together would report the profiler as incomplete on a league
          it has fully covered.

          🛑 AND THIS LINE USED TO SAY "locked on your plan — your own profile is always
          free." BOTH HALVES BECAME FALSE when the characterisation was withheld from
          every viewer: it is not a plan boundary any more, and your own profile is not
          free any more. A privacy change that leaves the old sentence standing tells the
          reader the opposite of what the code now does — and nothing type-checks copy,
          so this is the kind of defect only reading the rendered words catches.
        */}
        {coverage.lockedCount > 0 ? (
          <>
            {' '}
            <span className="af-num">{coverage.lockedCount}</span>{' '}
            {coverage.lockedCount === 1 ? 'has a profile' : 'have profiles'} on file, held
            internally — Competitive Edge uses them on a decision rather than showing the read.
          </>
        ) : null}
      </p>

      {data.managers.available ? (
        <ul className="af-sc-list">
          {data.managers.data.map((m) => (
            <ManagerCard key={m.managerId} m={m} />
          ))}
        </ul>
      ) : (
        <section className="af-frame af-sc-section">
          <Unavailable reason={data.managers.reason} />
        </section>
      )}
    </div>
  )
}

export default Scout
