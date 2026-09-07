import Link from 'next/link'

import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { MatchupPulse, PulseRow } from '@/lib/core-app/matchupPulse'
import { MatchupPulseRefresh } from '@/components/core-app/MatchupPulseRefresh'
import {
  BoardHead,
  FooterSummary,
  SectionHead,
  columnsTooUneven,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-matchup-pulse.css'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/matchup` with no league held — "where you stand" across every league.
 *
 * 2026-09-07 handoff (`AF Core Matchup.dc.html`). The leading-top-5 /
 * trailing-bottom-5 structure was already right and is kept verbatim; what
 * changed is that this IS the screen now rather than a panel above one. The
 * league-picker grid moved behind the footer's "View all N", and the
 * "Needs you first" queue survives as a short section under the board — the
 * design keeps it here, unlike on My Team, because a league whose data cannot
 * be read has no margin to rank and would otherwise vanish from this screen
 * entirely.
 *
 * ⚠ EVERY ROW STATES WHAT ITS NUMBER IS. The design shows one green number and
 * one red one, which is right the moment games are being played. Before kickoff
 * there are no points to compare — see the header note in `matchupPulse.ts` —
 * so a projected row is tagged `PROJ` and the section head says how the board is
 * measured. A projected margin rendered identically to a live one is
 * indistinguishable from a score, which is the one mistake this screen cannot
 * make.
 */

export type MatchupPulseBoardProps = {
  pulse: MatchupPulse
  /**
   * Leagues on the account, for the footer's denominator.
   *
   * ⚠ NOT `pulse.considered`, WHICH COUNTS CLAIMED TEAMS. A manager can hold 65
   * leagues and have claimed a team in four of them; "View all 4" from a board
   * that is the only route to the picker strands the other 61.
   */
  totalLeagues: number
  /**
   * The outstanding-issues queue, rendered as "Needs you first".
   *
   * ⚠ ONLY ROWS THAT NAME A LEAGUE. An issue we cannot route is noise on a
   * screen whose every row is a destination — same filter `PickALeague` applies.
   */
  issues?: CoreIssue[]
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
}

/** The crest, or the initials that are the genuine fallback for a missing one. */
function Crest({ row }: { row: PulseRow }) {
  return row.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-mp-crest"
      src={row.logoUrl}
      alt=""
      width={22}
      height={22}
      loading="lazy"
    />
  ) : (
    <span className="af-mp-crest af-mp-crest--none" data-platform={row.platform} aria-hidden>
      {row.leagueBadge}
    </span>
  )
}

function Face({ row }: { row: PulseRow }) {
  return row.opponentAvatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-mp-face"
      src={row.opponentAvatarUrl}
      alt=""
      width={30}
      height={30}
      loading="lazy"
    />
  ) : (
    <span className="af-mp-face af-mp-face--none" data-platform={row.platform} aria-hidden>
      {row.opponentInitials}
    </span>
  )
}

/**
 * "vs Gridiron Ghosts · 6 left to play".
 *
 * Each clause is dropped rather than faked when its source is absent: an
 * unnamed opposing roster stays unnamed, and a lineup we could not place
 * against a fixture list carries no count at all.
 */
function metaOf(row: PulseRow): string {
  const parts: string[] = [row.opponentName ? `vs ${row.opponentName}` : 'opponent not named']
  if (row.startersLeft != null) {
    parts.push(`${row.startersLeft} left to play`)
  }
  /*
   * No coverage clause: the loader refuses to RANK a projected row unless both
   * lineups are the same size and fully priced, so a row that reaches here is
   * already like-for-like. Leagues that are not are counted in `notRanked`.
   */
  return parts.join(' · ')
}

function Row({ row, tone }: { row: PulseRow; tone: 'good' | 'bad' }) {
  const abs = Math.abs(row.margin).toFixed(1)
  return (
    <li>
      <Link className="af-mp-row" href={row.href}>
        <Face row={row} />
        <Crest row={row} />
        <span className="af-mp-text">
          <span className="af-mp-league">{row.leagueName}</span>
          <span className="af-mp-meta">{metaOf(row)}</span>
        </span>
        {/*
          The tag is on the ROW, not only in the section head. A mixed board is
          the normal state mid-season — some leagues playing Thursday, others
          not until Sunday — and a header note cannot tell you which of the ten
          rows in front of you is a projection.
        */}
        {row.basis === 'projected' ? <span className="af-mp-tag">PROJ</span> : null}
        <span className="af-mp-diff af-num" data-tone={tone}>
          {tone === 'good' ? '+' : '−'}
          {abs}
        </span>
      </Link>
    </li>
  )
}

/** One sentence naming what the whole board is measured in. */
function basisNote(pulse: MatchupPulse): string | null {
  if (pulse.basis === 'projected') {
    return 'Nothing has been scored yet, so every margin here is a projection priced under each league’s own scoring rules — not a live score.'
  }
  if (pulse.basis === 'mixed') {
    return 'Rows tagged PROJ have not kicked off — their margin is projected under that league’s own scoring rules. The rest are live points.'
  }
  return null
}

/** "we could not rank six of them, and here is why" — never a silent short list. */
function gapNote(pulse: MatchupPulse): string | null {
  const { noSchedule, noOpponent, unpriceable, uncomparable, unidentifiedRoster } = pulse.notRanked
  const parts: string[] = []
  if (noSchedule > 0) parts.push(`${noSchedule} carry no schedule`)
  if (noOpponent > 0) parts.push(`${noOpponent} have no game this week`)
  if (unpriceable > 0) parts.push(`${unpriceable} could not be scored or priced`)
  if (uncomparable > 0) {
    parts.push(`${uncomparable} have lineups we cannot compare like for like`)
  }
  /*
   * 🛑 THE ONE THAT IS OUR FAULT, AND IT IS SAID DIFFERENTLY FOR THAT REASON.
   * The others describe the league's state; this one describes a roster id this
   * loader cannot use — an ESPN SWID or a Fantrax slug where it needs Sleeper's
   * numeric roster_id. Wording it like the rest would blame the league for our
   * gap. See `notRanked.unidentifiedRoster`.
   */
  if (unidentifiedRoster > 0) {
    parts.push(
      `${unidentifiedRoster} carry a roster id we cannot match to a schedule — our gap, not theirs`,
    )
  }
  if (parts.length === 0) return null
  return `Not ranked: ${parts.join(', ')}.`
}

/**
 * Can anything on this board still move?
 *
 * ⚠ `basis === 'scored'` ALONE IS NOT THE TEST, because a finished week is
 * scored too. A row is in play only if points exist AND starters remain, which
 * is what stops the fast cadence running all week on a board whose games ended
 * on Monday night.
 *
 * ⚠ AND `startersLeft: null` COUNTS AS IN PLAY. Null means we could not place
 * that lineup against a fixture list — a non-NFL league, or a week the schedule
 * does not reach — so it is unknown, not zero. Treating an unknown as "nothing
 * left" would freeze the board for exactly the leagues whose data we are worst
 * at, which is the wrong way round.
 */
function anyInPlay(pulse: MatchupPulse): boolean {
  return [...pulse.leading, ...pulse.trailing].some(
    (r) => r.basis === 'scored' && (r.startersLeft == null || r.startersLeft > 0),
  )
}

const ISSUE_RANK: Record<string, number> = { bad: 0, warn: 1, info: 2 }

export function MatchupPulseBoard({
  pulse,
  issues,
  allHref,
  totalLeagues,
}: MatchupPulseBoardProps) {
  const note = basisNote(pulse)
  const gap = gapNote(pulse)
  const inPlay = anyInPlay(pulse)

  const routable = (issues ?? [])
    .filter((i) => i.leagueId != null)
    .sort((a, b) => (ISSUE_RANK[a.severity] ?? 9) - (ISSUE_RANK[b.severity] ?? 9))
    .slice(0, 5)

  const shown = pulse.leading.length + pulse.trailing.length
  const hidden = Math.max(0, totalLeagues - shown)

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · Matchup"
        title="Matchup"
        blurb="Every league with a head-to-head this week, ranked by margin. Open one for the full box score."
      />

      <section className="af-mp" aria-labelledby="af-mp-head">
        <header className="af-mp-head">
          <h2 className="af-label" id="af-mp-head">
            Where you stand
          </h2>
          <span className="af-mp-rule" aria-hidden />
          <span className="af-mp-count">
            {pulse.leading.length} leading · {pulse.trailing.length} trailing
          </span>
          {/*
            Only when there is something to keep current. On a board with nothing
            ranked, a "live" indicator would be claiming to watch a thing that is
            not there.
          */}
          {pulse.ranked > 0 ? <MatchupPulseRefresh inPlay={inPlay} /> : null}
        </header>

        {note ? <p className="af-mp-basis">{note}</p> : null}

        {pulse.ranked > 0 ? (
          /*
            ⚠ THE TWO COLUMNS ARE ROUTINELY UNEQUAL AND THAT LEAVES A HOLE. Being
            ahead in one league and behind in five is an ordinary week, and the
            short column then reads as a panel that failed to load rather than as
            a short list. `columnsTooUneven` lives in BoardKit so every
            two-column board applies the same threshold.
          */
          <div
            className="af-mp-cols"
            data-stack={columnsTooUneven(pulse.leading.length, pulse.trailing.length) || undefined}
          >
            <div className="af-mp-col">
              <h3 className="af-label af-mp-col-head" data-tone="good">
                Leading · top 5
              </h3>
              {pulse.leading.length > 0 ? (
                <ul className="af-mp-rows">
                  {pulse.leading.map((r) => (
                    <Row key={r.leagueId} row={r} tone="good" />
                  ))}
                </ul>
              ) : (
                <p className="af-mp-quiet">You are not ahead in any league right now.</p>
              )}
            </div>

            <div className="af-mp-col">
              <h3 className="af-label af-mp-col-head" data-tone="bad">
                Trailing · bottom 5
              </h3>
              {pulse.trailing.length > 0 ? (
                <ul className="af-mp-rows">
                  {pulse.trailing.map((r) => (
                    <Row key={r.leagueId} row={r} tone="bad" />
                  ))}
                </ul>
              ) : (
                <p className="af-mp-quiet">You are not behind in any league right now.</p>
              )}
            </div>
          </div>
        ) : (
          /*
            ⚠ "NOTHING TO RANK" AND "NOTHING IS HAPPENING" ARE DIFFERENT FACTS.
            A user with sixty leagues in the offseason and a user with none must
            not read the same sentence, so the count is stated either way.
          */
          <p className="af-mp-quiet">
            {pulse.considered > 0
              ? `None of your ${pulse.considered} claimed ${pulse.considered === 1 ? 'team' : 'teams'} has a head-to-head we can rank this week — the line below says why.`
              : 'No claimed team yet, so there is no head-to-head to stand in.'}
          </p>
        )}

        {gap ? <p className="af-mp-gap">{gap}</p> : null}
      </section>

      {/*
        The stale-data queue. A league we cannot read carries no margin, so it is
        absent from the board above — this is where it says so, rather than
        being silently missing from a screen that claims to cover every league.
      */}
      {routable.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-mp-needs">
          <SectionHead
            id="af-mp-needs"
            label="Needs you first"
            count={`${routable.length} across ${new Set(routable.map((i) => i.leagueId)).size} leagues`}
          />
          <ul className="af-bd-rows">
            {routable.map((i) => (
              <li key={i.id}>
                <Link
                  className="af-bd-row"
                  href={`/core/matchup?league=${encodeURIComponent(i.leagueId as string)}`}
                >
                  <span className="af-bd-rank" aria-hidden>
                    {i.glyph}
                  </span>
                  <span className="af-bd-league af-bd-league--wide">
                    <span className="af-bd-name">{i.title}</span>
                    <span className="af-bd-sub">{i.meta}</span>
                  </span>
                  <span className="af-bd-mid" />
                  <span className="af-bd-cta">{i.leagueName ?? 'Open'} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FooterSummary
        hidden={hidden}
        total={totalLeagues}
        href={allHref}
        quiet="have no game this week or could not be scored."
      />
    </div>
  )
}

export default MatchupPulseBoard
