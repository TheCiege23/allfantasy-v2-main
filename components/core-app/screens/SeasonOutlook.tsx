'use client'

import Link from 'next/link'
import type { SeasonOutlook as SeasonOutlookData } from '@/lib/core-app/seasonOutlook'
import type { FreshnessMeta } from '@/lib/sports-os/freshness'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import { band, ordinal, pct, rangeLabel } from '@/lib/core-app/outlookCopy'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import { StatusPill } from '@/components/core-app/outlook/OutlookParts'
import '@/components/core-app/af-season-outlook.css'
import '@/components/core-app/af-outlook.css'

/**
 * 26b — Season Outlook. Playoff, bye and championship odds across every active league.
 *
 * ⚠ THE BASIS IS PRINTED, ALWAYS. `data.basis` is a required field on the loader
 * and it is rendered under the forecast, not tucked in a tooltip. A simulated
 * probability that does not cite what produced it is indistinguishable from a guess.
 *
 * ⚠ "WHAT DECIDES IT" IS A CONDITION, NEVER A STATUS. The loader guarantees this
 * per league; this file only renders the string.
 *
 * ── THE FORECAST LEADS ───────────────────────────────────────────────────────
 * Odds across the portfolio, the one next action, and the three games that swing your
 * season most — then the table. On a phone the table rows become cards (container query
 * on `.af-so`), so nothing needs a sideways scroll to read.
 *
 * ⚠ THE PAGE HANDS THIS A SLIMMED BOARD. Every league's per-team rows stay on the server
 * (`slimOutlookForBoard`); this screen reads only `you`, the league facts and its milestones.
 */

export type SeasonOutlookProps = {
  data: SeasonOutlookData
  freshness?: { meta: FreshnessMeta; initialLabel: string; initialWarn: boolean } | null
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'warn' | 'accent' }) {
  return (
    <div className="af-so-tile" data-tone={tone ?? 'neutral'}>
      <span className="af-so-tile-v af-num">{value}</span>
      <span className="af-so-tile-l">{label}</span>
    </div>
  )
}

export function SeasonOutlook({ data, freshness = null }: SeasonOutlookProps) {
  const hasLeagues = data.leagues.length > 0
  const preseasonKickoffLabel =
    data.firstKickoffAt && new Date(data.firstKickoffAt).getTime() > Date.now()
      ? kickoffDayLabel(data.firstKickoffAt)
      : null

  /* The three results that swing your season most, across every league. */
  const swings = Object.values(data.swingByLeague)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 3)
  const anyByes = data.leagues.some((l) => l.byeTeams > 0)
  const next = data.priorities[0] ?? null

  return (
    <div className="af-so af-olk">
      <header className="af-so-head">
        <p className="af-so-eyebrow af-label">Across every league you play</p>
        <div className="af-olk-titlerow">
          <h1 className="af-display af-so-title">Season Outlook</h1>
          {freshness ? (
            <FreshnessChip meta={freshness.meta} initialLabel={freshness.initialLabel} initialWarn={freshness.initialWarn} />
          ) : null}
        </div>
        <p className="af-so-sub">
          Playoff, bye and championship odds, simulated per league against that league&apos;s own rules. Open a
          league for its what-ifs, moves and roster risk.
        </p>
      </header>

      {hasLeagues ? (
        <>
          <section className="af-so-tiles" aria-label="Your odds across leagues">
            <Tile
              value={String(data.summary.makingPlayoffs)}
              label={`of ${data.leagues.length} on track for the playoffs`}
              tone="accent"
            />
            <Tile value={String(data.summary.clinched)} label="already clinched" tone="good" />
            <Tile value={String(data.summary.onTheBubble)} label="on the bubble" tone="warn" />
            {anyByes ? <Tile value={String(data.summary.onByePace)} label="on pace for a bye" /> : null}
            <Tile
              value={data.summary.bestTitle ? `${pct(data.summary.bestTitle.pct)}%` : '—'}
              label={
                data.summary.bestTitle
                  ? `best title odds · ${data.summary.bestTitle.leagueName}`
                  : 'no title odds yet'
              }
            />
          </section>

          <section className="af-olk-hero-grid af-so-lead" aria-label="What to do next">
            <div className="af-olk-next">
              <h2 className="af-label">Next action</h2>
              {next ? (
                <>
                  <p className="af-olk-next-t">{next.leagueName}</p>
                  <p className="af-olk-next-d">{next.reason}</p>
                  <Link className="af-btn af-olk-next-cta" href={next.href}>
                    Open {next.leagueName}
                  </Link>
                </>
              ) : (
                <p className="af-olk-next-d">No league needs a decision right now.</p>
              )}
            </div>
            <div className="af-olk-drivebox">
              <h2 className="af-label">The games that swing your season</h2>
              {swings.length === 0 ? (
                <p className="af-olk-empty">No single game left moves your odds in a contested league.</p>
              ) : (
                <ol className="af-olk-drivers">
                  {swings.map((s) => (
                    <li key={s.leagueId} className="af-olk-driver" data-dir="both">
                      <div className="af-olk-driver-top">
                        <Link className="af-olk-driver-l" href={`/core/season-outlook?league=${encodeURIComponent(s.leagueId)}`}>
                          {s.leagueName} · week {s.week}
                        </Link>
                        <span className="af-olk-driver-v af-num">±{(s.swing / 2).toFixed(0)} pts</span>
                      </div>
                      <span className="af-olk-diverge" aria-hidden>
                        <span className="af-olk-diverge-mid" />
                        <span className="af-olk-diverge-bar" data-side="left" style={{ width: `${Math.min(50, s.swing / 2)}%` }} />
                        <span className="af-olk-diverge-bar" data-side="right" style={{ width: `${Math.min(50, s.swing / 2)}%` }} />
                      </span>
                      <p className="af-olk-driver-d">
                        {s.opponentName ? `Against ${s.opponentName}: ` : ''}
                        {pct(s.ifWin)}% with a win, {pct(s.ifLose)}% with a loss.
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          {/* The basis. Never optional, never a tooltip. */}
          <p className="af-so-basis">
            {data.basis}{' '}
            {data.runs.reused > 0
              ? `${data.runs.reused} of ${data.runs.reused + data.runs.computed} league runs were reused because nothing they read had changed.`
              : ''}
          </p>

          <section className="af-so-tablewrap">
            <table className="af-so-table">
              <thead>
                <tr>
                  <th scope="col">League</th>
                  <th scope="col" className="af-so-num">Record</th>
                  <th scope="col" className="af-so-num">Seed</th>
                  <th scope="col" className="af-so-num">Playoffs</th>
                  {anyByes ? <th scope="col" className="af-so-num">Bye</th> : null}
                  <th scope="col" className="af-so-num">Title</th>
                  <th scope="col">What decides it</th>
                </tr>
              </thead>
              <tbody>
                {data.leagues.map((l) => {
                  const rest = l.you?.schedule?.remainingRank
                  return (
                    <tr key={l.leagueId}>
                      <th scope="row">
                        <Link
                          href={`/core/season-outlook?league=${encodeURIComponent(l.leagueId)}`}
                          className="af-so-league"
                          data-platform={l.platform}
                        >
                          {l.leagueName}
                        </Link>
                        <span className="af-so-leaguemeta af-num">
                          {l.season} · top {l.playoffTeams} of {l.assumptions.teams}
                          {l.byeTeams > 0 ? `, ${l.byeTeams} bye${l.byeTeams === 1 ? '' : 's'}` : ''} ·{' '}
                          {l.weeksRemaining === 0 ? 'season over' : `${l.weeksRemaining} to play`}
                          {rest != null && l.weeksRemaining > 0 ? ` · ${ordinal(rest)} hardest schedule left` : ''}
                        </span>
                        {l.you?.status ? <StatusPill status={l.you.status} /> : null}
                      </th>
                      {l.you ? (
                        <>
                          <td className="af-so-num" data-label="Record">
                            {l.you.wins}–{l.you.losses}
                          </td>
                          <td className="af-so-num" data-label="Seed">
                            {l.you.seed}
                          </td>
                          <td className="af-so-num" data-label="Playoffs">
                            <span className="af-so-pct" data-band={band(l.you.playoffPct)}>
                              {pct(l.you.playoffPct)}%
                            </span>
                            {l.you.range ? <span className="af-so-range af-num">{rangeLabel(l.you.range.playoff)}</span> : null}
                          </td>
                          {anyByes ? (
                            <td className="af-so-num" data-label="Bye">
                              {l.byeTeams > 0 ? `${pct(l.you.byePct)}%` : '—'}
                            </td>
                          ) : null}
                          <td className="af-so-num" data-label="Title">
                            {/* Neutral on purpose: a 3% title chance is ordinary, not a warning. */}
                            <span className="af-so-pct" data-band="none">
                              {pct(l.you.titlePct)}%
                            </span>
                            {l.you.range ? <span className="af-so-range af-num">{rangeLabel(l.you.range.title)}</span> : null}
                          </td>
                        </>
                      ) : (
                        <td className="af-so-noteam" colSpan={anyByes ? 5 : 4}>
                          We cannot tell which team is yours in this league.
                        </td>
                      )}
                      <td className="af-so-decides">{l.whatDecidesIt}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        </>
      ) : preseasonKickoffLabel ? (
        <div className="af-so-empty">
          <p className="af-so-empty-t">The season has not started yet.</p>
          <p className="af-so-empty-b">
            Odds are simulated from each team&apos;s completed weeks, and none have been played
            this season. They start filling in as weeks are scored — first kickoff{' '}
            {preseasonKickoffLabel}.
          </p>
        </div>
      ) : (
        <div className="af-so-empty">
          <p className="af-so-empty-t">Nothing can be simulated yet.</p>
          <p className="af-so-empty-b">
            Odds are computed from synced matchups — each team&apos;s completed weeks in its own
            league&apos;s scoring. None of your leagues has enough of that on file, so there is
            nothing to run. That is a gap in what we have read, not a season with no games.
          </p>
          <Link href="/import" className="af-so-cta">
            Import or re-sync a league
          </Link>
        </div>
      )}

      {/* Withheld leagues, listed. A league that silently vanished reads as a league you are not in. */}
      {data.withheld.length > 0 ? (
        <section className="af-so-withheld">
          <h2 className="af-so-withheld-t">
            {data.withheld.length} {data.withheld.length === 1 ? 'league is' : 'leagues are'} not on
            this page
          </h2>
          <ul>
            {/* Keyed by position too: two withheld leagues can share a name (one per season). */}
            {data.withheld.map((w, i) => (
              <li key={`${w.leagueName}-${i}`}>
                <b>{w.leagueName}</b> — {w.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default SeasonOutlook
