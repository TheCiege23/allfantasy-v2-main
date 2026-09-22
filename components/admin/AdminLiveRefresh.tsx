'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { emitAdminRefresh } from '@/components/admin/adminRefreshSignal'

/**
 * Keeps /admin current while the tab is open.
 *
 * The page is `force-dynamic` and the service worker never caches `/admin`, so
 * every LOAD was live — but nothing ever re-loaded. An operator who left the
 * Command Center open read the numbers from whenever they opened it, under a
 * header stamp that looked like a live clock and was really a fossil.
 *
 * Same shape as core-app/MatchupPulseRefresh: `router.refresh()` re-runs the
 * server component that already builds the metrics, so there is no second data
 * path and no new route.
 *
 * ⚠ THE AGE IS READ FROM THE SERVER'S `generatedAt`, NOT FROM A CLIENT CLOCK
 * RESET ON REQUEST. A refresh that fails leaves `generatedAt` where it was, so
 * the label keeps climbing and turns amber — which is the only honest thing it
 * can do. Stamping on request would report a failed refresh as fresh.
 */

/**
 * ⚠ The full metrics set is dozens of queries, so this is not a live ticker.
 * A minute is current enough for an operator console, and prod's compute has
 * scale-to-zero disabled, so a visible-tab poll does not change the floor.
 */
const POLL_MS = 60_000
/** Returning to a tab catches up at once if the data is older than this. */
const CATCH_UP_MS = 30_000
/** Three missed periods means refreshes are failing, not just waiting. */
const STALE_MS = POLL_MS * 3

function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function AdminLiveRefresh({ generatedAt }: { generatedAt: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const generatedMs = new Date(generatedAt).getTime()

  // Starts null and is set in an effect: Date.now() during render would differ
  // between server and client and break hydration.
  const [now, setNow] = useState<number | null>(null)

  const pendingRef = useRef(false)
  pendingRef.current = pending
  const generatedRef = useRef(generatedMs)
  generatedRef.current = generatedMs

  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  /*
   * A new `generatedAt` is the server saying a refresh COMPLETED — that is the
   * moment the client-fetched panels should follow, not when one is requested.
   * Skipped on mount: those panels are fetching for the first time already.
   */
  const firstGenerated = useRef(generatedAt)
  useEffect(() => {
    if (generatedAt !== firstGenerated.current) emitAdminRefresh()
  }, [generatedAt])

  const refresh = useCallback(() => {
    if (pendingRef.current) return
    startTransition(() => router.refresh())
  }, [router])

  useEffect(() => {
    const tick = () => {
      // A hidden tab does not poll; the visibility listener catches up on return.
      if (document.visibilityState !== 'visible') return
      // A refresh can outlast the period; never stack a second one on it.
      if (pendingRef.current) return
      // Do not re-render the console under someone mid-way through a form.
      if (isTyping()) return
      refresh()
    }
    const id = window.setInterval(tick, POLL_MS)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - generatedRef.current > CATCH_UP_MS) tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  const age = now === null ? null : now - generatedMs
  const stale = age !== null && age > STALE_MS
  const clock = new Date(generatedAt).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={pending}
      data-testid="admin-live-refresh"
      data-stale={stale ? 'true' : 'false'}
      title={`Data generated ${clock} ET · auto-refreshes every ${POLL_MS / 1000}s while this tab is visible. Click to refresh now.`}
      className={stale ? 'af-cc-stamp af-cc-stamp--stale' : 'af-cc-stamp'}
      style={{ background: 'none', border: 0, padding: 0, cursor: pending ? 'progress' : 'pointer' }}
    >
      {pending ? 'refreshing…' : `refreshed ${age === null ? clock : formatAge(age)}`}
      {stale && !pending ? ' · stale' : ''}
    </button>
  )
}
