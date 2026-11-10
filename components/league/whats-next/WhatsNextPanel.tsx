'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CircleHelp, Clock } from 'lucide-react'
import {
  engineFacts,
  lifecycleFacts,
  whatsNextEndpoint,
  whatsNextFormatFor,
  type LifecycleLeague,
  type WhatsNextLeagueLike,
} from '@/lib/league/whats-next/adapters'
import { isEngineFormat } from '@/lib/league/whats-next/formatPhaseGuides'
import { resolveWhatsNext } from '@/lib/league/whats-next/resolveWhatsNext'
import { hasSeenWalkthrough, markWalkthroughSeen, walkthroughFor } from '@/lib/league/whats-next/formatWalkthroughs'
import type { WhatsNextFacts } from '@/lib/league/whats-next/types'
import { FormatWalkthrough } from './FormatWalkthrough'
import './whats-next.css'

const REFRESH_MS = 60_000

/** "2d 4h", "3h 12m", "12m 30s" — coarse when far away, to the second in the last hour. */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'now'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor(s / 3600) % 24
  const m = Math.floor(s / 60) % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

function Countdown({ iso }: { iso: string }) {
  const target = Date.parse(iso)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const when = Number.isFinite(target)
    ? new Date(target).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <span className="wn-countdown" data-testid="whats-next-countdown">
      {/* The ticking part renders only on the client, so server and client HTML agree. */}
      <strong>{now == null ? '…' : formatTimeLeft(target - now)}</strong>
      {when ? <span className="wn-when"> · {when}</span> : null}
    </span>
  )
}

/**
 * "What's next?" — the first thing on League Home. Says what phase the league is in, in plain English;
 * whether the viewer has to act or wait; who the league is waiting on and for how long; and, when the
 * viewer has to act, a button straight to it. The commissioner, the manager who has to act and
 * everyone else each get their own line (lib/league/whats-next/resolveWhatsNext.ts).
 *
 * Driven by the format's phase config (lib/league/whats-next/formatPhaseGuides.ts) and the summary
 * that format already serves, so it works the same for Big Brother, Survivor, Zombie, Guillotine,
 * Pirate, tournaments and every lifecycle format. Renders nothing if the summary cannot be read.
 */
export function WhatsNextPanel({
  league,
  userId,
  isCommissioner,
  hasTeam = true,
  draftDateIso,
  availableTabIds,
  onSelectTab,
  autoOpenWalkthrough = false,
}: {
  league: WhatsNextLeagueLike & LifecycleLeague
  userId: string | null
  isCommissioner: boolean
  hasTeam?: boolean
  draftDateIso: string | null
  availableTabIds?: readonly string[]
  onSelectTab: (tab: string) => void
  /** The commissioner just created this league and the post-create welcome has finished. */
  autoOpenWalkthrough?: boolean
}) {
  const format = whatsNextFormatFor(league)
  const engine = isEngineFormat(format) ? format : null
  const [payload, setPayload] = useState<{ ok: true; data: unknown } | { ok: false } | null>(null)
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  const walkthrough = walkthroughFor(format)

  useEffect(() => {
    if (!engine) return
    let cancelled = false
    const load = () =>
      fetch(whatsNextEndpoint(league.id, engine), { cache: 'no-store', credentials: 'include' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data) => !cancelled && setPayload({ ok: true, data }))
        .catch(() => !cancelled && setPayload((prev) => (prev?.ok ? prev : { ok: false })))
    void load()
    // A phase can change while the page sits open (the HOH nominates, a council closes).
    const id = window.setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [league.id, engine])

  // First Big Brother (Survivor, …) league this commissioner has created: open the walkthrough once.
  useEffect(() => {
    if (!autoOpenWalkthrough || !isCommissioner || !walkthrough) return
    if (hasSeenWalkthrough(userId, format)) return
    setWalkthroughOpen(true)
  }, [autoOpenWalkthrough, isCommissioner, walkthrough, userId, format])

  const facts: WhatsNextFacts | null = useMemo(() => {
    if (!engine) return lifecycleFacts(format, league, draftDateIso)
    if (!payload?.ok) return null
    return engineFacts(engine, payload.data)
  }, [engine, format, league, draftDateIso, payload])

  const view = facts ? resolveWhatsNext(facts, { isCommissioner, hasTeam }) : null
  if (!view) return null

  const action = view.action
  const actionAvailable = action ? (action.href ? true : !availableTabIds || (action.tab != null && availableTabIds.includes(action.tab))) : false
  const statusLabel = view.status === 'act' ? (view.shared ? 'To do' : 'Your turn') : view.status === 'done' ? 'Done' : 'Waiting'

  return (
    <section
      className="wn"
      data-status={view.status}
      data-role={view.role}
      data-format={view.format}
      data-phase={view.phase}
      aria-labelledby="wn-title"
      data-testid="whats-next"
    >
      <div className="wn-head">
        <span className="wn-kicker">
          What&rsquo;s next? <span className="wn-format">· {view.formatLabel}</span>
        </span>
        <span className="wn-head-right">
          <span className="wn-chip" data-status={view.status} data-testid="whats-next-status">
            {statusLabel}
          </span>
          {walkthrough ? (
            <button
              type="button"
              className="wn-icon-btn"
              onClick={() => setWalkthroughOpen(true)}
              aria-label={`How ${view.formatLabel} works`}
              title={`How ${view.formatLabel} works`}
              data-testid="whats-next-help"
            >
              <CircleHelp size={18} aria-hidden />
            </button>
          ) : null}
        </span>
      </div>

      <h2 id="wn-title" className="wn-title" data-testid="whats-next-title">
        {view.title}
      </h2>
      <p className="wn-message" aria-live="polite" data-testid="whats-next-message">
        {view.message}
      </p>
      {view.commissionerNote ? (
        <p className="wn-note" data-testid="whats-next-commissioner-note">
          <span className="wn-note-tag">Commissioner</span> {view.commissionerNote}
        </p>
      ) : null}

      {view.waitingOn || view.deadlineIso ? (
        <dl className="wn-meta">
          {view.waitingOn ? (
            <div>
              <dt>Waiting on</dt>
              <dd data-testid="whats-next-waiting-on">{view.waitingOn}</dd>
            </div>
          ) : null}
          {view.deadlineIso ? (
            <div>
              <dt>
                <Clock size={14} aria-hidden /> {view.deadlineLabel ?? 'Deadline'}
              </dt>
              <dd>
                <Countdown iso={view.deadlineIso} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {action && actionAvailable ? (
        <div className="wn-actions">
          {action.href ? (
            <Link href={action.href} className="wn-btn wn-btn--primary" data-testid="whats-next-action">
              {action.label} <ArrowRight size={16} aria-hidden />
            </Link>
          ) : (
            <button
              type="button"
              className={view.status === 'act' ? 'wn-btn wn-btn--primary' : 'wn-btn'}
              onClick={() => action.tab && onSelectTab(action.tab)}
              data-testid="whats-next-action"
            >
              {action.label} <ArrowRight size={16} aria-hidden />
            </button>
          )}
        </div>
      ) : null}

      {walkthrough ? (
        <FormatWalkthrough
          walkthrough={walkthrough}
          open={walkthroughOpen}
          onClose={() => {
            setWalkthroughOpen(false)
            markWalkthroughSeen(userId, format)
          }}
        />
      ) : null}
    </section>
  )
}
