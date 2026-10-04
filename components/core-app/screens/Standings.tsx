'use client'

import { TopicTip } from '@/components/core-app/TopicTip'
import Link from 'next/link'
import type { LeagueStandingsResult, RankTrendPoint, SeasonHistoryRow } from '@/lib/core-app/leagueStandings'
import { formatRecord, type BoardTeam, type StandingsBoard, type Zone } from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW, type StandingsViewState } from '@/lib/core-app/standingsView'
import { StandingsBoardView, Move } from '@/components/core-app/standings/StandingsBoardView'
import '@/components/core-app/af-standings.css'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import type { FreshnessMeta } from '@/lib/sports-os/freshness'
import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { WeekLineupsTable } from '@/components/core-app/standings/WeekLineupsTable'
import { formatOdds, type StandingsOdds } from '@/lib/core-app/standingsOdds'
import type { LineupEfficiency } from '@/lib/core-app/lineupEfficiency'
import type { DraftOrderPreview } from '@/lib/core-app/standingsDraftOrder'
import { ShareMomentButton } from '@/components/core-app/screens/ShareMomentButton'

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
  /** This week's AF and API lineup projections for every team. Optional; absent draws no section. */
  lineups?: StandingsLineups | null
  /**
   * Season Outlook's simulation for this league — playoff odds, schedule strength and this week's
   * stakes. Optional: a league the simulation withholds, or a failed read, draws the table without them.
   */
  odds?: StandingsOdds | null
  /** Lineup efficiency per team — Sleeper leagues with player scores on file. */
  efficiency?: LineupEfficiency | null
  /** Next season's draft order if the season ended today — only for a league that drafts from its standings. */
  draftOrder?: DraftOrderPreview | null
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

function lineText(t: BoardTeam, field: number, language: string): string {
  if (t.gamesBack == null) return 'no head-to-head games'
  /*
   * Zero games back is three different places. "On the playoff line" was printed for all of them,
   * including a 0-1 team sitting 14th of 14 behind seven other 0-1 teams — true by record, and read by
   * its manager as "I'm in".
   */
  if (t.gamesBack === 0) {
    if (t.seed === field) return 'holding the last playoff spot'
    return t.seed < field ? 'level with the last playoff spot' : 'level with the last playoff spot, out on the tiebreak'
  }
  const abs = Math.abs(t.gamesBack)
  const games = `${Number.isInteger(abs) ? abs : abs.toFixed(1)} ${language === 'es' ? (abs === 1 ? 'partido' : 'partidos') : (abs === 1 ? 'game' : 'games')}`
  return language === 'es'
    ? t.gamesBack < 0 ? `${games} por encima del límite` : `${games} por debajo del límite`
    : t.gamesBack < 0 ? `${games} clear of the line` : `${games} behind the line`
}

/** The magic numbers, as one sentence about you. */
function pathSentence(t: BoardTeam): string {
  const { winsToClinch: w, lossesToElimination: l, gamesLeft } = t.path
  if (w === 0) return t.clinched === 'bye' ? 'Your first-round bye is clinched.' : 'Your playoff spot is clinched.'
  if (l === 0) return 'You are eliminated from the playoff race.'
  const win =
    w == null
      ? 'Winning out does not guarantee a spot on its own yet — you need results elsewhere too'
      : w === gamesLeft
        ? `Win out — all ${gamesLeft} — and you are in, whatever else happens`
        : `Win ${w} of your last ${gamesLeft} and you are in, whatever else happens`
  const lose = l != null ? `lose ${l} more and you are out` : null
  return lose ? `${win}; ${lose}.` : `${win}.`
}

/**
 * What this week means for you: the magic numbers, your own game's swing, and who to root for.
 *
 * ⚠ THE MAGIC NUMBERS ARE THIS TABLE'S; THE PERCENTAGES ARE SEASON OUTLOOK'S. The first are arithmetic
 * guarantees from the table's own rule (median games included); the second are the simulation's, which
 * seeds on wins then points for. Each is labelled with where it came from so neither reads as the other.
 *
 * ⚠ THE SWING WEEK IS THE FIRST ONE NOBODY HAS SCORED IN. While a week is being played, your next game
 * on the table is the live one, but its outcome is already partly on the board — so the stakes move to
 * the week after, and the copy says which week it is talking about.
 */
function WeekStakes({ me, board, odds }: { me: BoardTeam; board: StandingsBoard; odds: StandingsOdds | null }) {
  const you = odds?.you && odds.you.rosterId === me.rosterId ? odds.you : null
  const stakes = you ? (odds?.stakes ?? null) : null
  const seedOf = new Map(board.teams.map((t) => [t.rosterId, t.seed]))
  const nameOf = (id: string, fallback: string | null) => fallback ?? board.teams.find((t) => t.rosterId === id)?.name ?? 'Unknown team'
  const settled = me.path.winsToClinch === 0 || me.path.lossesToElimination === 0
  /* Early in the season the sentence is "win out — all 11", which says nothing; a settled team always says something. */
  const showPath = board.showPaths || settled
  if (!showPath && !you) return null

  return (
    <section className="af-st-stakes" aria-labelledby="af-st-stakes-title">
      <div className="af-st-stakes-head">
        <h2 id="af-st-stakes-title" className="af-label">
          What is at stake
        </h2>
        {/* Beside the heading, not in it: the section is aria-labelledby this h2. */}
        <TopicTip topic="playoffOdds" />
        {you && odds ? (
          <p className="af-st-stakes-odds">
            <span className="af-num af-st-stakes-pct">
              {formatOdds(you.playoffPct, me.clinched ? 'clinched' : me.zone === 'eliminated' ? 'eliminated' : null)}
            </span>
            <span className="af-st-stakes-oddslabel">
              playoff odds ·{' '}
              <Link href={odds.href}>Season Outlook</Link>
            </span>
          </p>
        ) : null}
      </div>

      {showPath ? <p className="af-st-stakes-path">{pathSentence(me)}</p> : null}
      {you && !settled ? <p className="af-st-stakes-why">{you.whatDecidesIt}</p> : null}

      {me.next?.inProgress ? (
        <p className="af-st-stakes-note">
          Week {me.next.week} against {me.next.opponentName} is still being played; it is not counted above yet.
        </p>
      ) : null}

      {stakes ? (
        <div className="af-st-stakes-grid">
          <div className="af-st-stakes-game">
            <h3 className="af-label">
              Your game · week {stakes.week}
              {stakes.opponentName ? ` vs ${stakes.opponentName}` : ''}
            </h3>
            <div className="af-st-stakes-branches">
              <span data-tone="good">
                <span className="af-label">Win</span>
                <span className="af-num">{formatOdds(stakes.ifWin)}</span>
              </span>
              <span data-tone="bad">
                <span className="af-label">Lose</span>
                <span className="af-num">{formatOdds(stakes.ifLose)}</span>
              </span>
            </div>
            {stakes.clinchOnWin ? <p className="af-st-stakes-note">Win and you are in, in essentially every simulated season.</p> : null}
            {stakes.helpIfLose.length > 0 ? (
              <p className="af-st-stakes-note">If you lose, you most need {stakes.helpIfLose.join(' and ')} to miss the playoffs.</p>
            ) : null}
          </div>

          {stakes.rooting ? (
            <div className="af-st-stakes-root">
              <h3 className="af-label">Root for · week {stakes.week}</h3>
              {stakes.rooting.length > 0 ? (
                <ul>
                  {stakes.rooting.map((g) => {
                    const pick = g.rootFor === g.a.id ? g.a : g.b
                    const other = g.rootFor === g.a.id ? g.b : g.a
                    const hi = g.rootFor === g.a.id ? g.ifA : g.ifB
                    const lo = g.rootFor === g.a.id ? g.ifB : g.ifA
                    const pickSeed = seedOf.get(pick.id)
                    const otherSeed = seedOf.get(other.id)
                    return (
                      <li key={`${g.a.id}-${g.b.id}`}>
                        <span className="af-st-stakes-pick">
                          <strong>{nameOf(pick.id, pick.name)}</strong>
                          {pickSeed != null ? <span className="af-num af-st-stakes-seed"> #{pickSeed}</span> : null}
                          <span className="af-st-stakes-over"> over </span>
                          {nameOf(other.id, other.name)}
                          {otherSeed != null ? <span className="af-num af-st-stakes-seed"> #{otherSeed}</span> : null}
                        </span>
                        <span className="af-st-stakes-delta af-num">
                          {formatOdds(hi)} <span aria-hidden>vs</span>
                          <span className="af-sr"> for you, against </span> {formatOdds(lo)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="af-st-stakes-note">No other game that week moves your odds by more than a few points either way.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {stakes ? (
        <p className="af-st-stakes-basis">
          Win and lose are your playoff odds with that result fixed; each rooting pair is your odds in the simulated seasons where
          that team won. All of it is Season Outlook’s simulation, seeded so it reads the same on every visit.
        </p>
      ) : null}
    </section>
  )
}

/**
 * "Draft order if the season ended today" — the picks the teams outside the playoff line would hold.
 *
 * ⚠ ONLY DRAWN FOR A LEAGUE THAT DRAFTS FROM ITS STANDINGS (`standingsDraftOrder.ts` decides), so a
 * redraft league with a randomized draft never sees an order that does not exist.
 */
function DraftOrderSection({ order }: { order: DraftOrderPreview }) {
  const lottery = order.rule === 'lottery'
  return (
    <section className="af-st-draft" aria-labelledby="af-st-draft-title">
      <h2 id="af-st-draft-title" className="af-label">
        Draft order if the season ended today
      </h2>
      <p className="af-st-draft-rule">{order.ruleText}</p>
      <ol className="af-st-draft-list">
        {order.picks.map((p) => (
          <li key={p.rosterId} data-you={p.isYou ? 'true' : undefined}>
            <span className="af-st-draft-pick af-num">{lottery ? `#${p.pick}` : p.pick}</span>
            <span className="af-st-draft-name">
              {p.name}
              {p.isYou ? <span className="af-stb-you">You</span> : null}
            </span>
            <span className="af-st-draft-rec af-num">
              {p.record} · {p.pointsFor.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} PF
            </span>
            {lottery ? (
              <span className="af-st-draft-odds af-num">
                {p.firstPickOdds != null ? `${p.firstPickOdds.toFixed(1)}% at #1` : 'not in the lottery'}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="af-st-draft-note">
        The other {order.playoffTeams} picks go to the playoff teams, in an order the playoffs decide.
        {lottery
          ? ' The list is the order picks fall to without lottery luck; the percentage is each team’s chance at the first pick.'
          : ''}{' '}
        From the table as it stands, not a projection.
      </p>
    </section>
  )
}

/**
 * Completed seasons, as the import recorded them.
 *
 * ⚠ SEPARATE FROM THE BOARD ABOVE, NOT AN EXTENSION OF IT. The live board is computed week by week —
 * these rows are season totals a provider reported at the time; there are no weeks behind them to
 * recompute, and presenting them in the same table would imply a precision they do not carry.
 */
function SeasonHistory({ rows }: { rows: SeasonHistoryRow[] }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => coreUiCopy(value, language)
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
      <h2 className="af-label af-st-history-title">{copy('Past seasons')}</h2>
      <p className="af-st-history-note">
        {language === 'es'
          ? `Clasificaciones finales importadas. ${seasons.length} ${seasons.length === 1 ? 'temporada registrada' : 'temporadas registradas'}.`
          : `Imported final standings. ${seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'} on file.`}
      </p>
      {seasons.map(([season, teams]) => (
        <div key={season} className="af-st-history-season">
          <h3 className="af-st-history-season-title af-num">{season}</h3>
          <p className="af-st-scroll-cue">{copy('Scroll sideways to compare every column.')}</p>
          <div className="af-st-history-scroll" role="region" aria-label={language === 'es' ? `Clasificación final de ${season}` : `${season} final standings`} tabIndex={0}>
            <table className="af-st-history-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{copy('Team')}</th>
                  <th scope="col">{copy('Record')}</th>
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

export function Standings({
  data,
  freshness,
  view = DEFAULT_STANDINGS_VIEW,
  lineups = null,
  odds = null,
  efficiency = null,
  draftOrder = null,
}: StandingsProps) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => coreUiCopy(value, language)
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
          <h1 className="af-display af-st-title">{copy('Standings')}</h1>
          {chip}
        </header>
        <div className="af-st-blocked">
          <span className="af-st-blocked-mark af-num" aria-hidden>
            —
          </span>
          <p className="af-st-blocked-body">{copy(data.reason)}</p>
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
        <h1 className="af-display af-st-title">{copy('Standings')}</h1>
        <p className="af-st-sub">
          {language === 'es'
            ? `${P === 'the platform' ? 'Tabla de la liga' : `Tabla de ${P}`} y clasificación de rendimiento de AllFantasy. El récord determina los puestos de playoffs; el rendimiento contra todos muestra la fuerza de cada equipo. ${season} · ${seasonComplete ? `temporada terminada tras la semana ${week}` : `resultados hasta la semana ${board.throughWeek}`}.`
            : `${P === 'the platform' ? 'The league table' : `${P}’s table`}, and AllFantasy’s own power ranking beside it — record decides the seeding, all-play says who is actually good. ${season} · ${seasonComplete ? `season complete after week ${week}` : `results through week ${board.throughWeek}`}.`}
        </p>
        {chip}
        <div className="af-st-share">
          {/*
            The IMAGE is shared, never the URL: the card route is auth-gated to league members, so a link
            would open nothing for anyone else.
          */}
          <ShareMomentButton
            url={`/api/share/rivalry-card?kind=standings&leagueId=${encodeURIComponent(league.id)}`}
            filename={`standings-${season}-week-${board.throughWeek}.png`}
            title={`${league.name} standings`}
            label="Share standings"
          />
        </div>
      </header>

      {me ? (
        <div className="af-st-tiles">
          <div className="af-st-tile">
            <span className="af-label">{copy('Table position')}</span>
            <span className="af-st-tile-row">
              <span className="af-st-tile-v af-num">{ordinal(me.seed)}</span>
              {/* Null movement is the first final week — no prior position, which is not "no change". */}
              {me.seedMove != null && me.seedMove !== 0 ? <Move value={me.seedMove} /> : null}
            </span>
            <span className="af-st-tile-s">
              {copy('of')} {n} · {copy(zoneLine(me))}
            </span>
          </div>

          <div className="af-st-tile">
            <span className="af-label">{copy('Record')}</span>
            <span className="af-st-tile-v af-num">{board.hasHeadToHead ? formatRecord(me.record) : '—'}</span>
            <span className="af-st-tile-s">{copy(lineText(me, Math.min(board.rules.playoffTeams, n), language))}</span>
          </div>

          <div className="af-st-tile">
            <span className="af-label">
              {copy('AF Power')} <TopicTip topic="afPowerScore" />
            </span>
            <span className="af-st-tile-row">
              <span className="af-st-tile-v af-num" data-tone="accent">
                {ordinal(me.powerRank)}
              </span>
              {me.powerMove != null && me.powerMove !== 0 ? <Move value={me.powerMove} /> : null}
            </span>
            <span className="af-st-tile-s af-num">
              {copy('score')} {me.powerScore.toFixed(1)} · {copy('all-play')} {formatRecord(me.allPlay)}
            </span>
          </div>

          <div className="af-st-tile">
            <span className="af-label">{copy('Points for')}</span>
            <span className="af-st-tile-v af-num">{pts1(me.pointsFor)}</span>
            <span className="af-st-tile-s">
              {me.average != null ? `${n1(me.average)} ${copy('a week')} · ` : ''}
              {language === 'es' ? `${me.pfRank} de la liga` : `${ordinal(me.pfRank)} in the league`}
            </span>
          </div>
        </div>
      ) : (
        <div className="af-st-noteam">
          {copy('We cannot tell which team in this league is yours, so there are no tiles about you. The full table is still below.')}
        </div>
      )}

      {me && board.hasHeadToHead && board.gamesRemaining > 0 ? <WeekStakes me={me} board={board} odds={odds} /> : null}

      <StandingsBoardView board={board} initial={view} odds={odds} live={data.live ?? null} efficiency={efficiency} />

      {draftOrder ? <DraftOrderSection order={draftOrder} /> : null}

      {lineups ? (
        <WeekLineupsTable lineups={lineups} caveat="the table above is points already scored." />
      ) : null}

      {/* ── Your season ─────────────────────────────────────────────── */}
      {me ? (
        <>
          <section className="af-st-section">
            <h2 className="af-label af-st-seclabel">{copy('Your place in the table, by week')}</h2>
            <div className="af-st-panel">
              {trend.length > 1 ? (
                <RankBars trend={trend} teamCount={n} />
              ) : (
                <p className="af-st-panel-why">
                  {language === 'es'
                    ? `La tendencia necesita al menos dos semanas cerradas. Hasta ahora ${trend.length === 1 ? 'hay una' : 'no hay ninguna'}.`
                    : `A trend needs at least two final weeks. There ${trend.length === 1 ? 'is one' : 'are none'} so far.`}
                </p>
              )}
            </div>
          </section>

          <div className="af-st-split">
            <section className="af-st-panel">
              <h2 className="af-label">{copy('Recent weeks')}</h2>
              {recent.length > 0 ? (
                <ul className="af-st-recent">
                  {recent.map((r) => (
                    <li key={r.week}>
                      <span className="af-st-recent-w af-label">{copy('Wk')} {r.week}</span>
                      <span className="af-st-recent-p af-num">{n1(r.pointsFor)}</span>
                      {/*
                        Against your OWN average to that point, so the sign means "better than your
                        normal" rather than "better than last week".
                      */}
                      <span className="af-st-recent-d af-num" data-dir={r.delta == null ? 'none' : r.delta >= 0 ? 'up' : 'down'}>
                        {r.delta == null ? '—' : `${r.delta >= 0 ? '+' : '−'}${n1(Math.abs(r.delta))} ${copy('vs your avg')}`}
                      </span>
                      <span className="af-st-recent-r af-num">{language === 'es' ? `${r.rank} en puntos` : `${ordinal(r.rank)} in points`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="af-st-panel-why">{copy('None of your weeks are final yet in this league.')}</p>
              )}
            </section>

            <section className="af-st-projection" data-missing={!projection.available}>
              <h2 className="af-label">
                <span className="af-stb-projtag">{copy('Model')}</span> {copy('Projected final points')}
              </h2>
              {projection.available ? (
                <>
                  <p className="af-st-proj-v">
                    <span className="af-num">~{Math.round(projection.data.mid).toLocaleString('en-US')}</span>
                    <span className="af-st-proj-range af-num">
                      {projection.data.weeksRemaining} {copy(projection.data.weeksRemaining === 1 ? 'game' : 'games')} {copy('left')}
                    </span>
                  </p>
                  <p className="af-st-proj-basis">{copy(projection.data.basis)}</p>
                  {/*
                    ⚠ THE LOADER'S OWN RANGE, NOT WIN-OUT / LOSE-OUT. Points for does not depend on wins
                    and nothing here models a team's scoring off its record, so these rows are the top and
                    bottom of the projected range, labelled as exactly that.
                  */}
                  <div className="af-st-projrows">
                    <div className="af-st-projrow" data-tone="good">
                      <span className="af-label">{copy('High')}</span>
                      <span className="af-st-projrow-note">{copy('Top of the projected range')}</span>
                      <span className="af-num">{Math.round(projection.data.high).toLocaleString('en-US')}</span>
                    </div>
                    <div className="af-st-projrow" data-tone="bad">
                      <span className="af-label">{copy('Low')}</span>
                      <span className="af-st-projrow-note">{copy('Bottom of the projected range')}</span>
                      <span className="af-num">{Math.round(projection.data.low).toLocaleString('en-US')}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="af-st-proj-why">{copy(projection.reason)}</p>
              )}
            </section>
          </div>
        </>
      ) : null}

      <p className="af-st-foot">
        {copy('Projected records on this page are a model’s expectation.')} {' '}
        <Link href={`/core/season-outlook?league=${encodeURIComponent(league.id)}`}>{copy('Season Outlook')}</Link> {copy('simulates the rest of the season for playoff and title odds.')}
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
  const language = useOptionalLanguage().language
  const worst = Math.max(teamCount, ...trend.map((p) => p.rank))
  const best = Math.min(...trend.map((p) => p.rank))
  const last = trend[trend.length - 1]

  return (
    <figure className="af-st-bars">
      <div
        className="af-st-bars-chart"
        role="img"
        aria-label={language === 'es' ? `Posición en la tabla por semana: ${trend.map((p) => `semana ${p.week} puesto ${p.rank}`).join(', ')}` : `Place in the table by week: ${trend.map((p) => `week ${p.week} ${ordinal(p.rank)}`).join(', ')}`}
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
              {language === 'es' ? 'S' : 'W'}{p.week}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="af-st-bars-cap">
        {language === 'es'
          ? `Una barra más alta indica mejor posición. Mejor: ${best}; ahora: ${last.rank}. Las posiciones solo cambian con resultados finales.`
          : `Taller bar = better rank. Best ${ordinal(best)} · now ${ordinal(last.rank)}. Positions only move on final results, never estimated between weeks.`}
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
