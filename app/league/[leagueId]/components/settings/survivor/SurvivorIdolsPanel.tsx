'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

type IdolConfig = { idolCount: number; idolPowerPool: string[] | null }

export function SurvivorIdolsPanel({ leagueId }: SurvivorSettingsPanelProps) {
  const [config, setConfig] = useState<IdolConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || !payload.config) throw new Error(payload.error ?? 'Could not load idol rules')
      setConfig(payload.config as IdolConfig)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load idol rules')
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
      <p className="text-[11px] text-amber-200/80">Idols are assigned by the system and hidden from a commissioner who plays. Editing the idol pool is not available in the NBA pilot yet.</p>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!config && !error && <p role="status" className="text-sm text-white/50">Loading idol rules…</p>}
      {config && <SettingsSection id="sv-idol-current" title="Current idol configuration">
        <SettingsRow label="Configured idol count" control={<span>{config.idolCount}</span>} />
        <SettingsRow label="Power pool" control={<span>{config.idolPowerPool?.length ? config.idolPowerPool.join(', ') : 'System default'}</span>} />
      </SettingsSection>}
    </div>
  )
}
