import Link from 'next/link'
import type {
  CareerSeasonLine,
  LeagueCareerResult,
  LeagueGrade,
} from '@/lib/core-app/leagueCareer'
import type { SectionState } from '@/lib/core-app/leagueHome'
import '@/components/core-app/af-league-career.css'

/**
 * Screen 38a·6 — your career inside ONE league.
 *
 * ⚠ THE CROSS-LEAGUE TROPHY ROOM AT `/core/career` IS NOT REPLACED. That screen
 * is every league you have ever played; this is one league across every season
 * of it. Same nav key, different question.
 *
 * ⚠ NEITHER GRADE EVER RENDERS AS A BARE LETTER. `GRADE_THRESHOLDS` spans C
 * from −40 to +40, so a manager with no history at all lands mid-C — "C" and
 * "we have nothing" are visually identical unless the absence is handled
 * separately. Every grade card here either shows a letter WITH the sample it
 * came from, or shows the reason there isn't one.
 */

export type LeagueCareerProps = {
  data: LeagueCareerResult
  /** The cross-league trophy room, which this does not replace. */
  allLeaguesHref: string
}

export function LeagueCareer({ data, allLeaguesHref }: LeagueCareerProps) {
  if (!data.available) {
    return (
      <div className="af-lc">
        <header className="af-lc-head">
          <p className="af-label af-lc-eyebrow">{data.leagueName}</p>
          <h1 className="af-display af-lc-title">Your career here</h1>
        </header>
        <div className="af-lc-blocked">
          <span className="af-lc-blocked-mark af-num" aria-hidden>
            —
          </span>
          <div>
            <p className="af-lc-blocked-body">{data.reason}</p>
            <p className="af-lc-blocked-alt">
              <Link href={allLeaguesHref}>Your career across every league →</Link>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { league, seasons, totals, firstSeason, lastSeason, toughestRival, tradeGrade, waiverGrade } =
    data

  const best = seasons.reduce<CareerSeasonLine | null>(
    (acc, s) => (acc == null || winRate(s) > winRate(acc) ? s : acc),
    null,
  )

  return (
    <div className="af-lc">
      <header className="af-lc-head">
        <p className="af-label af-lc-eyebrow">{league.name}</p>
        <h1 className="af-display af-lc-title">Your career here</h1>
        <p className="af-lc-sub">
          Every season you have played in this league, since {firstSeason}.{' '}
          <Link href={allLeaguesHref}>Across every league →</Link>
        </p>
      </header>

      {/* ── Identity banner ─────────────────────────────────────────── */}
      <div className="af-lc-banner">
        <div className="af-lc-stat">
          <span className="af-lc-stat-v af-num">{seasons.length}</span>
          <span className="af-label">{seasons.length === 1 ? 'Season' : 'Seasons'}</span>
          <span className="af-lc-stat-s af-num">
            {firstSeason}–{lastSeason}
          </span>
        </div>
        <div className="af-lc-stat">
          <span className="af-lc-stat-v af-num">
            {totals.wins}—{totals.losses}
          </span>
          <span className="af-label">All-time record</span>
          <span className="af-lc-stat-s">{totals.games} completed games</span>
        </div>
        <div className="af-lc-stat">
          <span className="af-lc-stat-v af-num">
            {totals.winPct != null ? `${(totals.winPct * 100).toFixed(1)}%` : '—'}
          </span>
          <span className="af-label">Win rate</span>
          <span className="af-lc-stat-s">{describeWinRate(totals.winPct)}</span>
        </div>
        <div className="af-lc-stat">
          <span className="af-lc-stat-v af-num">{Math.round(totals.pointsFor).toLocaleString()}</span>
          <span className="af-label">Points scored</span>
          <span className="af-lc-stat-s af-num">
            {totals.games > 0 ? `${(totals.pointsFor / totals.games).toFixed(1)} per game` : '—'}
          </span>
        </div>
      </div>

      {/*
        ⚠ NO TITLE COUNT ON THIS SCREEN, DELIBERATELY. Championships are not in
        the table this is built from — `dw_matchup_facts` stores fixtures and
        scores, and ADR F2.10 is explicit that playoff classification is never
        derived because `isPlayoff` is not stored and inferring it from week
        numbers would fabricate a fact. A trophy count is exactly the number
        someone would repeat out loud, so it is absent rather than guessed.
      */}
      <p className="af-lc-note">
        Titles and playoff runs are not shown here: this league&apos;s stored history records
        fixtures and scores, not which weeks were playoffs, and guessing that from week numbers
        would invent the one number people quote.
      </p>

      {/* ── Grades ──────────────────────────────────────────────────── */}
      <div className="af-lc-grades">
        <GradeCard
          title="Career trade grade"
          state={tradeGrade}
          blurb="Graded on realised value per season — what each side of your trades actually went on to do."
        />
        <GradeCard
          title="Career waiver grade"
          state={waiverGrade}
          blurb="Claim value against this league's own median winning bid, on the same bands as the trade grade."
        />
      </div>

      {/* ── Season by season ────────────────────────────────────────── */}
      <section className="af-lc-panel">
        <header className="af-lc-panel-head">
          <h2 className="af-label">Season by season</h2>
          <span className="af-lc-panel-note">Bar height is win rate</span>
        </header>

        <div className="af-lc-bars">
          {seasons.map((s) => {
            const rate = winRate(s)
            return (
              <div className="af-lc-bar" key={s.season}>
                <div className="af-lc-bar-track">
                  <div
                    className="af-lc-bar-fill"
                    data-best={best != null && s.season === best.season && seasons.length > 1}
                    style={{ height: `${Math.max(4, rate * 100)}%` }}
                  />
                </div>
                <span className="af-lc-bar-year af-num">{String(s.season).slice(-2)}</span>
                <span className="af-lc-bar-rec af-num">
                  {s.wins}–{s.losses}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Rival ───────────────────────────────────────────────────── */}
      <section className="af-lc-panel">
        <h2 className="af-label">Toughest rival</h2>
        {toughestRival ? (
          <div className="af-lc-rival">
            <span className="af-lc-rival-name">{toughestRival.name}</span>
            <span className="af-lc-rival-rec af-num">
              {toughestRival.wins}—{toughestRival.losses}
            </span>
            <p className="af-lc-rival-note">
              {toughestRival.meetings} {toughestRival.meetings === 1 ? 'meeting' : 'meetings'}, and
              they have beaten you {toughestRival.losses}{' '}
              {toughestRival.losses === 1 ? 'time' : 'times'} — more than anyone else in this
              league. Average margin {toughestRival.averageMargin >= 0 ? '+' : '−'}
              {Math.abs(toughestRival.averageMargin).toFixed(1)} to you.
            </p>
          </div>
        ) : (
          <p className="af-lc-panel-why">
            You have not played anyone in this league twice yet, so there is no rivalry to name — one
            result is a game, not a pattern.
          </p>
        )}
      </section>
    </div>
  )
}

/**
 * A grade card.
 *
 * The letter and its sample are one unit — there is no branch that renders the
 * letter without what produced it, because that is the exact shape that makes a
 * no-data "C" indistinguishable from a real one.
 */
function GradeCard({
  title,
  state,
  blurb,
}: {
  title: string
  state: SectionState<LeagueGrade>
  blurb: string
}) {
  if (!state.available) {
    return (
      <div className="af-lc-grade" data-missing="true">
        <span className="af-label">{title}</span>
        <span className="af-lc-grade-letter af-num">—</span>
        <p className="af-lc-grade-why">{state.reason}</p>
      </div>
    )
  }
  return (
    <div className="af-lc-grade" data-band={bandOf(state.data.letter)}>
      <span className="af-label">{title}</span>
      <span className="af-lc-grade-letter af-num">{state.data.letter}</span>
      <span className="af-lc-grade-sample">{state.data.sample}</span>
      <p className="af-lc-grade-why">{blurb}</p>
    </div>
  )
}

function bandOf(letter: string): 'good' | 'mid' | 'bad' {
  if (letter === 'A' || letter === 'B') return 'good'
  if (letter === 'C') return 'mid'
  return 'bad'
}

function winRate(s: CareerSeasonLine): number {
  return s.games > 0 ? s.wins / s.games : 0
}

function describeWinRate(pct: number | null): string {
  if (pct == null) return 'no completed games'
  if (pct >= 0.65) return 'well above .500'
  if (pct >= 0.55) return 'a winning record'
  if (pct >= 0.45) return 'about even'
  return 'below .500'
}

export default LeagueCareer
