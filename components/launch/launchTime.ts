/**
 * Pure helpers behind the launch countdown — no React, no server imports, so the countdown, the
 * banners and their tests share one definition of "how long is left" and one way of naming the day.
 */
import { formatPaywallDay } from '@/lib/core-app/coreDepthAccess'

export type LaunchLang = 'en' | 'es'

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number }

/** Whole days/hours/minutes/seconds left, or null once the moment has passed. */
export function splitRemaining(ms: number): CountdownParts | null {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const total = Math.floor(ms / 1000)
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  }
}

/**
 * The launch day as a US Eastern calendar date — "Oct 15" / "15 de octubre". Fixed time zone on
 * purpose: server and browser must print the same string or hydration breaks, and the owner's
 * launch is midnight Eastern whatever time zone the reader is in.
 */
export function formatLaunchDay(startsAtIso: string, lang: LaunchLang = 'en'): string {
  if (lang === 'en') return formatPaywallDay(startsAtIso)
  const d = new Date(startsAtIso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', timeZone: 'America/New_York' }).format(d)
}

const UNIT_WORDS: Record<LaunchLang, Record<'day' | 'hour' | 'minute', [string, string]>> = {
  en: { day: ['day', 'days'], hour: ['hour', 'hours'], minute: ['minute', 'minutes'] },
  es: { day: ['día', 'días'], hour: ['hora', 'horas'], minute: ['minuto', 'minutos'] },
}

/**
 * "19 days, 4 hours and 12 minutes" — what a screen reader gets instead of the ticking digits.
 * Minute granularity on purpose: nothing about the second is worth hearing.
 */
export function describeRemaining(parts: CountdownParts, lang: LaunchLang = 'en'): string {
  const words = UNIT_WORDS[lang]
  const unit = (n: number, key: 'day' | 'hour' | 'minute') => `${n} ${n === 1 ? words[key][0] : words[key][1]}`
  const bits: string[] = []
  if (parts.days > 0) bits.push(unit(parts.days, 'day'))
  if (parts.days > 0 || parts.hours > 0) bits.push(unit(parts.hours, 'hour'))
  bits.push(unit(parts.minutes, 'minute'))
  const and = lang === 'es' ? ' y ' : ' and '
  return bits.length === 1 ? bits[0]! : `${bits.slice(0, -1).join(', ')}${and}${bits[bits.length - 1]}`
}

/** Short unit labels under the digits. */
export const UNIT_LABELS: Record<LaunchLang, { days: string; hours: string; minutes: string; seconds: string }> = {
  en: { days: 'days', hours: 'hrs', minutes: 'min', seconds: 'sec' },
  es: { days: 'días', hours: 'h', minutes: 'min', seconds: 'seg' },
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
