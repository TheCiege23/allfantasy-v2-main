'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { HubPreviewClient } from '../league-settings-hub/HubPreviewClient'

/**
 * The League settings tab inside the real /core shell, DB-free (2026-11-15): a Sleeper league held, so
 * the rail shows the league's own groups and its one "All leagues" row, Notifications sits in the top
 * bar with a count, and the hub is the imported league's read-only mirror. `native` swaps in an
 * AllFantasy-run league, where the commissioner keeps the hub's edit controls.
 */
export function LeagueSettingsGuideClient({ native, tab }: { native: boolean; tab: string }) {
  const league = native
    ? { id: 'e2e-ls-native', name: 'Kingdom North', platform: 'allfantasy', mark: 'KN', sport: 'NFL' }
    : { id: 'e2e-ls-sleeper', name: 'AFC Dreaming!', platform: 'sleeper', mark: 'AD', sport: 'NFL' }
  const other = { id: 'e2e-ls-other', name: 'Office Dynasty', platform: 'sleeper', mark: 'OD', sport: 'NFL' }
  return (
    <AfCoreShell
      active="league-settings"
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague={native}
      notificationCount={7}
      commissionerCount={1}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      {/* The same wrapper LeagueSettingsScreen draws, so the /core surface rules apply here too. */}
      <div className="af-core-league-settings" data-testid="league-settings-guide">
        <HubPreviewClient
          type="redraft"
          role={native ? 'commish' : 'manager'}
          tab={tab}
          native={native}
          importedFrom={native ? null : 'Sleeper'}
          embedded
        />
      </div>
    </AfCoreShell>
  )
}
