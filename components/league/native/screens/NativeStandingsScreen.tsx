'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { allPlayShare, fmt1, initialsOf, oddsTone, ordinal, powerOrder, readPlayoffFormat, streakTone } from '@/lib/league/native/nativeScreenModels'
import { Card, ScreenHead, Segmented } from './NativeScreenParts'
import { SideContestsCard } from './SideContestsCard'
import { PayoutsCard } from './PayoutsCard'
import { groupStandingsByDivision } from '@/lib/league/divisions/leagueDivisions'
import { fetchRedraftPlayoffRuntime, type RedraftPlayoffRuntimeClient } from '@/lib/redraft/client'
import { PLAYOFF_RACE_LABEL, bracketColumns, playoffRaceStatus } from '@/lib/league-media/redraftScreens'
import { RedraftBracket, RedraftScreen, useRedraftScreen } from './RedraftScreenParts'
import { DynastyLotteryCard } from '@/components/dynasty/DynastyLotteryCard'
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'

/**
 * Standings & playoffs — handoff §3, `Standings.png` / `MobileStandings.png`.
 *
 * Order and tiebreaks come from `/api/leagues/[id]/scoring/standings` (finalized AF results; the
 * server ranks). Playoff odds are the stored `SeasonForecastSnapshot` for this week
 * (`/api/leagues/[id]/season-forecast`, GET only — this screen never triggers a simulation).
 * Seeds come from `/scoring/playoff-seeds`: for an AllFantasy season, the playoff runtime's own seeding
 * (divisions included), live until the bracket is generated; otherwise `fantasyStanding.playoffSeed`. "Power" is an all-play
 * ranking from the same standings read. All DB reads; no provider call.
 */
type Row = { rosterId: string; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number | null; rank: number | null; streak?: string | null; allPlay?: string | null }
type DivisionRow = { key: string; name: string; rosterIds: string[] }
type StandingsData = {
  season: number
  standings: Row[]
  viewerRosterId: string | null
  scoredWeeks: number | null
  scoringMode?: string
  /** The commissioner's divisions; absent or null when the league has none. */
  divisions?: DivisionRow[] | null
  divisionPlayoffRule?: 'top_seeds' | 'guaranteed' | 'none' | null
}
type Forecast = { teamId: string; teamName?: string; playoffProbability: number; byeProbability: number }
type Seed = { rosterId: string; seed: number | null; teamName: string }
type View = 'standings' | 'playoffs' | 'power'

const record = (r: Row) => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`

export function NativeStandingsScreen({ league, isCommissioner, onSelectTab }: { league: UserLeague; isCommissioner: boolean; onSelectTab: (id: string) => void }) {
  const [view, setView] = useState<View>('standings')
  const [data, setData] = useState<StandingsData | null>(null)
  const [forecast, setForecast] = useState<Forecast[] | null>(null)
  const [seeds, setSeeds] = useState<Seed[]>([])
  const [seedsProjected, setSeedsProjected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const season = Number(league.season) || new Date().getFullYear()
  const dynasty = usesDynastyBackground(league)
  const week = typeof league.currentWeek === 'number' ? league.currentWeek : null
  // Redraft (lib/league-media/redraftIdentity.ts): the playoff runtime's bracket and its clinched /
  // eliminated split — read only, and only claimed once the bracket is generated (playoffRaceStatus).
  const rd = useRedraftScreen(league)
  const [runtime, setRuntime] = useState<RedraftPlayoffRuntimeClient | null>(null)
  useEffect(() => {
    if (!rd) return
    let cancelled = false
    fetchRedraftPlayoffRuntime({ leagueId: league.id })
      .then((r) => {
        if (!cancelled) setRuntime(r)
      })
      .catch(() => {
        if (!cancelled) setRuntime(null)
      })
    return () => {
      cancelled = true
    }
  }, [rd, league.id])

  useEffect(() => {
    const ac = new AbortController()
    const id = encodeURIComponent(league.id)
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [s, f, p] = await Promise.all([
          fetch(`/api/leagues/${id}/scoring/standings?season=${season}`, { signal: ac.signal, cache: 'no-store' }),
          week ? fetch(`/api/leagues/${id}/season-forecast?season=${season}&week=${week}`, { signal: ac.signal, cache: 'no-store' }).catch(() => null) : Promise.resolve(null),
          fetch(`/api/leagues/${id}/scoring/playoff-seeds?season=${season}`, { signal: ac.signal, cache: 'no-store' }).catch(() => null),
        ])
        if (!s.ok) throw new Error()
        setData((await s.json()) as StandingsData)
        const fj = f && f.ok ? ((await f.json().catch(() => null)) as { teamForecasts?: Forecast[] | null } | null) : null
        setForecast(Array.isArray(fj?.teamForecasts) ? fj!.teamForecasts! : null)
        const pj = p && p.ok ? ((await p.json().catch(() => null)) as { seeds?: Seed[]; projected?: boolean } | null) : null
        setSeeds(Array.isArray(pj?.seeds) ? pj!.seeds! : [])
        setSeedsProjected(pj?.projected === true)
      } catch {
        if (!ac.signal.aborted) setError('We could not load standings. Please retry.')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [league.id, season, week])

  const format = useMemo(
    () => readPlayoffFormat(league.settings, league.playoffStartWeek ?? null, league.playoffLowerBracket ?? null),
    [league.settings, league.playoffStartWeek, league.playoffLowerBracket],
  )
  const rows = useMemo(() => [...(data?.standings ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)), [data])
  const oddsFor = useMemo(() => {
    const byId = new Map((forecast ?? []).map((f) => [f.teamId, f]))
    const byName = new Map((forecast ?? []).filter((f) => f.teamName).map((f) => [String(f.teamName).toLowerCase(), f]))
    return (r: Row) => byId.get(r.rosterId) ?? byName.get(r.teamName.toLowerCase()) ?? null
  }, [forecast])
  const cut = format.teams ?? null
  const byes = format.byes ?? 0
  const viewer = rows.find((r) => r.rosterId === data?.viewerRosterId) ?? null
  const viewerOdds = viewer ? oddsFor(viewer) : null
  const power = useMemo(() => powerOrder(rows), [rows])
  const anyOdds = rows.some((r) => oddsFor(r) != null)
  const divisionTables = useMemo(() => {
    const list = data?.divisions ?? []
    if (!list.length) return []
    const divisionByRoster = new Map(list.flatMap((d) => d.rosterIds.map((id) => [id, d.key] as const)))
    return groupStandingsByDivision(rows, list.map((d, index) => ({ key: d.key, name: d.name, index })), (id) => divisionByRoster.get(id) ?? null)
  }, [data?.divisions, rows])
  const divisionRuleNote =
    data?.divisionPlayoffRule === 'top_seeds'
      ? 'Division winners make the playoffs and take the top seeds.'
      : data?.divisionPlayoffRule === 'guaranteed'
        ? 'Division winners are guaranteed a playoff spot; seeds follow record.'
        : null

  const race = (rosterId: string) => (rd ? playoffRaceStatus(runtime, rosterId) : null)
  const bracket = useMemo(() => {
    if (!rd || !runtime?.bracket?.generated || !runtime.bracket.rounds?.length) return []
    const names = new Map([...(data?.standings ?? []).map((r) => [r.rosterId, r.teamName] as const), ...(runtime.seeds ?? []).map((sd) => [sd.rosterId, sd.displayName] as const)])
    return bracketColumns(runtime.bracket.rounds, (id) => names.get(id) ?? null, data?.viewerRosterId ?? null)
  }, [rd, runtime, data])

  const teamCell = (r: Row, i: number) => (
    <div className="nls-team">
      <span className="nls-avatar" aria-hidden>{initialsOf(r.teamName)}</span>
      <strong>{r.teamName}</strong>
      {byes > 0 && i < byes ? <span className="nls-chip" data-tone="good">BYE</span> : null}
      {(() => {
        const st = race(r.rosterId)
        return st ? <span className="nls-chip nls-rd-race" data-tone={st === 'eliminated' ? undefined : st === 'champion' ? 'accent' : 'good'} data-testid={`native-standings-race-${r.rosterId}`}>{PLAYOFF_RACE_LABEL[st]}</span> : null
      })()}
      {r.rosterId === data?.viewerRosterId ? <span className="nls-sr">(your team)</span> : null}
    </div>
  )

  const oddsCell = (r: Row) => {
    const o = oddsFor(r)
    if (!o) return <span className="nls-muted">—</span>
    const pct = Math.round(o.playoffProbability)
    return (
      <span className="nls-oddsbar" data-tone={oddsTone(pct)}>
        <span aria-hidden><i style={{ width: `${Math.max(1, Math.min(100, pct))}%` }} /></span>
        <b>{pct}%</b>
      </span>
    )
  }

  const scored = data?.scoredWeeks ?? null

  /*
   * Rotisserie: the server's `pointsFor` is the team's summed category-rank points
   * (`rankRotisserieTeams`) and W–L, PA, streaks, all-play and playoff odds do not exist — there is
   * no opponent and no bracket. Show the one number roto has rather than a table of zeros.
   */
  if (data?.scoringMode === 'roto') {
    return (
      <div className="nls" data-testid="native-standings-screen">
        <ScreenHead eyebrow={`${league.name} · ${scored ? `After week ${scored}` : `${season} season`}`} title="Rotisserie standings" />
        <div className="nls-cols">
          <section className="nls-card nls-card-flush" aria-label="Standings">
            {!rows.length ? (
              <p className="nls-empty">Standings appear once the first week is scored.</p>
            ) : (
              <>
                <table className="nls-table">
                  <caption className="nls-sr">{season} rotisserie standings</caption>
                  <thead>
                    <tr>
                      <th scope="col" data-align="left">#</th>
                      <th scope="col" data-align="left">Team</th>
                      <th scope="col">Roto pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.rosterId} data-viewer={r.rosterId === data.viewerRosterId || undefined}>
                        <td data-align="left" className="nls-mono nls-muted">{r.rank ?? i + 1}</td>
                        <td data-align="left">{teamCell(r, Number.POSITIVE_INFINITY)}</td>
                        <td>{fmt1(r.pointsFor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="nls-table-note">
                  Each category ranks every team on season totals: first place earns as many points as there are teams, last earns 1, and tied teams share the average. Rate stats such as FG% come from season totals, not averages, and lower-is-better stats such as turnovers rank fewest first.
                </p>
              </>
            )}
          </section>
          <aside className="nls-aside" aria-label="Your standing">
            <Card label="Your standing" tone="accent">
              {viewer ? (
                <p>You are {ordinal(viewer.rank) ?? 'in the race'} with {fmt1(viewer.pointsFor)} rotisserie points. There are no playoffs: the season-long leader wins the league.</p>
              ) : (
                <p>Your standing appears here once you have a team in this league.</p>
              )}
            </Card>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <RedraftScreen identity={rd}>
    <div className="nls" data-testid="native-standings-screen" data-rd-screen={rd ? 'standings' : undefined}>
      <ScreenHead eyebrow={`${league.name} · ${scored ? `After week ${scored}` : `${season} season`}`} title="Standings & playoffs">
        <Segmented label="Standings view" value={view} onChange={setView} options={[{ id: 'standings', label: 'Standings' }, { id: 'playoffs', label: 'Playoff picture' }, { id: 'power', label: 'Power rankings' }]} />
      </ScreenHead>

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {loading && !data ? <p className="nls-empty" role="status">Loading standings…</p> : null}

      {data ? (
        <div className="nls-cols">
          <section className="nls-card nls-card-flush" aria-label={view === 'power' ? 'Power rankings' : view === 'playoffs' ? 'Playoff picture' : 'Standings'}>
            {!rows.length ? (
              <p className="nls-empty">Standings appear once the first week is scored.</p>
            ) : view === 'standings' ? (
              <>
                <table className="nls-table">
                  <caption className="nls-sr">{season} standings</caption>
                  <thead>
                    <tr>
                      <th scope="col" data-align="left">#</th>
                      <th scope="col" data-align="left">Team</th>
                      <th scope="col">W–L</th>
                      <th scope="col">PF</th>
                      <th scope="col" data-hide="phone">PA</th>
                      <th scope="col" data-hide="phone">Strk</th>
                      <th scope="col" data-align="left">Playoff odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <Fragment key={r.rosterId}>
                        {/* Redraft: the playoff line is labelled, not only drawn. */}
                        {rd && cut != null && i === cut && i > 0 ? (
                          <tr className="nls-rd-cutrow" data-testid="native-standings-playoff-line" aria-hidden>
                            <td colSpan={7}><span>Playoff line · top {cut}</span></td>
                          </tr>
                        ) : null}
                        <tr data-viewer={r.rosterId === data.viewerRosterId || undefined} data-cut={cut != null && i === cut && i > 0 ? true : undefined} data-rd-out={race(r.rosterId) === 'eliminated' || undefined}>
                          <td data-align="left" className="nls-mono nls-muted">{r.rank ?? i + 1}</td>
                          <td data-align="left">{teamCell(r, i)}</td>
                          <td>{record(r)}</td>
                          <td>{fmt1(r.pointsFor)}</td>
                          <td data-hide="phone" className="nls-muted">{fmt1(r.pointsAgainst)}</td>
                          <td data-hide="phone" data-pts={streakTone(r.streak)}>{r.streak ?? '—'}</td>
                          <td data-align="left">{oddsCell(r)}</td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                <p className="nls-table-note">
                  {cut ? (rd ? `The labelled line is the playoff cut (top ${cut}). ` : `Cyan line = playoff cut (top ${cut}). `) : ''}Order and tiebreaks follow your league&apos;s settings.
                  {!anyOdds ? ' Playoff odds appear after AF runs this week’s forecast.' : ''}
                </p>
                {divisionTables.length ? (
                  <div data-testid="native-standings-divisions">
                    {divisionTables.map((group) => (
                      <table key={group.key} className="nls-table" data-testid={`native-standings-division-${group.key}`}>
                        <caption className="nls-division-head">{group.name}</caption>
                        <thead>
                          <tr>
                            <th scope="col" data-align="left">#</th>
                            <th scope="col" data-align="left">Team</th>
                            <th scope="col">W–L</th>
                            <th scope="col">PF</th>
                            <th scope="col" data-hide="phone">Overall</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((r) => (
                            <tr key={r.rosterId} data-viewer={r.rosterId === data.viewerRosterId || undefined}>
                              <td data-align="left" className="nls-mono nls-muted">{r.divisionRank}</td>
                              <td data-align="left">
                                <div className="nls-team">
                                  <span className="nls-avatar" aria-hidden>{initialsOf(r.teamName)}</span>
                                  <strong>{r.teamName}</strong>
                                  {r.divisionRank === 1 ? <span className="nls-chip" data-tone="good">Leader</span> : null}
                                </div>
                              </td>
                              <td>{record(r)}</td>
                              <td>{fmt1(r.pointsFor)}</td>
                              <td data-hide="phone" className="nls-muted">{ordinal(r.rank) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ))}
                    {divisionRuleNote ? <p className="nls-table-note">{divisionRuleNote}</p> : null}
                  </div>
                ) : null}
              </>
            ) : view === 'playoffs' && bracket.length ? (
              <>
                <RedraftBracket columns={bracket} />
                <p className="nls-table-note">Bracket as generated for this league; scores update as each round is played.</p>
              </>
            ) : view === 'playoffs' ? (
              <>
                <table className="nls-table">
                  <caption className="nls-sr">Playoff seeds</caption>
                  <thead>
                    <tr>
                      <th scope="col" data-align="left">Seed</th>
                      <th scope="col" data-align="left">Team</th>
                      <th scope="col">W–L</th>
                      <th scope="col" data-align="left">Odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(seeds.length
                      ? seeds.map((s) => ({ seed: s.seed, row: rows.find((r) => r.rosterId === s.rosterId) ?? null, name: s.teamName }))
                      : rows.slice(0, cut ?? Math.max(2, Math.floor(rows.length / 2))).map((r, i) => ({ seed: i + 1, row: r, name: r.teamName }))
                    ).map((s, i) => (
                      <tr key={`${s.name}-${i}`} data-viewer={s.row?.rosterId === data.viewerRosterId || undefined}>
                        <td data-align="left" className="nls-mono">{s.seed ?? i + 1}</td>
                        <td data-align="left">{s.row ? teamCell(s.row, i) : <strong>{s.name}</strong>}</td>
                        <td>{s.row ? record(s.row) : '—'}</td>
                        <td data-align="left">{s.row ? oddsCell(s.row) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="nls-table-note">{seeds.length && !seedsProjected ? 'Seeds as set by the league.' : 'If the season ended today. Seeds lock when the commissioner sets them.'}</p>
              </>
            ) : (
              <>
                <table className="nls-table">
                  <caption className="nls-sr">Power rankings</caption>
                  <thead>
                    <tr>
                      <th scope="col" data-align="left">#</th>
                      <th scope="col" data-align="left">Team</th>
                      <th scope="col">All-play</th>
                      <th scope="col" data-hide="phone">Win %</th>
                      <th scope="col">PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {power.map((r, i) => {
                      const share = allPlayShare(r.allPlay)
                      return (
                        <tr key={r.rosterId} data-viewer={r.rosterId === data.viewerRosterId || undefined}>
                          <td data-align="left" className="nls-mono nls-muted">{i + 1}</td>
                          <td data-align="left">{teamCell(r, Number.POSITIVE_INFINITY)}</td>
                          <td>{r.allPlay ?? '—'}</td>
                          <td data-hide="phone">{share != null ? `${Math.round(share * 100)}%` : '—'}</td>
                          <td>{fmt1(r.pointsFor)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="nls-table-note">Power = all-play record (every team against every other team, every week), then points for. It removes schedule luck.</p>
              </>
            )}
          </section>

          <aside className="nls-aside" aria-label="Your playoff path">
            <Card label="Your path" tone="accent">
              {viewer ? (
                viewerOdds ? (
                  <>
                    <div className="nls-big-odds">
                      <b>{Math.round(viewerOdds.playoffProbability)}%</b>
                      <span>playoff odds{byes > 0 ? ` · ${Math.round(viewerOdds.byeProbability)}% for a bye` : ''}</span>
                    </div>
                    <p>You are {ordinal(viewer.rank) ?? 'in the race'} at {record(viewer)}{cut ? `, with the top ${cut} making the playoffs` : ''}.</p>
                  </>
                ) : (
                  <p>You are {viewer.rank ? `#${viewer.rank}` : 'in the race'} at {record(viewer)}. Playoff odds appear after AF runs this week&apos;s forecast.</p>
                )
              ) : (
                <p>Your team&apos;s path appears here once you have a team in this league.</p>
              )}
            </Card>
            <Card label="Playoff format">
              <dl className="nls-dl">
                <div><dt>Teams</dt><dd className="nls-mono">{format.playIn ? `${format.playIn.qualifiers} + play-in · ${format.playIn.games.map(([a, b]) => `#${a} v #${b}`).join(', ')}` : format.teams != null ? `${format.teams}${format.byes ? ` · ${format.byes} byes` : ''}` : 'League default'}</dd></div>
                <div><dt>Weeks</dt><dd className="nls-mono">{format.startWeek != null ? (format.weeks ? `${format.startWeek} – ${format.startWeek + format.weeks - 1}` : `From ${format.startWeek}`) : 'League default'}</dd></div>
                <div><dt>Reseeding</dt><dd>{format.reseed === true ? 'Each round' : format.reseed === false ? 'Fixed bracket' : 'League default'}</dd></div>
                <div><dt>Consolation</dt><dd>{format.consolation === 'toilet_bowl' ? 'Toilet bowl' : format.consolation === 'consolation' ? 'Consolation bracket' : format.consolation === 'none' ? 'None' : 'League default'}</dd></div>
              </dl>
              {isCommissioner ? <button type="button" className="nl-text-link" onClick={() => onSelectTab('settings')}>Edit in Commissioner</button> : null}
            </Card>
            {/* Dynasty only: the upcoming rookie draft's lottery odds, Draft HQ's own numbers. */}
            {dynasty ? <DynastyLotteryCard leagueId={league.id} leagueName={league.name} /> : null}
            <SideContestsCard leagueId={league.id} />
            <PayoutsCard leagueId={league.id} />
          </aside>
        </div>
      ) : null}
    </div>
    </RedraftScreen>
  )
}
