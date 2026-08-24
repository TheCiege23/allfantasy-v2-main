/**
 * "Sep 3" — the calendar day of a kickoff instant.
 *
 * ⚠ CLIENT-SAFE ON PURPOSE: no 'server-only', no prisma. Client screens import
 * this to render the phase-aware empty states, and importing anything
 * server-only from a 'use client' file 500s the whole /core catch-all — see
 * the header of lib/core-app/weekBoardRules.ts for the incident.
 *
 * Locale and zone are PINNED so the server paint and the client hydration
 * produce the same string — an `undefined` locale would ask two different
 * machines for their own answer. America/New_York because NFL schedule days
 * are published in Eastern time: the Thursday opener at 00:20 UTC is, to
 * every reader of an NFL schedule, the evening of the day before.
 */
export function kickoffDayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    }).format(d)
  } catch {
    return null
  }
}
