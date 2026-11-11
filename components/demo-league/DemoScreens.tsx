import Link from 'next/link'
import type { DemoLeagueView, DemoPlayer, DemoTeam } from '@/lib/demo-league/types'
import { TeamBadge } from './TeamBadge'

/*
 * Presentational demo screens. They take an ALREADY-ANONYMIZED DemoLeagueView and nothing
 * else, so they cannot reach real data even by mistake. The /demo pages load the view and
 * render these; the DB-free /e2e/demo-league harness renders the same components.
 */

function syncedAgo(iso: string | null): string {
  if (!iso) return 'sync time unknown'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 2) return 'synced just now'
  if (mins < 120) return `synced ${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 48 ? `synced ${h} h ago` : `synced ${Math.round(h / 24)} days ago`
}

export function DemoOverview({ view }: { view: DemoLeagueView }) {
  const team = (slot: number) => view.teams.find((t) => t.slot === slot)
  const s = view.settings

  return (
    <div className="space-y-5">
      <header className="pt-2">
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{view.leagueName}</h1>
        <p className="mt-1 text-sm af-muted">
          {s.teamCount} teams · {s.sport} {s.season}
          {s.scoringLabel ? ` · ${s.scoringLabel}` : ''}
          {s.isDynasty ? ' · Dynasty' : ''}
          {view.currentWeek != null ? ` · Week ${view.currentWeek}` : ''} · {syncedAgo(view.lastSyncedAt)}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="af-card min-w-0 p-4" aria-labelledby="demo-standings">
          <h2 id="demo-standings" className="text-lg font-black">Standings</h2>
          {view.standings.length === 0 ? (
            <p className="mt-2 text-sm af-muted">No games scored yet this season.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase af-tertiary">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Team</th>
                    <th className="py-2 pr-2 text-right">W-L</th>
                    <th className="py-2 pr-2 text-right">PF</th>
                    <th className="py-2 text-right">PA</th>
                  </tr>
                </thead>
                <tbody>
                  {view.standings.map((r) => (
                    <tr key={r.slot} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="py-2 pr-2 font-bold">{r.rank}</td>
                      <td className="py-2 pr-2"><TeamBadge team={team(r.slot)} size={28} /></td>
                      <td className="py-2 pr-2 text-right tabular-nums">{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{r.pointsFor.toFixed(1)}</td>
                      <td className="py-2 text-right tabular-nums">{r.pointsAgainst.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="min-w-0 space-y-5">
          <section className="af-card p-4" aria-labelledby="demo-matchups">
            <h2 id="demo-matchups" className="text-lg font-black">
              {view.currentWeek != null ? `Week ${view.currentWeek} scores` : 'Scores'}
            </h2>
            {view.matchups.length === 0 ? (
              <p className="mt-2 text-sm af-muted">No matchups on file for this week.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {view.matchups.map((m, i) => (
                  <li key={i} className="af-card-soft grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 p-3 text-sm">
                    <div className="min-w-0"><TeamBadge team={team(m.home.slot)} size={24} /></div>
                    <div className="px-1 text-center tabular-nums">
                      <div className="font-black">{m.home.points.toFixed(1)} – {m.away ? m.away.points.toFixed(1) : '—'}</div>
                      <div className="text-[11px] uppercase af-tertiary">{m.status}</div>
                    </div>
                    <div className="flex min-w-0 justify-end text-right">{m.away ? <TeamBadge team={team(m.away.slot)} size={24} /> : <span className="af-muted">Bye</span>}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="af-card p-4" aria-labelledby="demo-health">
            <h2 id="demo-health" className="text-lg font-black">League Health</h2>
            {view.health ? (
              <>
                <p className="mt-2 text-3xl font-black tabular-nums">{view.health.score}<span className="text-base af-muted">/100</span></p>
                <p className="text-sm font-semibold capitalize">{view.health.status.replace('_', ' ')}</p>
                <p className="mt-2 text-sm af-muted">{view.health.summary}</p>
                {view.health.strengths.length ? (
                  <ul className="mt-2 list-disc pl-5 text-sm">{view.health.strengths.map((x) => <li key={x}>{x}</li>)}</ul>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm af-muted">Not enough data yet.</p>
            )}
          </section>

          <section className="af-card p-4" aria-labelledby="demo-alerts">
            <h2 id="demo-alerts" className="text-lg font-black">Alerts</h2>
            <p className="text-xs af-tertiary">Shown here only — the demo never sends emails or push notifications.</p>
            {view.alerts.length === 0 ? (
              <p className="mt-2 text-sm af-muted">No alerts right now.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">{view.alerts.map((a, i) => <li key={i}>• {a.text}</li>)}</ul>
            )}
          </section>
        </div>
      </div>

      <section className="af-card p-4" aria-labelledby="demo-recent-trades">
        <div className="flex items-center justify-between">
          <h2 id="demo-recent-trades" className="text-lg font-black">Recent trades</h2>
          <Link href="/demo/trades" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>All trades</Link>
        </div>
        {view.trades.length === 0 ? (
          <p className="mt-2 text-sm af-muted">No trades yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {view.trades.slice(0, 4).map((t) => (
              <li key={t.key} className="af-card-soft p-3 text-sm">
                <p className="text-xs af-tertiary">{t.date}</p>
                {t.sides.map((sd) => (
                  <div key={sd.slot} className="mt-2">
                    <TeamBadge team={team(sd.slot)} size={22} />
                    <p className="mt-1 pl-8 af-muted">gets {sd.received.map((a) => a.name).join(', ') || '—'}</p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="af-card flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-black">Run your own league like this</h2>
          <p className="text-sm af-muted">Create a league, or start a test league with placeholder managers and try the whole flow solo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/create-league" className="af-button-primary inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold" data-testid="demo-create-league">Create your own league</Link>
          <Link href="/create-league?from=demo" className="af-button-secondary inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold" data-testid="demo-create-test-league">Create a test league</Link>
        </div>
      </section>
    </div>
  )
}

function PlayerRow({ p }: { p: DemoPlayer }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {p.headshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.headshotUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" loading="lazy" />
      ) : (
        <span aria-hidden="true" className="inline-block h-8 w-8 rounded-full" style={{ background: 'var(--surface-inset)' }} />
      )}
      <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
      <span className="text-xs af-muted">{[p.position, p.team].filter(Boolean).join(' · ')}</span>
    </li>
  )
}

export function DemoTeamScreen({ view, team }: { view: DemoLeagueView; team: DemoTeam }) {
  const slot = team.slot
  const standing = view.standings.find((s) => s.slot === slot)
  const roster = view.rosters.find((r) => r.slot === slot)
  const trades = view.trades.filter((t) => t.sides.some((s) => s.slot === slot))
  const teamOf = (n: number) => view.teams.find((t) => t.slot === n)

  return (
    <div className="space-y-5 pt-2">
      <Link href="/demo" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>← League</Link>
      <header className="af-card flex items-center justify-between gap-3 p-4">
        <TeamBadge team={team} size={48} link={false} />
        {standing ? (
          <div className="text-right text-sm">
            <p className="text-2xl font-black tabular-nums">{standing.wins}-{standing.losses}{standing.ties ? `-${standing.ties}` : ''}</p>
            <p className="af-muted">#{standing.rank} · {standing.pointsFor.toFixed(1)} PF</p>
          </div>
        ) : null}
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="af-card p-4">
          <h2 className="text-lg font-black">Starters</h2>
          {roster?.starters.length ? <ul className="mt-1">{roster.starters.map((p, i) => <PlayerRow key={i} p={p} />)}</ul> : <p className="mt-2 text-sm af-muted">No lineup set.</p>}
        </section>
        <section className="af-card p-4">
          <h2 className="text-lg font-black">Bench</h2>
          {roster?.bench.length ? <ul className="mt-1">{roster.bench.map((p, i) => <PlayerRow key={i} p={p} />)}</ul> : <p className="mt-2 text-sm af-muted">Empty bench.</p>}
        </section>
      </div>

      <section className="af-card p-4">
        <h2 className="text-lg font-black">Trades</h2>
        {trades.length === 0 ? <p className="mt-2 text-sm af-muted">No trades yet.</p> : (
          <ul className="mt-2 space-y-3 text-sm">
            {trades.map((t) => (
              <li key={t.key} className="af-card-soft p-3">
                <p className="text-xs af-tertiary">{t.date}</p>
                {t.sides.map((sd) => (
                  <p key={sd.slot} className="mt-1"><span className="font-semibold">{teamOf(sd.slot)?.teamName}</span> got {sd.received.map((a) => a.name).join(', ') || '—'}</p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs af-tertiary">Read-only demo: lineups, trades and settings can&apos;t be changed here.</p>
    </div>
  )
}

export function DemoTradesScreen({ view }: { view: DemoLeagueView }) {
  const team = (slot: number) => view.teams.find((t) => t.slot === slot)
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-black">Trades</h1>
      <p className="text-sm af-muted">Every completed trade in the league: real players, demo team names. Trade notes and messages are never shown.</p>
      {view.trades.length === 0 ? (
        <p className="af-card p-4 text-sm af-muted">No trades yet this season.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {view.trades.map((t) => (
            <li key={t.key} className="af-card p-4 text-sm">
              <p className="text-xs af-tertiary">{t.date}</p>
              {t.sides.map((sd) => (
                <div key={sd.slot} className="mt-3">
                  <TeamBadge team={team(sd.slot)} size={26} />
                  <ul className="mt-1 pl-9">
                    {sd.received.map((a, i) => (
                      <li key={i}>
                        {a.name}
                        <span className="af-muted">{a.position ? ` · ${a.position}` : ''}{a.team ? ` · ${a.team}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
