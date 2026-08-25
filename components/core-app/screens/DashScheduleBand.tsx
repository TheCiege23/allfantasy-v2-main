import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-schedule.css'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import type { WeekBoard, WeekMatchup } from '@/lib/core-app/weekBoard'

/**
 * Who you play this week — the schedule half of the matchup question.
 *
 * ⚠ WHY THIS EXISTS. Dashboard3A's "This week's matchups" answers "how am I
 * doing", and it can only answer it from SCORED rows: getWeekAll drops every
 * 0-0 row on purpose, and dash34 hardcodes `score: null` because no
 * production LeagueTeam row carries a result. So from now until the first
 * Sunday night of the season — and on any week before kickoff — that section
 * is an apology, on a screen whose whole job is telling you what needs you.
 *
 * The pairing is already ingested and already read: getWeekBoard pairs on
 * `matchupId` alone and never consults points, so it names your opponent in
 * every league with a schedule while the scoreboard is still empty. This band
 * renders that, and only that.
 *
 * Render-nothing rules:
 *  - null board (the read failed) → nothing. Silence beats an error card on
 *    the one screen everyone lands on, and beats claiming you have no games.
 *  - zero matchups across every bucket → nothing. Dashboard3A already owns
 *    one empty frame for this question; two stacked would be worse than the
 *    one that is merely wrongly worded.
 *
 * Honesty rules — this band shows WHO and WHEN, never HOW MUCH:
 *  - No score, not even 0.0. weekAll.ts records the incident this rule comes
 *    from: unscored rows rendered as "L 0.00 — 0.00", every one landing in
 *    the loss column — two fabricated defeats.
 *  - No win probability, no projected margin, no record. getWeekBoard carries
 *    a projection on some cards, but it is fitted across seasons and its
 *    surfaces must print their sample size beside it; a band has no room for
 *    that caveat, so it does not borrow the number.
 *  - An unnamed roster renders as its roster id, never an invented manager.
 *  - The kickoff is a calendar DAY from a source that states a regular-season
 *    instant, not a ticking countdown: the page paints once on the server, so
 *    minute precision would just be precisely stale.
 *
 * A sibling component rather than an edit to Dashboard3A.tsx, which another
 * session owns — same reasoning as Dash3ATriage, Dash34Carryover and
 * DashDraftsBand.
 */

const VISIBLE_CAP = 6

function OpponentLabel({ matchup }: { matchup: WeekMatchup }) {
  /* Never invent a manager. An unnamed roster says which roster it is. */
  return <>{matchup.opponent.name ?? `Roster ${matchup.opponent.rosterId}`}</>
}

export function DashScheduleBand({
  board,
  syncLabel,
}: {
  board: WeekBoard | null
  /** "synced 4m ago" when fresh; null when stale or unknown — never guessed. */
  syncLabel: string | null
}) {
  if (!board) return null

  /*
   * All three buckets, not just `unprojected`. The projection tiers are
   * assigned by how much scoring history a roster has, which has nothing to
   * do with whether this week's game is scheduled — a roster with 2025 weeks
   * on file lands in `leaning` while its 2026 week 1 is just as unplayed.
   * Sorted by league name so the same league sits in the same place twice.
   */
  const matchups = [...board.coinFlips, ...board.leaning, ...board.unprojected].sort((a, b) =>
    a.leagueName.localeCompare(b.leagueName),
  )
  if (matchups.length === 0) return null

  const visible = matchups.slice(0, VISIBLE_CAP)
  const overflow = matchups.length - visible.length

  /*
   * Only a kickoff still in the future is worth stating — once the slate has
   * started, "kicks off Sep 4" is stale trivia rather than a plan.
   */
  const kickoff =
    board.firstKickoffAt && new Date(board.firstKickoffAt).getTime() > Date.now()
      ? kickoffDayLabel(board.firstKickoffAt)
      : null

  /*
   * ⚠ THE WEEK ONLY ADVANCES WHEN SOMETHING GETS SCORED. `board.week` is the
   * earliest week still carrying an unscored row — the right rule, and the one
   * that stops a bootstrapped season resolving to week 18 in August. But it
   * has a tail: if 2026 scoring never lands, week 1 stays the earliest
   * unscored week forever, and this band would still say "Week 1" in
   * December, presenting a long-finished week as the one ahead.
   *
   * So the label drops to the neutral form once its own kickoff is in the
   * past. "This week · who you play" is true whatever the ingestion is doing;
   * "Week 1" in December is not.
   */
  const weekLabel =
    board.week != null && kickoff != null ? `Week ${board.week}` : 'This week'

  return (
    <section className="af-core af-sched" aria-label="Who you play this week">
      <div className="af-sched-head">
        <span className="af-label af-sched-kicker">{weekLabel} · who you play</span>
        <span className="af-sched-when af-num">
          {[
            matchups.length === 1 ? '1 matchup' : `${matchups.length} matchups`,
            kickoff ? `first kickoff ${kickoff}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      <div className="af-sched-grid">
        {visible.map((m) => (
          <Link key={`${m.leagueId}:${m.week}`} className="af-sched-card" href={m.href}>
            <span className="af-sched-league">{m.leagueName}</span>
            <span className="af-sched-vs">
              vs <b><OpponentLabel matchup={m} /></b>
            </span>
            <span className="af-sched-plat af-num">
              {/*
                Guillotine and survivor leagues eliminate the lowest score each
                week — an existential stake a head-to-head card does not carry,
                and the one thing about this matchup that changes how you play
                it. The chip states the format; the chop-line distance needs
                scoring that does not exist yet, so it is not implied here.
              */}
              {m.elimination ? (
                <span className="af-sched-elim" title="Lowest score is eliminated this week">
                  ELIM
                </span>
              ) : null}
              {m.platform.toUpperCase()}
            </span>
          </Link>
        ))}
      </div>

      <p className="af-sched-foot af-num">
        {[
          overflow > 0 ? `+${overflow} more` : null,
          /*
           * Leagues whose schedule we hold nothing for — stated, not hidden,
           * so "6 matchups" on a 61-league account reads as coverage rather
           * than as a claim that the other 55 have no games.
           */
          board.withoutSchedule > 0
            ? `no schedule yet for your other ${board.withoutSchedule} ${
                board.withoutSchedule === 1 ? 'league' : 'leagues'
              }`
            : null,
          syncLabel,
        ]
          .filter(Boolean)
          .join(' · ')}
        {overflow > 0 || board.withoutSchedule > 0 ? (
          <>
            {' '}
            <Link className="af-sched-all" href="/core/week">
              Open your week
            </Link>
          </>
        ) : null}
      </p>
    </section>
  )
}
