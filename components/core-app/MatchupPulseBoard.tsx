import Link from 'next/link'

import type { MatchupPulse, PulseRow } from '@/lib/core-app/matchupPulse'
import '@/components/core-app/af-matchup-pulse.css'

/**
 * "Where you stand" — the cross-league matchup pulse.
 *
 * Sits above the existing "Needs you first" queue and league picker on
 * `/core/matchup`, which the handoff leaves unchanged.
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
  const { noSchedule, noOpponent, unpriceable, uncomparable } = pulse.notRanked
  const parts: string[] = []
  if (noSchedule > 0) parts.push(`${noSchedule} carry no schedule`)
  if (noOpponent > 0) parts.push(`${noOpponent} have no game this week`)
  if (unpriceable > 0) parts.push(`${unpriceable} could not be scored or priced`)
  if (uncomparable > 0) {
    parts.push(`${uncomparable} have lineups we cannot compare like for like`)
  }
  if (parts.length === 0) return null
  return `Not ranked: ${parts.join(', ')}.`
}

export function MatchupPulseBoard({ pulse }: MatchupPulseBoardProps) {
  const note = basisNote(pulse)
  const gap = gapNote(pulse)

  return (
    <section className="af-mp" aria-labelledby="af-mp-head">
      <header className="af-mp-head">
        <h2 className="af-label" id="af-mp-head">
          Where you stand
        </h2>
        <span className="af-mp-rule" aria-hidden />
        <span className="af-mp-count">
          {pulse.leading.length} leading · {pulse.trailing.length} trailing
        </span>
      </header>

      {note ? <p className="af-mp-basis">{note}</p> : null}

      {pulse.ranked > 0 ? (
        /*
          ⚠ ONE SIDE IS ROUTINELY EMPTY AND TWO EQUAL COLUMNS THEN LEAVE A HOLE.
          "You are not behind in any league right now" is a single sentence
          sitting beside up to five rows, and on a wide screen that reads as a
          panel that failed to load rather than as good news. The same shape,
          and the same fix, as the my-team board in MyTeamBoard.tsx — collapse to
          one column and run the surviving list two-up, so the rows keep the
          width the handoff draws them at instead of stretching across the board.
        */
        <div
          className="af-mp-cols"
          data-one={pulse.leading.length === 0 || pulse.trailing.length === 0 || undefined}
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
            ? `None of your ${pulse.considered} leagues has a head-to-head we can rank this week.`
            : 'No claimed team yet, so there is no head-to-head to stand in.'}
        </p>
      )}

      {gap ? <p className="af-mp-gap">{gap}</p> : null}
    </section>
  )
}

export default MatchupPulseBoard
