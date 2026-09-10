import Link from 'next/link'

import '@/components/core-app/af-scout.css'
import type { ScoutData, ScoutProfile, ScoutedManager } from '@/lib/core-app/scout'

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
const DIMENSION_KEYS: Array<{ key: keyof ScoutProfile['scores']; label: string; hint: string }> = [
  { key: 'aggressionScore', label: 'Aggression', hint: 'how hard they push on a move' },
  { key: 'activityScore', label: 'Activity', hint: 'how often they touch the roster' },
  { key: 'tradeFrequencyScore', label: 'Trades', hint: 'how much they deal' },
  { key: 'waiverFocusScore', label: 'Waivers', hint: 'how much they work the wire' },
  { key: 'riskToleranceScore', label: 'Risk', hint: 'how much variance they accept' },
]

function Meter({ label, hint, value }: { label: string; hint: string; value: number | null }) {
  /*
   * ⚠ NULL IS A WORD, NOT A ZERO-WIDTH BAR. See the header. The track still
   * renders so the rows stay aligned, but nothing is filled and the reading says
   * why.
   */
  const pct = value == null ? null : Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="af-sc-meter" data-unmeasured={value == null}>
      <span className="af-label af-sc-meter-label">{label}</span>
      <span className="af-sc-meter-track" role="img" aria-label={`${label}: ${pct == null ? 'not enough evidence' : `${pct} of 100`}`}>
        {pct != null ? <span className="af-sc-meter-fill" style={{ width: `${pct}%` }} /> : null}
      </span>
      <span className="af-sc-meter-value af-num">{pct != null ? pct : '—'}</span>
      <span className="af-sc-meter-hint">{pct != null ? hint : 'not enough evidence yet'}</span>
    </div>
  )
}

function ProfileBody({ profile }: { profile: ScoutProfile }) {
  /* How many of the five meters actually carry a number — see the note below. */
  const measured = DIMENSION_KEYS.filter((d) => profile.scores[d.key] != null).length

  return (
    <>
      {profile.labels.length > 0 ? (
        <ul className="af-sc-labels">
          {profile.labels.map((l) => (
            <li key={l} className="af-chip af-sc-label">
              {l}
            </li>
          ))}
        </ul>
      ) : (
        /*
         * ⚠ AN EMPTY LABEL SET IS A REAL ANSWER, and the engine's own comment
         * says so: "Empty is a real answer: observed, and nothing clears the
         * bar." It is not the same as being unprofiled, which the card above
         * this never reaches.
         */
        <p className="af-sc-none">
          Observed, but nothing about how they play clears the bar to name yet.
        </p>
      )}

      <div className="af-sc-meters">
        {DIMENSION_KEYS.map((d) => (
          <Meter key={d.key} label={d.label} hint={d.hint} value={profile.scores[d.key]} />
        ))}
      </div>

      {/* Trajectory, or its honest refusal — never invented. */}
      <p className="af-sc-traj" data-has={profile.trajectory.hasTrajectory}>
        {profile.trajectory.summary}
      </p>

      {/*
        🛑 TWO DIFFERENT VOCABULARIES, AND COUNTING ONE AGAINST THE OTHER IS A
        UNITS ERROR THIS LINE SHIPPED ONCE.

        `unmeasuredDimensions` names EVIDENCE dimensions — trade, draft, roster:
        three of them, the kinds of behaviour we observe. The meters above are
        SCORE dimensions — aggression, activity, trades, waivers, risk: five of
        them, the readings derived from that evidence. They are not the same axis
        and there is no "N of 5" to be had from the first list. Rendered against a
        real profile, "3 of 5 reads below the evidence floor" sat directly beneath
        five meters that all read "—", which is how it was caught.

        ⚠ SO THE COUNT IS DERIVED FROM THE SCORES THE READER CAN SEE, not from a
        summary about something else. Read the effect, not the source.
      */}
      <p className="af-sc-evidence af-num">
        {profile.evidenceCount} observation{profile.evidenceCount === 1 ? '' : 's'}
        {' · '}
        {measured === 0
          ? 'no read clears the evidence floor yet'
          : measured === DIMENSION_KEYS.length
            ? 'all five reads measured'
            : `${measured} of ${DIMENSION_KEYS.length} reads measured`}
        {/* Named, because the engine names them so an answer can say WHICH is missing. */}
        {profile.unmeasuredDimensions.length > 0
          ? ` · nothing observed yet from ${profile.unmeasuredDimensions.join(', ')}`
          : ''}
      </p>
    </>
  )
}

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
          <ProfileBody profile={m.profile.data} />
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
          ⚠ SAID SEPARATELY FROM THE GAP. A locked profile is a plan boundary, not
          missing data, and folding the two together would report the profiler as
          incomplete on a league it has fully covered.
        */}
        {coverage.lockedCount > 0 ? (
          <>
            {' '}
            <span className="af-num">{coverage.lockedCount}</span>{' '}
            {coverage.lockedCount === 1 ? 'is' : 'are'} locked on your plan — your own profile is
            always free.
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
