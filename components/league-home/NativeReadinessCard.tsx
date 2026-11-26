'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NativeReadinessItem, NativeReadinessReport } from '@/lib/league/nativeReadiness'

/**
 * "Could this league switch to running on AllFantasy?" for the commissioner of an imported league.
 *
 * Read-only: it shows what the in-place switch would refuse on today
 * (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §9 gap 3), so a commissioner can fix the
 * fixable in the season before they switch. There is no switch button yet, and the card says so
 * rather than linking to the copy flow.
 *
 * Renders nothing for a native league, or for anyone the route refuses (a co-commissioner — the switch
 * is the head commissioner's call).
 */

type Load =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'error' }
  | { kind: 'ok'; report: NativeReadinessReport }

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} hr ago` : `${Math.round(hours / 24)} d ago`
}

function ItemRow({ item, index }: { item: NativeReadinessItem; index?: number }) {
  return (
    <li className="flex gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3" data-testid={`native-readiness-item-${item.code}`}>
      {index != null ? (
        <span className="af-readiness-index flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black" aria-hidden>{index}</span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-white">{item.title}</p>
        {item.names?.length ? (
          <p className="mt-0.5 text-xs leading-5 text-white/70">
            {item.names.join(', ')}{item.more ? `, and ${item.more} more` : ''}
          </p>
        ) : null}
        <p className="mt-1 text-xs leading-5 text-white/50">{item.action}</p>
      </div>
    </li>
  )
}

export function NativeReadinessView({ report, onRecheck, rechecking = false, now = Date.now() }: {
  report: NativeReadinessReport
  onRecheck?: () => void
  rechecking?: boolean
  now?: number
}) {
  if (report.status === 'native') return null
  const blockers = report.items.filter((item) => item.severity === 'blocker')
  const headsUps = report.items.filter((item) => item.severity === 'heads_up')
  const source = report.platformLabel ?? 'your platform'
  const ready = blockers.length === 0
  return (
    <section
      className="af-readiness rounded-2xl border border-white/[0.08] p-4"
      data-testid="native-readiness-card"
      data-status={report.status}
      aria-labelledby="native-readiness-title"
    >
      <p className="af-admin-eyebrow text-[11px] font-black uppercase tracking-[0.18em]">Switch to AllFantasy</p>
      <h3 id="native-readiness-title" className="mt-1 text-base font-black text-white">
        {ready ? 'Ready to switch' : `${blockers.length} ${blockers.length === 1 ? 'thing' : 'things'} to fix before this league can switch`}
      </h3>
      <p className="mt-1 text-xs leading-5 text-white/60">
        Switching stops syncing from {source}. The league keeps its teams, names, logos, chat and history, and runs on AllFantasy from then on.
      </p>

      {blockers.length ? (
        <ol className="mt-3 space-y-2">
          {blockers.map((item, i) => <ItemRow key={item.code} item={item} index={i + 1} />)}
        </ol>
      ) : null}

      {headsUps.length ? (
        <div className="mt-3">
          <p className="text-xs font-black text-white/70">Before you switch</p>
          <ul className="mt-2 space-y-2">
            {headsUps.map((item) => <ItemRow key={item.code} item={item} />)}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-white/50" data-testid="native-readiness-note">
          The switch itself arrives in a later update. Checked {ago(report.checkedAt, now)}.
        </p>
        {onRecheck ? (
          <button
            type="button"
            onClick={onRecheck}
            disabled={rechecking}
            className="min-h-[44px] rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-extrabold text-white/80 disabled:opacity-55"
            data-testid="native-readiness-recheck"
          >
            {rechecking ? 'Checking…' : 'Check again'}
          </button>
        ) : null}
      </div>
    </section>
  )
}

export function NativeReadinessCard({ leagueId }: { leagueId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [rechecking, setRechecking] = useState(false)

  const fetchReport = useCallback(async () => {
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/native-readiness`, { cache: 'no-store' })
    if (res.status === 401 || res.status === 403 || res.status === 404) return { kind: 'hidden' } as const
    if (!res.ok) return { kind: 'error' } as const
    return { kind: 'ok', report: (await res.json()) as NativeReadinessReport } as const
  }, [leagueId])

  useEffect(() => {
    let live = true
    fetchReport().then((next) => { if (live) setLoad(next) }).catch(() => { if (live) setLoad({ kind: 'error' }) })
    return () => { live = false }
  }, [fetchReport])

  const recheck = useCallback(() => {
    setRechecking(true)
    fetchReport().then(setLoad).catch(() => setLoad({ kind: 'error' })).finally(() => setRechecking(false))
  }, [fetchReport])

  if (load.kind === 'hidden') return null
  if (load.kind === 'loading') {
    return <section className="af-readiness rounded-2xl border border-white/[0.08] p-4 text-xs text-white/50" data-testid="native-readiness-card" data-status="loading">Checking whether this league can switch to AllFantasy…</section>
  }
  if (load.kind === 'error') {
    return (
      <section className="af-readiness rounded-2xl border border-white/[0.08] p-4 text-xs text-white/60" data-testid="native-readiness-card" data-status="error">
        We couldn&apos;t check whether this league can switch to AllFantasy.{' '}
        <button type="button" onClick={recheck} className="font-extrabold underline">Try again</button>
      </section>
    )
  }
  return <NativeReadinessView report={load.report} onRecheck={recheck} rechecking={rechecking} />
}
