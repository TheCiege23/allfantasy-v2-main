'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow } from '../../../tabs/settings/components'
import type { SurvivorSettingsPanelProps } from './types'

type MergeConfig = { mergeTrigger: string; mergeWeek: number; mergePlayerCount: number | null; juryStartAfterMerge: number }

export function SurvivorMergeJuryPanel({ leagueId }: SurvivorSettingsPanelProps) {
  const [config, setConfig] = useState<MergeConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/config`, { credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || !payload.config) throw new Error(payload.error ?? 'Could not load merge rules')
      setConfig(payload.config as MergeConfig)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load merge rules')
    }
  }, [leagueId])
  useEffect(() => { void load() }, [load])

  return <div className="space-y-5 px-6 py-6 text-[13px] text-white/85">
    <p className="text-[11px] text-amber-200/80">Merge timing is configured in Survivor Setup. Finale format and jury Q&A timers are system-managed for this NBA pilot.</p>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {!config && !error && <p role="status" className="text-sm text-white/50">Loading merge rules…</p>}
    {config && <SettingsSection id="sv-merge-current" title="Current merge and jury rules">
      <SettingsRow label="Merge trigger" control={<span>{config.mergeTrigger === 'player_count' ? `${config.mergePlayerCount ?? '—'} active managers` : `Week ${config.mergeWeek}`}</span>} />
      <SettingsRow label="Jury starts" control={<span>{config.juryStartAfterMerge === 1 ? 'After merge' : `After ${config.juryStartAfterMerge} merge eliminations`}</span>} />
    </SettingsSection>}
    <Link href={`/survivor/${encodeURIComponent(leagueId)}/jury`} className="inline-flex text-sm text-cyan-300 hover:text-cyan-200">Open Jury chamber →</Link>
  </div>
}
