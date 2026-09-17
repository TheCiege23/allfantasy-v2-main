import Link from 'next/link'
import type { LeagueStandingsResult, RankTrendPoint, SeasonHistoryRow } from '@/lib/core-app/leagueStandings'
import { formatRecord, type BoardTeam, type Zone } from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW, type StandingsViewState } from '@/lib/core-app/standingsView'
import { StandingsBoardView, Move } from '@/components/core-app/standings/StandingsBoardView'
import '@/components/core-app/af-standings.css'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import type { FreshnessMeta } from '@/lib/sports-os/freshness'

/**
 * Screen 38a·7 — Standings: the league table and AllFantasy's power ranking, side by side.
 *
 * 2026-09-17 brief (ten items): official and power views, the playoff line, tiebreak explanations,
 * weekly movement and a history chart, the points picture (PF, PA, expected wins, all-play), sticky
 * columns, divisions, labelled projections, stored weekly snapshots, and a card layout. The maths is in
 * `lib/core-app/standingsModel.ts`; the interactive half is `StandingsBoardView`.
 *
 * ⚠ NOT THE AF RANK LADDER. `/core/rankings` is the cross-app XP ladder and measures something else
 * entirely; "AF Power" here is a per-league analysis of THIS league's results and is labelled as such.
 *
 * ⚠ THE UNAVAILABLE BRANCH IS THE POINT OF THIS SCREEN, NOT ITS EDGE CASE. The Sleeper sync writes a
 * whole season of 0-0 rows before anybody plays, so the default state of a freshly synced league is
 * twelve teams on zero. Ranking them would produce an arbitrary order presented as a result, which is
 * why the loader refuses and this renders the reason instead of a table.
 */

/**
 * How old the board is, when it came from the summary cache.
 *
 * ⚠ OPTIONAL BECAUSE THE ROLLOUT MAKES IT OPTIONAL. `sports-os.screen-summaries` is at 10%, so most
 * readers still take the direct read, which has no envelope and nothing to label. `null` renders no
 * chip at all — never a chip reading "unknown", which would claim the data is of uncertain age when
 * it was in fact just computed.
 */
export type StandingsFreshness = {
  meta: FreshnessMeta
  /** Computed server-side; see the hydration note in FreshnessChip. */
  initialLabel: string
  initialWarn: boolean
}

export type StandingsProps = {
  data: LeagueStandingsResult
  freshness?: StandingsFreshness | null
  /** View, division and layout from the URL. */
  view?: StandingsViewState
}

function n1(v: number): string {
  return v.toFixed(1)
}

/** "1,412.6" — grouped, one decimal. The locale is fixed so server and client render the same string. */
function pts1(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

const ZONE_WORD: Record<Zone, string> = {
  bye: 'in a bye spot',
  playoff: 'in a playoff spot',
  bubble: 'on the bubble',
  out: 'outside the playoffs',
  eliminated: 'eliminated',
}

function zoneLine(t: BoardTeam): string {
  if (t.clinched === 'bye') return 'bye clinched'
  if (t.clinched === 'playoff') return 'playoff spot clinched'
  return ZONE_WORD[t.zone]
}

function lineText(t: BoardTeam): string {
  if (t.gamesBack == null) return 'no head-to-head games'
  if (t.gamesBack === 0) return 'on the playoff line'
  const abs = Math.abs(t.gamesBack)
  const games = `${Number.isInteger(abs) ? abs : abs.toFixed(1)} ${abs === 1 ? 'game' : 'games'}`
  return t.gamesBack < 0 ? `${games} clear of the line` : `${games} behind the line`
}

/**
 * Completed seasons, as the import recorded them.
 *
 * ⚠ SEPARATE FROM THE BOARD ABOVE, NOT AN EXTENSION OF IT. The live board is computed week by week —
 * these rows are season totals a provider reported at the time; there are no weeks behind them to
 * recompute, and presenting them in the same table would imply a precision they do not carry.
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
        Imported final standings. {seasons.length} {seasons.length === 1 ? 'season' : 'seasons'} on file.
      </p>
      {seasons.map(([season, teams]) => (
        <div key={season} className="af-st-history-season">
          <h3 className="af-st-history-season-title af-num">{season}</h3>
          <p className="af-st-scroll-cue">Scroll sideways to compare every column.</p>
          <div className="af-st-history-scroll" role="region" aria-label={`${season} final standings`} tabIndex={0}>
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
                    {/* A provider that did not report a finish gets an em dash, not a fabricated position. */}
                    <td className="af-num">{t.rank ?? '—'}</td>
                    <th scope="row">{t.name ?? t.teamKey}</th>
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

export function Standings({ data, freshness, view = DEFAULT_STANDINGS_VIEW }: StandingsProps) {
  /*
   * ⚠ THE REFUSAL BRANCH IS LABELLED TOO, AND THAT IS NOT DECORATION. An `available: false` board is
   * cached exactly like an available one, so "we could not read this league's results" can itself be
   * four minutes old. A reader who has just fixed the cause deserves to see that the refusal is stale.
   */
  const chip = freshness ? (
    <FreshnessChip meta={freshness.meta} initialLabel={freshness.initialLabel} initialWarn={freshness.initialWarn} />
  ) : null

  if (!data.available) {
    return (
      <div className="af-st">
        <header className="af-st-head">
          <p className="af-label af-st-eyebrow">{data.leagueName}</p>
          <h1 className="af-display af-st-title">Standings</h1>
          {chip}
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

  const { league, season, week, seasonComplete, trend, recent, projection, history, board } = data
  const me = board.teams.find((t) => t.isYou) ?? null
  const n = board.teams.length
  const P = board.rules.platformLabel

  return (
    <div className="af-st">
      <header className="af-st-head">
        <p className="af-label af-st-eyebrow">{league.name}</p>
        <h1 className="af-display af-st-title">Standings</h1>
        <p className="af-st-sub">
          {P === 'the platform' ? 'The league table' : `${P}’s table`}, and AllFantasy’s own power ranking beside it — record decides the
          seeding, all-play says who is actually good. {season} ·{' '}
          {seasonComplete ? `season complete after week ${week}` : `results through week ${board.throughWeek}`}.
        </p>
        {chip}
      </header>

      {me ? (
        <div className="af-st-tiles">
          <div className="af-st-tile">
            <span className="af-label">Table position</span>
            <span className="af-st-tile-row">
              <span className="af-st-tile-v af-num">{ordinal(me.seed)}</span>
              {/* Null movement is the first final week — no prior position, which is not "no change". */}
              {me.seedMove != null && me.seedMove !== 0 ? <Move value={me.seedMove} /> : null}
            </span>
            <span className="af-st-tile-s">
              of {n} · {zoneLine(me)}
            </span>
          </div>

          <div className="af-st-tile">
            <span className="af-label">Record</span>
            <span className="af-st-tile-v af-num">{board.hasHeadToHead ? formatRecord(me.record) : '—'}</span>
            <span className="af-st-tile-s">{lineText(me)}</span>
          </div>

          <div className="af-st-tile">
            <span className="af-label">AF Power</span>
            <span className="af-st-tile-row">
              <span className="af-st-tile-v af-num" data-tone="accent">
                {ordinal(me.powerRank)}
              </span>
              {me.powerMove != null && me.powerMove !== 0 ? <Move value={me.powerMove} /> : null}
            </span>
            <span className="af-st-tile-s af-num">
              score {me.powerScore.toFixed(1)} · all-play {formatRecord(me.allPlay)}
            </span>
          </div>

          <div className="af-st-tile">
            <span className="af-label">Points for</span>
            <span className="af-st-tile-v af-num">{pts1(me.pointsFor)}</span>
            <span className="af-st-tile-s">
              {me.average != null ? `${n1(me.average)} a week · ` : ''}
              {ordinal(me.pfRank)} in the league
            </span>
          </div>
        </div>
      ) : (
        <div className="af-st-noteam">
          We cannot tell which team in this league is yours, so there are no tiles about you. The full table is still below.
        </div>
      )}

      <StandingsBoardView board={board} initial={view} />

      {/* ── Your season ─────────────────────────────────────────────── */}
      {me ? (
        <>
          <section className="af-st-section">
            <h2 className="af-label af-st-seclabel">Your place in the table, by week</h2>
            <div className="af-st-panel">
              {trend.length > 1 ? (
                <RankBars trend={trend} teamCount={n} />
              ) : (
                <p className="af-st-panel-why">
                  A trend needs at least two final weeks. There {trend.length === 1 ? 'is one' : 'are none'} so far.
                </p>
              )}
            </div>
          </section>

          <div className="af-st-split">
            <section className="af-st-panel">
              <h2 className="af-label">Recent weeks</h2>
              {recent.length > 0 ? (
                <ul className="af-st-recent">
                  {recent.map((r) => (
                    <li key={r.week}>
                      <span className="af-st-recent-w af-label">Wk {r.week}</span>
                      <span className="af-st-recent-p af-num">{n1(r.pointsFor)}</span>
                      {/*
                        Against your OWN average to that point, so the sign means "better than your
                        normal" rather than "better than last week".
                      */}
                      <span className="af-st-recent-d af-num" data-dir={r.delta == null ? 'none' : r.delta >= 0 ? 'up' : 'down'}>
                        {r.delta == null ? '—' : `${r.delta >= 0 ? '+' : '−'}${n1(Math.abs(r.delta))} vs your avg`}
                      </span>
                      <span className="af-st-recent-r af-num">{ordinal(r.rank)} in points</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="af-st-panel-why">None of your weeks are final yet in this league.</p>
              )}
            </section>

            <section className="af-st-projection" data-missing={!projection.available}>
              <h2 className="af-label">
                <span className="af-stb-projtag">Model</span> Projected final points
              </h2>
              {projection.available ? (
                <>
                  <p className="af-st-proj-v">
                    <span className="af-num">~{Math.round(projection.data.mid).toLocaleString('en-US')}</span>
                    <span className="af-st-proj-range af-num">
                      {projection.data.weeksRemaining} {projection.data.weeksRemaining === 1 ? 'game' : 'games'} left
                    </span>
                  </p>
                  <p className="af-st-proj-basis">{projection.data.basis}</p>
                  {/*
                    ⚠ THE LOADER'S OWN RANGE, NOT WIN-OUT / LOSE-OUT. Points for does not depend on wins
                    and nothing here models a team's scoring off its record, so these rows are the top and
                    bottom of the projected range, labelled as exactly that.
                  */}
                  <div className="af-st-projrows">
                    <div className="af-st-projrow" data-tone="good">
                      <span className="af-label">High</span>
                      <span className="af-st-projrow-note">Top of the projected range</span>
                      <span className="af-num">{Math.round(projection.data.high).toLocaleString('en-US')}</span>
                    </div>
                    <div className="af-st-projrow" data-tone="bad">
                      <span className="af-label">Low</span>
                      <span className="af-st-projrow-note">Bottom of the projected range</span>
                      <span className="af-num">{Math.round(projection.data.low).toLocaleString('en-US')}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="af-st-proj-why">{projection.reason}</p>
              )}
            </section>
          </div>
        </>
      ) : null}

      <p className="af-st-foot">
        Projected records on this page are a model’s expectation.{' '}
        <Link href={`/core/season-outlook?league=${encodeURIComponent(league.id)}`}>Season Outlook</Link> simulates the rest of the
        season for playoff and title odds.
      </p>
      <SeasonHistory rows={history} />
    </div>
  )
}

/**
 * Your place in the table by week, as bars (2026-09-13 handoff).
 *
 * ⚠ TALLER IS BETTER. 1st draws the tallest bar and last the shortest. The handoff's caption read
 * "lower bar = better rank", which contradicts its own drawing; the drawing is what a reader believes,
 * so the caption here says what the bars actually do.
 */
function RankBars({ trend, teamCount }: { trend: RankTrendPoint[]; teamCount: number }) {
  const worst = Math.max(teamCount, ...trend.map((p) => p.rank))
  const best = Math.min(...trend.map((p) => p.rank))
  const last = trend[trend.length - 1]

  return (
    <figure className="af-st-bars">
      <div
        className="af-st-bars-chart"
        role="img"
        aria-label={`Place in the table by week: ${trend.map((p) => `week ${p.week} ${ordinal(p.rank)}`).join(', ')}`}
      >
        <div className="af-st-bars-plot">
          {trend.map((p, i) => {
            const isNow = i === trend.length - 1
            const tone = isNow ? 'now' : p.rank === best ? 'best' : undefined
            const height = 18 + ((worst - p.rank) / Math.max(1, worst - 1)) * 82
            return (
              <div className="af-st-bar" key={p.week} data-tone={tone}>
                <span className="af-st-bar-rank af-num">{p.rank}</span>
                <span className="af-st-bar-fill" style={{ height: `${height.toFixed(1)}%` }} />
              </div>
            )
          })}
        </div>
        <div className="af-st-bars-weeks">
          {trend.map((p) => (
            <span key={p.week} className="af-num">
              W{p.week}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="af-st-bars-cap">
        Taller bar = better rank. Best {ordinal(best)} · now {ordinal(last.rank)}. Positions only move on final results, never estimated
        between weeks.
      </figcaption>
    </figure>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export default Standings
