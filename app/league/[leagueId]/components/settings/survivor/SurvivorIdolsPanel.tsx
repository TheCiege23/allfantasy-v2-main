'use client'

import { SurvivorIdolSetup } from '@/components/survivor/SurvivorIdolSetup'
import type { SurvivorSettingsPanelProps } from './types'

/**
 * Idols & Powers settings tab: the commissioner IdolSetup screen (survivor-theme handoff).
 * Replaces the free-form idol count and implemented-power pool; locks when the draft starts.
 */
export function SurvivorIdolsPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  return (
    <div className="px-4 py-6 sm:px-6">
      <SurvivorIdolSetup leagueId={leagueId} canEdit={canEdit} />
    </div>
  )
}
