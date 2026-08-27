import Link from 'next/link'
import type {
  LeagueStandingsResult,
  RankTrendPoint,
  SeasonHistoryRow,
  StandingRow,
} from '@/lib/core-app/leagueStandings'
import '@/components/core-app/af-standings.css'

/**
 * Screen 38a·7 — Standings, this league's points-for board.
 *
 * ⚠ NOT THE AF RANK LADDER. `/core/rankings` is the cross-app XP ladder and
 * measures something else entirely; two tabs called "Rankings" would have meant
 * one of them was lying about what it showed. Same league, different metric,
 * different name.
 *
 * ⚠ THE UNAVAILABLE BRANCH IS THE POINT OF THIS SCREEN, NOT ITS EDGE CASE. The
 * Sleeper sync writes a whole season of 0-0 rows before anybody plays, so the
 * default state of a freshly synced league is twelve teams on zero. Ranking
 * them would produce an arbitrary order presented as a result, which is why the
 * loader refuses and this renders the reason instead of a table.
 */

export type StandingsProps = {
  data: LeagueStandingsResult
}

function n1(v: number): string {
  return v.toFixed(1)
}


/**
 * Completed seasons, as the import recorded them.
 *
 * ⚠ SEPARATE FROM THE BOARD ABOVE, NOT AN EXTENSION OF IT. The live board is computed
 * week by week — averages, movement, a projection. These rows are season totals a
 * provider reported at the time; there are no weeks behind them to recompute, and
 * presenting them in the same table would imply a precision they do not carry.
 *
 * Grouped by season, newest first, because "how did we finish" is asked one season at
 * a time.
 */
function SeasonHistory({ rows }: { rows: SeasonHistoryRow[] }) {
  if (rows.length === 0) return null

  const bySeason = new Map<number, SeasonHistoryRow[]>()
  for (const row of rows) {
    const bucket = bySeason.get(row.season)
    if (bucket) bucket.push(row)
    else bySeason.set(row.season, [row])
  }
  const seasons = [...bySeason.entries()].sort((a, b) => b[0] - a[0])

  return (
    <section className="af-st-history">
      <h2 className="af-label af-st-history-title">Past seasons</h2>
      <p className="af-st-history-note">
        Imported final standings. {seasons.length}{' '}
        {seasons.length === 1 ? 'season' : 'seasons'} on file.
      </p>
      {seasons.map(([season, teams]) => (
        <div key={season} className="af-st-history-season">
          <h3 className="af-st-history-season-title af-num">{season}</h3>
          <div className="af-st-history-scroll">
            <table className="af-st-history-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Team</th>
                  <th scope="col">Record</th>
                  <th scope="col">PF</th>
                  <th scope="col">PA</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={`${season}:${t.teamKey}`} data-you={t.isYou ? 'true' : undefined}>
                    {/* A provider that did not report a finish gets an em dash, not a
                        fabricated position. */}
                    <td className="af-num">{t.rank ?? '—'}</td>
                    <td>{t.name ?? t.teamKey}</td>
                    <td className="af-num">
                      {t.wins}-{t.losses}
                      {t.ties > 0 ? `-${t.ties}` : ''}
                    </td>
                    <td className="af-num">{Math.round(t.pointsFor)}</td>
                    <td className="af-num">{Math.round(t.pointsAgainst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  )
}

export function Standings({ data }: StandingsProps) {
  if (!data.available) {
    return (
      <div className="af-st">
        <header className="af-st-head">
          <p className="af-label af-st-eyebrow">{data.leagueName}</p>
          <h1 className="af-display af-st-title">Standings</h1>
        </header>
        <div className="af-st-blocked">
          <span className="af-st-blocked-mark af-num" aria-hidden>
            —
          </span>
          <p className="af-st-blocked-body">{data.reason}</p>
        </div>
        {/* The live board cannot be drawn, but the imported seasons still can. */}
        <SeasonHistory rows={data.history} />
      </div>
    )
  }

  const { league, season, week, seasonComplete, teams, you, trend, recent, projection, history } = data

  return (
    <div className="af-st">
      <header className="af-st-head">
        <p className="af-label af-st-eyebrow">{league.name}</p>
        <h1 className="af-display af-st-title">Standings</h1>
        <p className="af-st-sub">
          Ranked by points scored, not by record — the measure of how you have actually played
          rather than who you drew. {season} ·{' '}
          {seasonComplete ? `season complete after week ${week}` : `through week ${week}`}.
        </p>
      </header>

      {you ? (
        <div className="af-st-tiles">
          <div className="af-st-tile">
            <span className="af-st-tile-v af-num">{ordinal(you.rank)}</span>
            <span className="af-label">Your rank</span>
            <span className="af-st-tile-s">
              of {teams.length} by points for
              {/*
                Null movement is the first scored week — there is no prior rank
                to compare against, which is a different fact from "no change".
              */}
              {you.movement != null && you.movement !== 0 ? (
                <span className="af-st-move" data-dir={you.movement > 0 ? 'up' : 'down'}>
                  {' '}
                  {you.movement > 0 ? '▲' : '▼'}
                  {Math.abs(you.movement)}
                </span>
              ) : null}
            </span>
          </div>

          <div className="af-st-tile">
            <span className="af-st-tile-v af-num">{n1(you.pointsFor)}</span>
            <span className="af-label">Points for</span>
            <span className="af-st-tile-s">
              over {you.weeksPlayed} scored {you.weeksPlayed === 1 ? 'week' : 'weeks'}
            </span>
          </div>

          <div className="af-st-tile">
            <span className="af-st-tile-v af-num">{you.average != null ? n1(you.average) : '—'}</span>
            <span className="af-label">Per week</span>
            <span className="af-st-tile-s">{describeVsLeague(you, teams)}</span>
          </div>

          <div className="af-st-tile">
            <span className="af-st-tile-v af-num">
              {you.wins}—{you.losses}
            </span>
            <span className="af-label">Record</span>
            <span className="af-st-tile-s">{describeLuck(you, teams)}</span>
          </div>
        </div>
      ) : (
        <div className="af-st-noteam">
          We cannot tell which team in this league is yours, so the tiles above it would be about
          nobody. The full board is still below.
        </div>
      )}

      {/* ── Projection ──────────────────────────────────────────────── */}
      <section className="af-st-projection" data-missing={!projection.available}>
        <h2 className="af-label">Projected final points</h2>
        {projection.available ? (
          <>
            <p className="af-st-proj-v">
              <span className="af-num">{Math.round(projection.data.mid).toLocaleString()}</span>
              <span className="af-st-proj-range af-num">
                {Math.round(projection.data.low).toLocaleString()} –{' '}
                {Math.round(projection.data.high).toLocaleString()}
              </span>
            </p>
            <p className="af-st-proj-basis">{projection.data.basis}</p>
          </>
        ) : (
          <p className="af-st-proj-why">{projection.reason}</p>
        )}
      </section>

      <div className="af-st-split">
        {/* ── Rank trend ────────────────────────────────────────────── */}
        <section className="af-st-panel">
          <h2 className="af-label">Rank by week</h2>
          {trend.length > 1 ? (
            <RankTrend trend={trend} teamCount={teams.length} />
          ) : (
            <p className="af-st-panel-why">
              A trend needs at least two scored weeks. There{' '}
              {trend.length === 1 ? 'is one' : 'are none'} on file so far.
            </p>
          )}
        </section>

        {/* ── Recent weeks ──────────────────────────────────────────── */}
        <section className="af-st-panel">
          <h2 className="af-label">Your recent weeks</h2>
          {recent.length > 0 ? (
            <ul className="af-st-recent">
              {recent.map((r) => (
                <li key={r.week}>
                  <span className="af-st-recent-w af-label">Wk {r.week}</span>
                  <span className="af-st-recent-p af-num">{n1(r.pointsFor)}</span>
                  {/*
                    Against your own average to that point, so the sign means
                    "better than your normal" rather than "better than last
                    week" — one big week should not make the next read as a slump.
                  */}
                  <span
                    className="af-st-recent-d af-num"
                    data-dir={r.delta == null ? 'none' : r.delta >= 0 ? 'up' : 'down'}
                  >
                    {r.delta == null ? '—' : `${r.delta >= 0 ? '+' : '−'}${n1(Math.abs(r.delta))}`}
                  </span>
                  <span className="af-st-recent-r af-num">{ordinal(r.rank)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="af-st-panel-why">
              None of your weeks have been scored yet in this league.
            </p>
          )}
        </section>
      </div>

      {/* ── Board ───────────────────────────────────────────────────── */}
      <section className="af-st-tablewrap">
        <table className="af-st-table">
          <caption className="af-st-caption">
            Every team in {league.name}, by points scored. Record is shown alongside so a team
            scoring well and losing anyway is visible rather than buried.
          </caption>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col" className="af-st-n">
                Points for
              </th>
              <th scope="col" className="af-st-n">
                Per week
              </th>
              <th scope="col" className="af-st-n">
                Record
              </th>
              <th scope="col" className="af-st-n">
                Move
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.rosterId} data-you={t.isYou}>
                <th scope="row">
                  <span className="af-st-rank af-num">{t.rank}</span>
                  <span className="af-st-name">{t.name ?? 'Unnamed team'}</span>
                  {t.isYou ? <span className="af-st-you af-label">You</span> : null}
                </th>
                <td className="af-st-n af-num">{n1(t.pointsFor)}</td>
                <td className="af-st-n af-num">{t.average != null ? n1(t.average) : '—'}</td>
                <td className="af-st-n af-num">
                  {t.wins}—{t.losses}
                </td>
                <td className="af-st-n">
                  <span
                    className="af-st-move"
                    data-dir={t.movement == null ? 'none' : t.movement > 0 ? 'up' : t.movement < 0 ? 'down' : 'flat'}
                  >
                    {t.movement == null
                      ? '—'
                      : t.movement === 0
                        ? '–'
                        : `${t.movement > 0 ? '▲' : '▼'}${Math.abs(t.movement)}`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="af-st-foot">
        Points-for rank is not the playoff picture — seeding runs on record first.{' '}
        <Link href={`/core/season-outlook?league=${encodeURIComponent(league.id)}`}>
          Season Outlook
        </Link>{' '}
        has the odds.
      </p>
      <SeasonHistory rows={history} />
    </div>
  )
}

/**
 * The rank trend, drawn as inline SVG.
 *
 * ⚠ RANK IS INVERTED ON PURPOSE. 1st is the best rank and the highest point on
 * the chart, so the y-axis runs from `teamCount` at the bottom to 1 at the top.
 * Plotting rank directly would draw a team climbing the table as a line going
 * down, which reads as exactly the opposite of what happened.
 */
function RankTrend({ trend, teamCount }: { trend: RankTrendPoint[]; teamCount: number }) {
  const W = 300
  const H = 96
  const padX = 6
  const padY = 8
  const span = Math.max(1, trend.length - 1)
  const worst = Math.max(teamCount, ...trend.map((p) => p.rank))

  const x = (i: number) => padX + (i / span) * (W - padX * 2)
  const y = (rank: number) =>
    padY + ((rank - 1) / Math.max(1, worst - 1)) * (H - padY * 2)

  const line = trend.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' ')
  const area = `${line} L${x(trend.length - 1).toFixed(1)},${H - padY} L${x(0).toFixed(1)},${H - padY} Z`
  const last = trend[trend.length - 1]

  return (
    <figure className="af-st-trend">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="af-st-trend-svg"
        role="img"
        aria-label={`Rank by week: ${trend.map((p) => `week ${p.week} ${ordinal(p.rank)}`).join(', ')}`}
      >
        <path d={area} className="af-st-trend-area" />
        <path d={line} className="af-st-trend-line" />
        {/* The endpoint is emphasised — where you are now is the thing being read. */}
        <circle cx={x(trend.length - 1)} cy={y(last.rank)} r="3.5" className="af-st-trend-dot" />
      </svg>
      <figcaption className="af-st-trend-cap">
        <span>Wk {trend[0].week}</span>
        <span>
          best {ordinal(Math.min(...trend.map((p) => p.rank)))} · now {ordinal(last.rank)}
        </span>
        <span>Wk {last.week}</span>
      </figcaption>
    </figure>
  )
}

function describeVsLeague(you: StandingRow, teams: StandingRow[]): string {
  const withAvg = teams.filter((t) => t.average != null)
  if (you.average == null || withAvg.length === 0) return 'no scored weeks yet'
  const leagueAvg = withAvg.reduce((a, t) => a + (t.average ?? 0), 0) / withAvg.length
  const diff = you.average - leagueAvg
  if (Math.abs(diff) < 0.05) return 'level with the league average'
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} vs league average`
}

/**
 * Points rank against record rank — the "have you been unlucky" line.
 *
 * Only stated when the two genuinely disagree. A team ranked 3rd on points and
 * 3rd on record has no story here, and inventing one for every row would make
 * the real cases invisible.
 */
function describeLuck(you: StandingRow, teams: StandingRow[]): string {
  const byRecord = [...teams].sort(
    (a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor,
  )
  const recordRank = byRecord.findIndex((t) => t.rosterId === you.rosterId) + 1
  if (recordRank === 0) return `${ordinal(you.rank)} on points`
  const gap = recordRank - you.rank
  if (gap >= 2) return `${ordinal(recordRank)} on record — scoring better than it shows`
  if (gap <= -2) return `${ordinal(recordRank)} on record — winning more than you score`
  return `${ordinal(recordRank)} on record`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export default Standings
