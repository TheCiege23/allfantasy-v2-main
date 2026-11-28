'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeReadinessItem, NativeReadinessReport } from '@/lib/league/nativeReadiness'
import { NATIVE_SWITCH_ANCHOR } from '@/lib/league/makeNativeLeague'

/**
 * "Switch to AllFantasy" for the head commissioner of an imported league: what would stop the in-place switch today
 * (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §9 gap 3), and — once nothing does — the switch itself
 * (`POST /api/leagues/[leagueId]/convert-to-native`, step 7). Every "Switch to AllFantasy" link in the app lands here
 * (lib/league/makeNativeLeague.ts).
 *
 * Two steps on purpose: the button opens a short "what happens" list, and only "Switch now" writes. A baseball league
 * must also accept one lineup a week (native baseball scores weekly), which the switch route refuses without.
 *
 * Renders nothing for a native league, or for anyone the route refuses (a co-commissioner — the switch is the head
 * commissioner's call).
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

export type SwitchState = { confirming: boolean; busy?: boolean; weeklyLineups?: boolean; error?: string | null }

export function NativeReadinessView({ report, onRecheck, rechecking = false, now = Date.now(), switchState, onStartSwitch, onCancelSwitch, onConfirmSwitch, onWeeklyLineups }: {
  report: NativeReadinessReport
  onRecheck?: () => void
  rechecking?: boolean
  now?: number
  switchState?: SwitchState
  onStartSwitch?: () => void
  onCancelSwitch?: () => void
  onConfirmSwitch?: () => void
  onWeeklyLineups?: (accepted: boolean) => void
}) {
  if (report.status === 'native') return null
  const blockers = report.items.filter((item) => item.severity === 'blocker')
  const headsUps = report.items.filter((item) => item.severity === 'heads_up')
  const source = report.platformLabel ?? 'your platform'
  const ready = blockers.length === 0
  const baseball = report.sport === 'MLB'
  const confirming = ready && switchState?.confirming === true
  const busy = switchState?.busy === true
  return (
    <section
      id={NATIVE_SWITCH_ANCHOR}
      className="af-readiness scroll-mt-4 rounded-2xl border border-white/[0.08] p-4"
      data-testid="native-readiness-card"
      data-status={report.status}
      data-state={confirming ? 'confirming' : 'idle'}
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

      {confirming ? (
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/20 p-3" data-testid="native-switch-confirm">
          <p className="text-sm font-black text-white">When you switch</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-white/70">
            <li>The league stops syncing from {source}. Trades, waivers and the draft happen on AllFantasy.</li>
            <li>Every manager keeps their team. Unclaimed teams each get their own invite link in League settings.</li>
            <li>You can undo it from this tab until the league&apos;s first season on AllFantasy starts.</li>
          </ul>
          {baseball ? (
            <label className="mt-3 flex min-h-[44px] items-start gap-2 text-xs leading-5 text-white/80" data-testid="native-switch-weekly">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={switchState?.weeklyLineups === true}
                onChange={(event) => onWeeklyLineups?.(event.currentTarget.checked)}
              />
              <span>Set lineups once a week. AllFantasy baseball scores one lineup per week; your daily lineups from {source} stay in the league&apos;s history.</span>
            </label>
          ) : null}
          {switchState?.error ? <p className="mt-2 text-xs font-bold text-amber-200" role="alert" data-testid="native-switch-error">{switchState.error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConfirmSwitch}
              disabled={busy || (baseball && switchState?.weeklyLineups !== true)}
              className="af-readiness-primary min-h-[44px] rounded-lg px-4 text-xs font-extrabold disabled:opacity-55"
              data-testid="native-switch-confirm-button"
            >
              {busy ? 'Switching…' : 'Switch now'}
            </button>
            <button type="button" onClick={onCancelSwitch} disabled={busy} className="min-h-[44px] rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-extrabold text-white/80 disabled:opacity-55">
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/50" data-testid="native-readiness-note">
            {ready ? '' : 'Fix these, then check again. '}Checked {ago(report.checkedAt, now)}.
          </p>
          <div className="flex flex-wrap gap-2">
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
            {ready && onStartSwitch ? (
              <button
                type="button"
                onClick={onStartSwitch}
                className="af-readiness-primary min-h-[44px] rounded-lg px-4 text-xs font-extrabold"
                data-testid="native-switch-start"
              >
                Switch to AllFantasy
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

export function NativeReadinessCard({ leagueId }: { leagueId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [rechecking, setRechecking] = useState(false)
  const [switchState, setSwitchState] = useState<SwitchState>({ confirming: false })
  const scrolled = useRef(false)

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

  // "Switch to AllFantasy" links land on `#native-switch`; the card arrives after its fetch, so scroll once it is here.
  useEffect(() => {
    if (load.kind !== 'ok' || scrolled.current || typeof window === 'undefined') return
    if (window.location.hash !== `#${NATIVE_SWITCH_ANCHOR}`) return
    scrolled.current = true
    document.getElementById(NATIVE_SWITCH_ANCHOR)?.scrollIntoView({ block: 'start' })
  }, [load])

  const recheck = useCallback(() => {
    setRechecking(true)
    fetchReport().then(setLoad).catch(() => setLoad({ kind: 'error' })).finally(() => setRechecking(false))
  }, [fetchReport])

  const confirmSwitch = useCallback(async () => {
    setSwitchState((s) => ({ ...s, busy: true, error: null }))
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/convert-to-native`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptWeeklyLineups: switchState.weeklyLineups === true }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; blockers?: NativeReadinessItem[] }
      if (res.ok) {
        // The league is AllFantasy's now: reload so every tab reads it that way (the undo card replaces this one).
        window.location.reload()
        return
      }
      if (res.status === 409 && body.blockers?.length && load.kind === 'ok') {
        // Something changed since the check: show what stops it now, in place of the confirm step.
        setLoad({ kind: 'ok', report: { ...load.report, status: 'blocked', items: [...body.blockers, ...load.report.items.filter((i) => i.severity === 'heads_up')] } })
        setSwitchState({ confirming: false })
        return
      }
      setSwitchState((s) => ({ ...s, busy: false, error: body.error ?? 'The switch did not complete, and nothing was changed. Try again.' }))
    } catch {
      setSwitchState((s) => ({ ...s, busy: false, error: 'The switch did not complete, and nothing was changed. Try again.' }))
    }
  }, [leagueId, load, switchState.weeklyLineups])

  if (load.kind === 'hidden') return null
  if (load.kind === 'loading') {
    return <section id={NATIVE_SWITCH_ANCHOR} className="af-readiness rounded-2xl border border-white/[0.08] p-4 text-xs text-white/50" data-testid="native-readiness-card" data-status="loading">Checking whether this league can switch to AllFantasy…</section>
  }
  if (load.kind === 'error') {
    return (
      <section id={NATIVE_SWITCH_ANCHOR} className="af-readiness rounded-2xl border border-white/[0.08] p-4 text-xs text-white/60" data-testid="native-readiness-card" data-status="error">
        We couldn&apos;t check whether this league can switch to AllFantasy.{' '}
        <button type="button" onClick={recheck} className="font-extrabold underline">Try again</button>
      </section>
    )
  }
  return (
    <NativeReadinessView
      report={load.report}
      onRecheck={recheck}
      rechecking={rechecking}
      switchState={switchState}
      onStartSwitch={() => setSwitchState({ confirming: true })}
      onCancelSwitch={() => setSwitchState({ confirming: false })}
      onConfirmSwitch={confirmSwitch}
      onWeeklyLineups={(accepted) => setSwitchState((s) => ({ ...s, weeklyLineups: accepted, error: null }))}
    />
  )
}
