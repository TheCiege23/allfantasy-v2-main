import { isNativePlatform } from '@/lib/league/isNativeLeague'

/** Native copies keep their source history, but their current platform owns navigation. */
export function leagueEntryHref(league: { id: string; platform?: string | null }): string {
  const id = encodeURIComponent(league.id)
  return isNativePlatform(league.platform?.trim()) ? `/league/${id}` : `/core?league=${id}`
}
