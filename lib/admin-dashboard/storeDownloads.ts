import type { AppStoreDownloadsResult } from '@/lib/app-store/appStoreDownloads'
import type { PlayInstallStatsResult } from '@/lib/google-play/playInstallStats'

/**
 * The two download cards on /admin/apps, from each store's own report. Pure.
 * "Not connected" and "couldn't read" carry no number at all — never a zero.
 */

export type StoreCard = {
  store: 'apple' | 'google'
  label: string
  state: 'ok' | 'not_configured' | 'error'
  /** Downloads in the window ending at `through`. Null unless state is ok. */
  count: number | null
  /** One short line under the number (re-downloads, scope, lag). */
  detail: string | null
  /** Newest report day included (YYYY-MM-DD). The stores publish late, so this is never today. */
  through: string | null
  /** Settings still to add, when not connected; the failure reason, when it failed. */
  problem: string | null
  consoleUrl: string
}

export const APPLE_CONSOLE_URL = 'https://appstoreconnect.apple.com/analytics'
export const GOOGLE_CONSOLE_URL = 'https://play.google.com/console'

const fmt = (n: number) => n.toLocaleString('en-US')

export function appleCard(result: AppStoreDownloadsResult): StoreCard {
  const base = { store: 'apple' as const, label: 'App Store', consoleUrl: APPLE_CONSOLE_URL }
  if (result.status === 'not_configured') {
    return { ...base, state: 'not_configured', count: null, detail: null, through: null, problem: `Add ${result.missing.join(', ')}` }
  }
  if (result.status === 'error') return { ...base, state: 'error', count: null, detail: null, through: null, problem: result.reason }
  const downloads = result.days.reduce((s, d) => s + d.downloads, 0)
  const redownloads = result.days.reduce((s, d) => s + d.redownloads, 0)
  const parts = [`${fmt(redownloads)} re-downloads`]
  if (!result.scopedToApp) parts.push('every app on the account')
  return { ...base, state: 'ok', count: downloads, detail: parts.join(' · '), through: result.through, problem: null }
}

export function googleCard(result: PlayInstallStatsResult, days: number): StoreCard {
  const base = { store: 'google' as const, label: 'Google Play', consoleUrl: GOOGLE_CONSOLE_URL }
  if (result.status === 'not_configured') {
    return { ...base, state: 'not_configured', count: null, detail: null, through: null, problem: `Add ${result.missing.join(', ')}` }
  }
  if (result.status === 'error') return { ...base, state: 'error', count: null, detail: null, through: null, problem: result.reason }
  const { latestDate, daily } = result.stats
  if (!latestDate) return { ...base, state: 'ok', count: 0, detail: null, through: null, problem: null }
  const from = new Date(Date.parse(`${latestDate}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const count = daily.filter((d) => d.date >= from && d.date <= latestDate).reduce((s, d) => s + d.installs, 0)
  return { ...base, state: 'ok', count, detail: `${fmt(result.stats.installsAllTime)} all time`, through: latestDate, problem: null }
}
