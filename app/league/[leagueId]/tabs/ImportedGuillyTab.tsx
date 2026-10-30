'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ImportedGuillyTabData } from '@/lib/guillotine/importedGuillyHealthLoad'

/**
 * The Guilly tab for an imported league (lib/guillotine/importedGuillyView.ts): this week's scores among
 * the teams still alive with the chop line marked, who has been chopped and when — all from the
 * provider's own scores, and labelled that way. When the reliability check doubts the picture
 * (lib/guillotine/importedGuillyHealth.ts) the tab says so and points at the league's Sync screen.
 */
const PLATFORM_NAMES: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MyFantasyLeague',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: ImportedGuillyTabData }

export function ImportedGuillyTab({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<Loaded>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/imported`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) setState({ kind: 'error', message: typeof d?.error === 'string' ? d.error : 'Could not load the Guilly standings.' })
        else setState({ kind: 'ready', data: d as ImportedGuillyTabData })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error', message: 'Could not reach the server. Try again.' })
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (state.kind === 'loading') return <p className="p-4 text-[13px] text-white/50">Loading the Guilly standings…</p>
  if (state.kind === 'error') return <p role="alert" className="p-4 text-[13px] text-amber-300">{state.message}</p>

  const { data } = state
  const platform = PLATFORM_NAMES[data.platform] ?? 'your platform'
  const { view } = data
  const syncHref = `/core/sync?league=${encodeURIComponent(leagueId)}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 text-[#e6edf3] sm:p-4" data-testid="imported-guilly-tab">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Guilly</h2>
          <span className="text-[12px] text-white/55" data-testid="imported-guilly-source">Results from {platform}</span>
        </div>
        <p className="mt-1 text-[13px] text-white/60">
          {platform} runs this league&apos;s chops. AllFantasy reads them from its weekly scores and never chops a team here.
        </p>
        <p className="mt-3 text-[13px] text-white/80" data-testid="imported-guilly-summary">
          {view.teamsAlive} {view.teamsAlive === 1 ? 'team' : 'teams'} alive
          {view.chopped.length ? ` · ${view.chopped.length} chopped` : ''}
          {view.week != null ? ` · week ${view.week}` : ''}
        </p>
        {data.check.status === 'attention' ? (
          <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90" data-testid="imported-guilly-doubt">
            Some of this may be out of step with {platform}: {data.check.attention === 1 ? 'one thing needs' : `${data.check.attention} things need`} a look.{' '}
            <Link href={syncHref} className="font-semibold underline">See the Sync check</Link>
          </p>
        ) : data.check.format === 'detected' ? (
          <p className="mt-3 text-[12px] text-white/50" data-testid="imported-guilly-unconfirmed">
            We recognised this as a Guilly league from its name or settings. <Link href={syncHref} className="underline">Confirm it on the Sync screen</Link>.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">
          {view.week != null ? `Week ${view.week}` : 'This week'} · the chop line
        </h3>
        {view.scoredThisWeek === 0 ? (
          <p className="text-[13px] text-white/55" data-testid="imported-guilly-no-scores">No scores yet this week. The chop line shows once games are played.</p>
        ) : null}
        <ol className="space-y-1" data-testid="imported-guilly-standings">
          {view.standings.map((t, i) => (
            <li
              key={t.rosterId}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-[13px] ${t.onChopLine ? 'border border-rose-500/40 bg-rose-500/10' : 'bg-white/[0.02]'}`}
              data-testid={`imported-guilly-team-${t.rosterId}`}
            >
              <span className="text-white/90">
                <span className="mr-2 tabular-nums text-white/40">{i + 1}</span>
                {t.name}
                {t.onChopLine ? <span className="ml-2 text-[11px] font-semibold text-rose-300">on the chop line</span> : null}
              </span>
              <span className="tabular-nums text-white/80">{t.points.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      </section>

      {view.chopped.length ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">Chopped</h3>
          <ul className="space-y-1" data-testid="imported-guilly-chopped">
            {view.chopped.map((c) => (
              <li key={c.rosterId} className="flex justify-between text-[13px] text-white/70">
                <span>{c.name}</span>
                <span className="text-white/45">week {c.week}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
