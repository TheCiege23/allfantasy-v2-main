import { lineupVerificationMessages } from '@/lib/core-app/messages/lineupVerification'
import { messagesFor } from '@/lib/i18n/messages'

export type LineupVerification = { checkedAt: string; week: number | null; source: 'Sleeper'; slots: string[] }

export function verificationAge(checkedAt: string, now: number, language: string | null | undefined = 'en'): string {
  const m = messagesFor(lineupVerificationMessages, language)
  const age = now - Date.parse(checkedAt)
  if (!Number.isFinite(age) || age < -60000) return m.timeUnavailable
  const minutes = Math.max(0, Math.floor(age / 60000))
  return minutes === 0 ? m.checkedJustNow : minutes < 60 ? m.checkedMinutesAgo(minutes) : m.checkedHoursAgo(Math.floor(minutes / 60))
}

/** Static alerts use an absolute time so an open dashboard never says 'just now' forever. */
export function verificationStamp(checkedAt: string, language: 'en' | 'es' = 'en'): string {
  const m = messagesFor(lineupVerificationMessages, language)
  const date = new Date(checkedAt)
  if (!Number.isFinite(date.getTime())) return m.timeUnavailable
  const iso = date.toISOString()
  return `${m.checked} ${iso.slice(11, 16)} UTC · ${iso.slice(0, 10)}`
}
