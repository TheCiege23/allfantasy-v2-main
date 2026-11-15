'use client'

import { useRouter } from 'next/navigation'
import { LeagueSettingsHub } from '@/components/league-settings/hub/LeagueSettingsHub'
import { isNativePlatform } from '@/lib/dashboard/platform-label'

/**
 * League settings inside /core (2026-11-15) — the League Settings hub the /league app already shows,
 * modelled on Sleeper's settings page: My Settings, League Setup, Members, Record Book.
 *
 * ⚠ AN IMPORTED LEAGUE IS A READ-ONLY MIRROR, AND THE HUB ALREADY KNOWS IT. It marks the page
 * "Read-only mirror", says the rules sync from the host, and draws no edit control — so this screen
 * hands it nothing to edit with: no editor route, no "Advanced settings", no leave action (leaving
 * an imported league happens on its platform).
 *
 * An AllFantasy league's commissioner edits in the editors the /league app owns; an Edit button opens
 * that editor there through its `?settingsPanel=` deep link rather than this screen growing copies.
 */
export function LeagueSettingsScreen({
  league,
  userId,
}: {
  league: {
    id: string
    name: string
    platform: string
    sport?: string | null
    imageUrl?: string | null
    isCommissioner?: boolean
  }
  userId: string
}) {
  const router = useRouter()
  const native = isNativePlatform(String(league.platform ?? '').trim().toLowerCase() || 'manual')
  const commissioner = native && Boolean(league.isCommissioner)
  const legacy = `/league/${encodeURIComponent(league.id)}`

  return (
    <div className="af-core-league-settings" data-testid="core-league-settings" data-native={native ? 'true' : 'false'}>
      <LeagueSettingsHub
        league={{
          id: league.id,
          name: league.name,
          platform: league.platform,
          sport: league.sport ?? null,
          logoUrl: league.imageUrl ?? null,
        }}
        userId={userId}
        isHeadCommissioner={commissioner}
        onOpenEditor={(panelId) => {
          if (native) router.push(`${legacy}?settingsPanel=${encodeURIComponent(panelId)}`)
        }}
        advanced={commissioner ? { label: 'Advanced settings', onOpen: () => router.push(`${legacy}?tab=settings`) } : undefined}
      />
    </div>
  )
}

export default LeagueSettingsScreen
