/**
 * The lineup lock, read from a kickoff instant — "locks in 42 min", "locks
 * Sun 1:00p ET", "locked · kicked off Sun 1:00p ET".
 *
 * ⚠ CLIENT-SAFE ON PURPOSE: no 'server-only', no prisma. The countdown ticks
 * in the browser (LockClock.tsx), and importing anything server-only from a
 * 'use client' file 500s the whole /core catch-all.
 *
 * Locale and zone are PINNED so the server paint and the client hydration
 * produce the same string — see lib/core-app/kickoffLabel.ts for why Eastern.
 *
 * A per-player lock: every launch platform locks a player at his own kickoff
 * by default. A league configured to lock every lineup at the week's FIRST
 * game locks earlier than this says; nothing on disk records that setting
 * yet, so the banner names the kickoff and does not claim the league rule.
 */

export type LockState = {
  /** `soon` inside SOON_MINUTES of kickoff; `locked` once it has kicked off. */
  state: 'open' | 'soon' | 'locked'
  /** Whole minutes to kickoff; negative once it has passed. */
  minutes: number
  /** "locks in 42 min" · "locks in 3h 10m" · "locks Sun 1:00p ET" · "locked · kicked off Sun 1:00p ET" */
  label: string
  /** "Sun 1:00p ET" */
  clock: string
}

export const SOON_MINUTES = 120
export const LOCK_ZONE = 'America/New_York'

/** "Sun 1:00p ET" — the kickoff on a schedule reader's clock. */
export function kickoffClock(iso: string, timeZone: string = LOCK_ZONE): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: LOCK_ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  }
  const get = (t: Intl.DateTimeFormatPart['type']) => parts.find((p) => p.type === t)?.value ?? ''
  const ampm = get('dayPeriod').toLowerCase().startsWith('p') ? 'p' : 'a'
  const zone = timeZone === LOCK_ZONE ? 'ET' : timeZone
  return `${get('weekday')} ${get('hour')}:${get('minute')}${ampm} ${zone}`
}

export function lockState(kickoffIso: string, nowIso: string, soonMinutes: number = SOON_MINUTES): LockState {
  const kickoff = new Date(kickoffIso).getTime()
  const now = new Date(nowIso).getTime()
  const clock = kickoffClock(kickoffIso)
  if (Number.isNaN(kickoff) || Number.isNaN(now)) return { state: 'open', minutes: 0, label: clock ? `locks ${clock}` : 'lock time unknown', clock }
  const minutes = Math.ceil((kickoff - now) / 60000)
  if (minutes <= 0) return { state: 'locked', minutes, label: `locked · kicked off ${clock}`, clock }
  if (minutes < 60) return { state: 'soon', minutes, label: `locks in ${minutes} min`, clock }
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (minutes < soonMinutes) return { state: 'soon', minutes, label: `locks in ${h}h ${m}m`, clock }
  if (minutes < 24 * 60) return { state: 'open', minutes, label: `locks in ${h}h ${m}m`, clock }
  return { state: 'open', minutes, label: `locks ${clock}`, clock }
}
