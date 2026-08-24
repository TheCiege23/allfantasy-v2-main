'use client'

import Link from 'next/link'
import type { SeasonOutlook as SeasonOutlookData } from '@/lib/core-app/seasonOutlook'
import '@/components/core-app/af-season-outlook.css'

/**
 * 26b — Season Outlook. Playoff and championship odds across every active league.
 *
 * ⚠ THE BASIS IS PRINTED, ALWAYS. `data.basis` is a required field on the loader
 * and it is rendered under the summary tiles, not tucked in a tooltip. The copy
 * contract is explicit: a simulated probability that does not cite what produced
 * it is indistinguishable from a guess.
 *
 * ⚠ "WHAT DECIDES IT" IS A CONDITION, NEVER A STATUS. The loader guarantees this
 * per league; this file only renders the string. If a vague one ever appears
 * here, fix `describeWhatDecidesIt`, not this component.
 *
 * ⚠ THIS ROUTE IS THE FIX FOR A REAL ROUTING BUG, AND THE BUG IS RECORDED RATHER
 * THAN QUIETLY PATCHED. The dashboard's "Season Outlook" tool pointed at
 * `/af-legacy?tab=pulse` — the Legacy import board's market tab, which is not
 * playoff odds and never was. The href now points here. The Legacy page's own
 * eleven-tab horizontal-scroll navigation is a separate problem, noted in the
 * loader and deliberately not touched by this change.
 */

export type SeasonOutlookProps = {
  data: SeasonOutlookData
}

function pct(n: number): string {
  if (n >= 99.5) return '>99'
  if (n > 0 && n < 0.5) return '<1'
  return n.toFixed(0)
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'warn' | 'accent' }) {
  return (
    <div className="af-so-tile" data-tone={tone ?? 'neutral'}>
      <span className="af-so-tile-v af-num">{value}</span>
      <span className="af-so-tile-l">{label}</span>
    </div>
  )
}

export function SeasonOutlook({ data }: SeasonOutlookProps) {
  const hasLeagues = data.leagues.length > 0

  return (
    <div className="af-so">
      <header className="af-so-head">
        <p className="af-so-eyebrow af-label">Across every league you play</p>
        <h1 className="af-display af-so-title">Season Outlook</h1>
        <p className="af-so-sub">
          Playoff and championship odds, simulated per league against that league&apos;s own rules.
        </p>
      </header>

      {hasLeagues ? (
        <>
          <section className="af-so-tiles">
            <Tile
              value={String(data.summary.makingPlayoffs)}
              label={`of ${data.leagues.length} making the playoffs`}
              tone="accent"
            />
            <Tile value={String(data.summary.clinched)} label="already clinched" tone="good" />
            <Tile value={String(data.summary.onTheBubble)} label="on the bubble" tone="warn" />
            <Tile
              value={data.summary.bestTitle ? `${pct(data.summary.bestTitle.pct)}%` : '—'}
              label={
                data.summary.bestTitle
                  ? `best title odds · ${data.summary.bestTitle.leagueName}`
                  : 'no title odds yet'
              }
            />
          </section>

          {/* The basis. Never optional, never a tooltip. */}
          <p className="af-so-basis">{data.basis}</p>

          <section className="af-so-tablewrap">
            <table className="af-so-table">
              <thead>
                <tr>
                  <th scope="col">League</th>
                  <th scope="col" className="af-so-num">Record</th>
                  <th scope="col" className="af-so-num">Seed</th>
                  <th scope="col" className="af-so-num">Playoffs</th>
                  <th scope="col" className="af-so-num">Title</th>
                  <th scope="col">What decides it</th>
                </tr>
              </thead>
              <tbody>
                {data.leagues.map((l) => (
                  <tr key={l.leagueId}>
                    <th scope="row">
                      <Link href={l.href} className="af-so-league" data-platform={l.platform}>
                        {l.leagueName}
                      </Link>
                      <span className="af-so-leaguemeta af-num">
                        {l.season} · top {l.playoffTeams} make it ·{' '}
                        {l.weeksRemaining === 0 ? 'season over' : `${l.weeksRemaining} to play`}
                      </span>
                    </th>
                    {l.you ? (
                      <>
                        <td className="af-so-num">
                          {l.you.wins}–{l.you.losses}
                        </td>
                        <td className="af-so-num">{l.you.seed}</td>
                        <td className="af-so-num">
                          <span className="af-so-pct" data-band={band(l.you.playoffPct)}>
                            {pct(l.you.playoffPct)}%
                          </span>
                        </td>
                        <td className="af-so-num">
                          <span className="af-so-pct" data-band={band(l.you.titlePct)}>
                            {pct(l.you.titlePct)}%
                          </span>
                        </td>
                      </>
                    ) : (
                      <td className="af-so-noteam" colSpan={4}>
                        We cannot tell which team is yours in this league.
                      </td>
                    )}
                    <td className="af-so-decides">{l.whatDecidesIt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="af-so-panels">
            {data.weekThatMatters ? (
              <article className="af-so-panel af-so-panel--swing">
                <p className="af-so-panel-eyebrow af-label">The week that matters most</p>
                <h2 className="af-so-panel-title">
                  {data.weekThatMatters.leagueName} · week {data.weekThatMatters.week}
                </h2>
                <p className="af-so-panel-body">
                  {data.weekThatMatters.opponentName
                    ? `Against ${data.weekThatMatters.opponentName}. `
                    : ''}
                  This single result moves your playoff odds more than any other game left on your
                  schedule.
                </p>
                <div className="af-so-branch">
                  <div className="af-so-branch-arm" data-tone="good">
                    <span className="af-so-branch-l">Win</span>
                    <span className="af-so-branch-v af-num">{pct(data.weekThatMatters.ifWin)}%</span>
                  </div>
                  <div className="af-so-branch-arm" data-tone="bad">
                    <span className="af-so-branch-l">Lose</span>
                    <span className="af-so-branch-v af-num">{pct(data.weekThatMatters.ifLose)}%</span>
                  </div>
                  <div className="af-so-branch-arm" data-tone="accent">
                    <span className="af-so-branch-l">Swing</span>
                    <span className="af-so-branch-v af-num">
                      {data.weekThatMatters.swing.toFixed(0)} pts
                    </span>
                  </div>
                </div>
                <Link
                  href={`/core/matchup?league=${encodeURIComponent(data.weekThatMatters.leagueId)}`}
                  className="af-so-panel-cta"
                >
                  Open that matchup
                </Link>
              </article>
            ) : null}

            {data.priorities.length > 0 ? (
              <article className="af-so-panel">
                <p className="af-so-panel-eyebrow af-label">Where to spend your attention</p>
                <ol className="af-so-priorities">
                  {data.priorities.map((p, i) => (
                    <li key={p.leagueName + i}>
                      <span className="af-so-pri-rank af-num">{i + 1}</span>
                      <span className="af-so-pri-body">
                        <Link href={p.href} className="af-so-pri-league">
                          {p.leagueName}
                        </Link>
                        <span className="af-so-pri-reason">{p.reason}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </article>
            ) : null}
          </section>
        </>
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

      {/*
        Withheld leagues, listed. A league that silently vanished from a
        cross-league page reads as a league you are not in.
      */}
      {data.withheld.length > 0 ? (
        <section className="af-so-withheld">
          <h2 className="af-so-withheld-t">
            {data.withheld.length} {data.withheld.length === 1 ? 'league is' : 'leagues are'} not on
            this page
          </h2>
          <ul>
            {data.withheld.map((w) => (
              <li key={w.leagueName}>
                <b>{w.leagueName}</b> — {w.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function band(p: number): 'high' | 'mid' | 'low' {
  if (p >= 75) return 'high'
  if (p >= 25) return 'mid'
  return 'low'
}

export default SeasonOutlook
