import Link from 'next/link'
import type {
  CareerSeasonLine,
  CareerTradeMoment,
  CareerTradeStory,
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

  const { league, seasons, totals, firstSeason, lastSeason, toughestRival, tradeGrade, waiverGrade, tradeStory } =
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

      {tradeStory.available ? <TradeStory story={tradeStory.data} /> : (
        <section className="af-lc-panel">
          <h2 className="af-label">Your trading journey</h2>
          <p className="af-lc-panel-why">{tradeStory.reason}</p>
        </section>
      )}

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

function TradeStory({ story }: { story: CareerTradeStory }) {
  return (
    <section className="af-lc-trade-story" aria-labelledby="trade-story-title">
      <header className="af-lc-story-head">
        <div>
          <p className="af-label">League market history</p>
          <h2 id="trade-story-title">Your trading journey</h2>
        </div>
        <div className="af-lc-story-total" data-tone={story.finalValue >= 0 ? 'good' : 'bad'}>
          <strong className="af-num">{signed(story.finalValue)}</strong>
          <span>realised value</span>
        </div>
      </header>

      <JourneyChart story={story} />

      <div className="af-lc-moments">
        <TradeMoment title="Best trade" moment={story.best} tone="good" />
        <TradeMoment title="Toughest trade" moment={story.worst} tone="bad" />
      </div>

      {story.awards.length ? (
        <div className="af-lc-awards">
          {story.awards.map((award) => (
            <article key={award.key} className="af-lc-award" data-kind={award.key}>
              <span className="af-lc-award-icon" aria-hidden>{awardIcon(award.key)}</span>
              <span className="af-label">{award.subtitle}</span>
              <h3>{award.title}</h3>
              <strong>{award.winner}</strong>
              <span className="af-num">{award.countLabel}</span>
            </article>
          ))}
        </div>
      ) : null}

      <details className="af-lc-trade-list">
        <summary>All completed trades <span className="af-num">{story.trades.length}</span></summary>
        <div>
          {story.trades.map((trade) => (
            <div className="af-lc-trade-row" key={trade.id}>
              <span className="af-lc-trade-grade" data-band={bandOf(trade.currentGrade)}>{trade.currentGrade}</span>
              <span><strong>with {trade.partner}</strong><small>{formatDate(trade.date)} · Week {trade.week}</small></span>
              <strong className="af-num" data-tone={trade.net >= 0 ? 'good' : 'bad'}>{signed(trade.net)}</strong>
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}

function JourneyChart({ story }: { story: CareerTradeStory }) {
  const values = [0, ...story.journey.map((point) => point.value)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const points = story.journey.map((point, index) => {
    const x = story.journey.length === 1 ? 100 : (index / (story.journey.length - 1)) * 100
    const y = 88 - ((point.value - min) / range) * 72
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const zeroY = 88 - ((0 - min) / range) * 72
  return (
    <figure className="af-lc-journey">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Cumulative trade value ending at ${signed(story.finalValue)}`}>
        <line x1="0" x2="100" y1={zeroY} y2={zeroY} className="af-lc-zero" />
        {story.journey.length > 1 ? <polyline points={points} /> : <circle cx="50" cy={points.split(',')[1]} r="2" />}
      </svg>
      <figcaption><span>{formatDate(story.journey[0].date)}</span><span>Value after every completed deal</span><span>{formatDate(story.journey[story.journey.length - 1].date)}</span></figcaption>
    </figure>
  )
}

function TradeMoment({ title, moment, tone }: { title: string; moment: CareerTradeMoment; tone: 'good' | 'bad' }) {
  return (
    <article className="af-lc-moment" data-tone={tone}>
      <span className="af-label">{title} · with hindsight</span>
      <strong className="af-lc-moment-value af-num">{signed(moment.net)}</strong>
      <span className="af-lc-moment-meta">vs {moment.partner} · {formatDate(moment.date)}</span>
      <div className="af-lc-assets">
        <p><span>Received</span>{moment.received.length ? moment.received.slice(0, 4).join(' · ') : 'No assets listed'}</p>
        <p><span>Sent</span>{moment.sent.length ? moment.sent.slice(0, 4).join(' · ') : 'No assets listed'}</p>
      </div>
      <span className="af-lc-grade-change">Grade {moment.initialGrade} → {moment.currentGrade}</span>
    </article>
  )
}

function signed(value: number): string {
  const rounded = Math.round(value).toLocaleString('en-US')
  return value > 0 ? `+${rounded}` : value < 0 ? `−${Math.abs(Math.round(value)).toLocaleString('en-US')}` : '0'
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : value
}

function awardIcon(key: CareerTradeStory['awards'][number]['key']): string {
  if (key === 'partners') return '↔'
  if (key === 'active') return '⚡'
  if (key === 'quiet') return '◒'
  return '∅'
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
