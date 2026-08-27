import Link from 'next/link'
import {
  describeTeamOutlook,
  type OutlookLeague,
  type SwingMatchup,
} from '@/lib/core-app/seasonOutlook'
import '@/components/core-app/af-season-outlook-league.css'

/**
 * Screen 38a·5 — Season Outlook, scoped to one league.
 *
 * ⚠ ALMOST NOTHING HERE IS NEW MATHS. The Monte Carlo, the per-team playoff and
 * title percentages, the seeding rule and the swing branches were all already
 * running; the cross-league board collapsed each league into a single table row
 * and dropped the rest on the floor. This renders what was already being
 * computed.
 *
 * The one genuinely new computation is the clinch scenario's named help, and it
 * is a conditional probability out of the lose-branch simulation — P(you make it
 * | this rival misses) − P(you make it) — not a read of who sits next to you in
 * the table. Seeding depends on points for as well as record, so the team
 * directly above you is frequently NOT the one whose loss helps you most.
 */

export type SeasonOutlookLeagueProps = {
  league: OutlookLeague
  /** This league's own swing game. Null when the season has nothing left to swing. */
  swing: SwingMatchup | null
  /** Printed verbatim — a simulated number without its basis is a guess. */
  basis: string
  /**
   * The cross-league attention ranking, which this screen shows for the OTHER
   * leagues.
   *
   * ⚠ COMPUTED AND THEN DISCARDED UNTIL NOW. `getSeasonOutlook` ranks every
   * league by what needs a decision; the league-scoped view took `league`,
   * `swing` and `basis` and dropped the rest. The 38a design has a "where to
   * spend your attention" panel and this is the data behind it.
   */
  priorities?: Array<{ leagueName: string; reason: string; href: string }>
}

function pct(n: number): string {
  if (n >= 99.5) return '>99'
  if (n > 0 && n < 0.5) return '<1'
  return n.toFixed(0)
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function SeasonOutlookLeague({
  league,
  swing,
  basis,
  priorities = [],
}: SeasonOutlookLeagueProps) {
  const you = league.you

  /*
   * The attention ranking minus the league already on screen. Leaving this one
   * in would put "Guillotine League 26 — your seed is at risk" inside the
   * Guillotine League 26 screen, restating what the tiles above already show
   * and pushing a genuinely different league off the list.
   *
   * Matched on leagueName because that is what `priorities` carries; the ids
   * are not in it, and adding one just for this would widen a shared type for
   * a single consumer.
   */
  const elsewhere = priorities.filter((p) => p.leagueName !== league.leagueName).slice(0, 4)

  if (!you) {
    return (
      <div className="af-sol">
        <Header league={league} />
        <div className="af-sol-empty">
          <p className="af-sol-empty-t">We cannot tell which team is yours in this league.</p>
          <p className="af-sol-empty-b">
            Every number on this screen is about your position in the field, so none of it can be
            shown until the roster is matched to your account. The league&apos;s own standings are
            still below.
          </p>
        </div>
        <Standings league={league} />
      </div>
    )
  }

  /*
   * The last team currently inside the field. Used for the games-back line —
   * "1 back of the cut" is the fact a manager actually acts on, and it is not
   * on any tile.
   */
  const cutTeam = league.teams.find((t) => t.seed === league.playoffTeams) ?? null
  const gamesFromCut = cutTeam ? you.wins - cutTeam.wins : null

  const titleRank =
    [...league.teams]
      .filter((t) => t.modelled)
      .sort((a, b) => b.titlePct - a.titlePct)
      .findIndex((t) => t.rosterId === you.rosterId) + 1

  return (
    <div className="af-sol">
      <Header league={league} />

      {/* ── Tiles ───────────────────────────────────────────────────── */}
      <div className="af-sol-tiles">
        <div className="af-sol-tile" data-band={band(you.playoffPct)}>
          <span className="af-sol-tile-v af-num">{pct(you.playoffPct)}%</span>
          <span className="af-label">Playoff odds</span>
          <span className="af-sol-tile-s">
            top {league.playoffTeams} of {league.teams.length} make it
          </span>
        </div>

        <div className="af-sol-tile" data-band={band(you.titlePct)}>
          <span className="af-sol-tile-v af-num">{pct(you.titlePct)}%</span>
          <span className="af-label">Title odds</span>
          <span className="af-sol-tile-s">
            {titleRank > 0 ? `${ordinal(titleRank)} best in the league` : 'not ranked yet'}
          </span>
        </div>

        <div className="af-sol-tile">
          <span className="af-sol-tile-v af-num">{ordinal(you.seed)}</span>
          <span className="af-label">Current seed</span>
          <span className="af-sol-tile-s">
            {gamesFromCut == null
              ? 'cutline unknown'
              : gamesFromCut > 0
                ? `${gamesFromCut} clear of the cut`
                : gamesFromCut === 0
                  ? 'level with the cut'
                  : `${Math.abs(gamesFromCut)} back of the cut`}
          </span>
        </div>

        <div className="af-sol-tile">
          <span className="af-sol-tile-v af-num">
            {you.wins}—{you.losses}
          </span>
          <span className="af-label">Record</span>
          <span className="af-sol-tile-s">
            {league.weeksRemaining === 0
              ? 'regular season over'
              : `${league.weeksRemaining} to play`}
          </span>
        </div>
      </div>

      <p className="af-sol-basis">{basis}</p>

      {/* ── Clinch ──────────────────────────────────────────────────── */}
      {swing ? (
        <section className="af-sol-clinch">
          <header className="af-sol-clinch-head">
            <h2 className="af-label">How you clinch</h2>
            <span className="af-sol-clinch-note">
              Week {swing.week}
              {swing.opponentName ? ` · vs ${swing.opponentName}` : ''}
            </span>
          </header>

          <div className="af-sol-branches">
            <div className="af-sol-branch" data-tone="good">
              <span className="af-label">If you win</span>
              <span className="af-sol-branch-v af-num">{pct(swing.ifWin)}%</span>
              <p className="af-sol-branch-b">
                {swing.clinchOnWin
                  ? 'You are in. Win this and the rest is about seeding.'
                  : 'Still not decided, but this is the single biggest move available to you.'}
              </p>
            </div>

            <div className="af-sol-branch" data-tone="bad">
              <span className="af-label">If you lose</span>
              <span className="af-sol-branch-v af-num">{pct(swing.ifLose)}%</span>
              <p className="af-sol-branch-b">
                {/*
                  ⚠ NAMED TEAMS OR AN EXPLICIT "NO SINGLE RESULT HELPS". An empty
                  help list is a real finding — it means no one other team's
                  result moves your odds enough to matter — and stating that is
                  more useful than falling back to "you need help", which is
                  what every losing branch would say.
                */}
                {swing.helpIfLose.length === 0
                  ? 'No single other result rescues this — you would need the run of play to go your way across several games, not one.'
                  : swing.helpIfLose.length === 1
                    ? `You would need ${swing.helpIfLose[0]} to miss out too. That one absence lifts your odds more than any other result on the board.`
                    : `You would need ${swing.helpIfLose[0]} or ${swing.helpIfLose[1]} to miss out too — those two absences move your number more than anything else you do not control.`}
              </p>
            </div>

            <div className="af-sol-branch" data-tone="accent">
              <span className="af-label">Swing</span>
              <span className="af-sol-branch-v af-num">{swing.swing.toFixed(0)} pts</span>
              <p className="af-sol-branch-b">
                of playoff probability rest on this one result — more than any other game left on
                your schedule.
              </p>
            </div>
          </div>

          <Link
            href={`/core/matchup?league=${encodeURIComponent(league.leagueId)}`}
            className="af-btn af-sol-clinch-cta"
          >
            Open that matchup
          </Link>
        </section>
      ) : (
        <section className="af-sol-clinch" data-empty="true">
          <h2 className="af-label">How you clinch</h2>
          <p className="af-sol-clinch-why">
            {league.weeksRemaining === 0
              ? 'The regular season is over in this league — there is nothing left to clinch.'
              : 'We could not find your next unplayed game in this league, so there is no single result to branch on.'}
          </p>
        </section>
      )}

      {/* ── Where to spend your attention ───────────────────────────── */}
      {elsewhere.length > 0 ? (
        <section className="af-sol-attention">
          <header className="af-sol-attention-head">
            <h2 className="af-label">Where to spend your attention</h2>
            {/*
              ⚠ SCOPED AND LABELLED AS CROSS-LEAGUE. `priorities` is ranked over
              every league the user is in, and this is a one-league screen — so
              printing it under a bare heading would read as "the things to do in
              THIS league", which is not what the ranking means. The other
              leagues still belong here: the reason a single league's odds matter
              at all is that they compete for the same attention as the rest.
            */}
            <span className="af-sol-attention-note">your other leagues, most urgent first</span>
          </header>

          <ul className="af-sol-attention-rows">
            {elsewhere.map((p) => (
              <li key={p.href}>
                <Link className="af-sol-attention-row" href={p.href}>
                  <span className="af-sol-attention-league">{p.leagueName}</span>
                  <span className="af-sol-attention-reason">{p.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Standings ───────────────────────────────────────────────── */}
      <Standings league={league} />

      <p className="af-sol-foot">{league.whatDecidesIt}</p>
    </div>
  )
}

function Header({ league }: { league: OutlookLeague }) {
  return (
    <header className="af-sol-head">
      <p className="af-label af-sol-eyebrow">{league.leagueName}</p>
      <h1 className="af-display af-sol-title">Season Outlook</h1>
      <p className="af-sol-sub">
        Playoff and title odds, simulated against this league&apos;s own schedule, scoring and
        playoff field — not a generic model.
      </p>
    </header>
  )
}

function Standings({ league }: { league: OutlookLeague }) {
  return (
    <section className="af-sol-tablewrap">
      <table className="af-sol-table">
        <caption className="af-sol-caption">
          Every team in {league.leagueName}, ordered by current seed. The line marks the playoff
          cut.
        </caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" className="af-sol-n">
              Record
            </th>
            <th scope="col" className="af-sol-n">
              Points for
            </th>
            <th scope="col" className="af-sol-n">
              Playoffs
            </th>
            <th scope="col" className="af-sol-n">
              Title
            </th>
            <th scope="col">What decides it</th>
          </tr>
        </thead>
        <tbody>
          {league.teams.map((t) => (
            <tr
              key={t.rosterId}
              data-you={t.isYou}
              /* The cut is drawn under the last team in the field, not around a
                 colour-coded block — the boundary is the information. */
              data-cut={t.seed === league.playoffTeams}
            >
              <th scope="row">
                <span className="af-sol-seed af-num">{t.seed}</span>
                <span className="af-sol-name">{t.name ?? 'Unnamed team'}</span>
                {t.isYou ? <span className="af-sol-you af-label">You</span> : null}
              </th>
              <td className="af-sol-n af-num">
                {t.wins}—{t.losses}
              </td>
              <td className="af-sol-n af-num">{t.pointsFor.toFixed(1)}</td>
              <td className="af-sol-n">
                {/*
                  A team with too few completed weeks is not modelled, and an
                  unmodelled team showing "0%" would read as eliminated rather
                  than as unknown.
                */}
                {t.modelled ? (
                  <span className="af-sol-pct" data-band={band(t.playoffPct)}>
                    {pct(t.playoffPct)}%
                  </span>
                ) : (
                  <span className="af-sol-pct" data-band="none">
                    —
                  </span>
                )}
              </td>
              <td className="af-sol-n">
                {t.modelled ? (
                  <span className="af-sol-pct" data-band={band(t.titlePct)}>
                    {pct(t.titlePct)}%
                  </span>
                ) : (
                  <span className="af-sol-pct" data-band="none">
                    —
                  </span>
                )}
              </td>
              <td className="af-sol-decides">
                {describeTeamOutlook(t, league.weeksRemaining, league.playoffTeams)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function band(p: number): 'high' | 'mid' | 'low' {
  if (p >= 75) return 'high'
  if (p >= 25) return 'mid'
  return 'low'
}

export default SeasonOutlookLeague
