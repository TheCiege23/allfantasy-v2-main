'use client'

import { useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { allPlayShare, fmt1, initialsOf, oddsTone, ordinal, powerOrder, readPlayoffFormat, streakTone } from '@/lib/league/native/nativeScreenModels'
import { Card, ScreenHead, Segmented } from './NativeScreenParts'
import { SideContestsCard } from './SideContestsCard'
import { PayoutsCard } from './PayoutsCard'

/**
 * Standings & playoffs — handoff §3, `Standings.png` / `MobileStandings.png`.
 *
 * Order and tiebreaks come from `/api/leagues/[id]/scoring/standings` (finalized AF results; the
 * server ranks). Playoff odds are the stored `SeasonForecastSnapshot` for this week
 * (`/api/leagues/[id]/season-forecast`, GET only — this screen never triggers a simulation).
 * Seeds are `fantasyStanding.playoffSeed` from `/scoring/playoff-seeds`. "Power" is an all-play
 * ranking from the same standings read. All DB reads; no provider call.
 */
type Row = { rosterId: string; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number | null; rank: number | null; streak?: string | null; allPlay?: string | null }
type StandingsData = { season: number; standings: Row[]; viewerRosterId: string | null; scoredWeeks: number | null; scoringMode?: string }
type Forecast = { teamId: string; teamName?: string; playoffProbability: number; byeProbability: number }
type Seed = { rosterId: string; seed: number | null; teamName: string }
type View = 'standings' | 'playoffs' | 'power'

const record = (r: Row) => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`

export function NativeStandingsScreen({ league, isCommissioner, onSelectTab }: { league: UserLeague; isCommissioner: boolean; onSelectTab: (id: string) => void }) {
  const [view, setView] = useState<View>('standings')
  const [data, setData] = useState<StandingsData | null>(null)
  const [forecast, setForecast] = useState<Forecast[] | null>(null)
  const [seeds, setSeeds] = useState<Seed[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const season = Number(league.season) || new Date().getFullYear()
  const week = typeof league.currentWeek === 'number' ? league.currentWeek : null

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
        const pj = p && p.ok ? ((await p.json().catch(() => null)) as { seeds?: Seed[] } | null) : null
        setSeeds(Array.isArray(pj?.seeds) ? pj!.seeds! : [])
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

  const teamCell = (r: Row, i: number) => (
    <div className="nls-team">
      <span className="nls-avatar" aria-hidden>{initialsOf(r.teamName)}</span>
      <strong>{r.teamName}</strong>
      {byes > 0 && i < byes ? <span className="nls-chip" data-tone="good">BYE</span> : null}
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
    <div className="nls" data-testid="native-standings-screen">
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
                      <tr key={r.rosterId} data-viewer={r.rosterId === data.viewerRosterId || undefined} data-cut={cut != null && i === cut && i > 0 ? true : undefined}>
                        <td data-align="left" className="nls-mono nls-muted">{r.rank ?? i + 1}</td>
                        <td data-align="left">{teamCell(r, i)}</td>
                        <td>{record(r)}</td>
                        <td>{fmt1(r.pointsFor)}</td>
                        <td data-hide="phone" className="nls-muted">{fmt1(r.pointsAgainst)}</td>
                        <td data-hide="phone" data-pts={streakTone(r.streak)}>{r.streak ?? '—'}</td>
                        <td data-align="left">{oddsCell(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="nls-table-note">
                  {cut ? `Cyan line = playoff cut (top ${cut}). ` : ''}Order and tiebreaks follow your league&apos;s settings.
                  {!anyOdds ? ' Playoff odds appear after AF runs this week’s forecast.' : ''}
                </p>
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
                <p className="nls-table-note">{seeds.length ? 'Seeds as set by the league.' : 'If the season ended today. Seeds lock when the commissioner sets them.'}</p>
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
                <div><dt>Teams</dt><dd className="nls-mono">{format.teams != null ? `${format.teams}${format.byes ? ` · ${format.byes} byes` : ''}` : 'League default'}</dd></div>
                <div><dt>Weeks</dt><dd className="nls-mono">{format.startWeek != null ? (format.weeks ? `${format.startWeek} – ${format.startWeek + format.weeks - 1}` : `From ${format.startWeek}`) : 'League default'}</dd></div>
                <div><dt>Consolation</dt><dd>{format.consolation === 'toilet_bowl' ? 'Toilet bowl' : format.consolation === 'consolation' ? 'Consolation bracket' : format.consolation === 'none' ? 'None' : 'League default'}</dd></div>
              </dl>
              {isCommissioner ? <button type="button" className="nl-text-link" onClick={() => onSelectTab('settings')}>Edit in Commissioner</button> : null}
            </Card>
            <SideContestsCard leagueId={league.id} />
            <PayoutsCard leagueId={league.id} />
          </aside>
        </div>
      ) : null}
    </div>
  )
}
