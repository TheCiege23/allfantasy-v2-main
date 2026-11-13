'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { LeagueSettingsHub } from '@/components/league-settings/hub/LeagueSettingsHub'
import { LeagueSettingsTab as LegacyLeagueSettingsTab } from './LeagueSettingsTab'

/**
 * The league Settings tab: the Sleeper-parity hub by default. Commissioners keep one tap to
 * the full legacy editor ("Advanced settings") for the long tail it covers that the hub
 * links out to rather than duplicates — timezone, keeper slots, dispersal drafts, resets.
 */
export function LeagueSettingsHubTab({
  league,
  viewerUserId,
  isCommissioner,
  isHeadCommissioner,
  onOpenEditor,
  onLeaveLeague,
}: {
  league: UserLeague
  viewerUserId: string
  isCommissioner: boolean
  isHeadCommissioner: boolean
  onOpenEditor: (panelId: string) => void
  onLeaveLeague?: () => void
}) {
  const [advanced, setAdvanced] = useState(false)

  if (advanced) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => setAdvanced(false)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-white/15 px-4 text-[12px] font-bold text-white/85 hover:border-[#ff3d81]/50"
            data-testid="league-settings-hub-back"
          >
            ← Back to settings
          </button>
        </div>
        <LegacyLeagueSettingsTab leagueId={league.id} isCommissioner={isCommissioner} isHeadCommissioner={isHeadCommissioner} />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-4 sm:px-5">
      <LeagueSettingsHub
        league={{
          id: league.id,
          name: league.name,
          avatarUrl: league.avatarUrl ?? null,
          logoUrl: league.logoUrl ?? null,
          platform: league.platform,
          sport: league.sport,
          season: Number(league.season) || null,
          leagueSize: league.teamCount,
          leagueType: league.leagueType ?? null,
          leagueVariant: league.leagueVariant ?? null,
          isDynasty: league.isDynasty ?? null,
          bestBallMode: league.bestBallMode ?? null,
          guillotineMode: league.guillotineMode ?? null,
          settings: league.settings,
        }}
        userId={viewerUserId}
        isHeadCommissioner={isHeadCommissioner}
        onOpenEditor={onOpenEditor}
        onLeaveLeague={onLeaveLeague}
        advanced={isCommissioner ? { label: 'Advanced settings', onOpen: () => setAdvanced(true) } : undefined}
      />
    </div>
  )
}
