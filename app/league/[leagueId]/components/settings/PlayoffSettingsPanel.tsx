'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import {
  SettingsPanelHeading,
  SettingsSectionLabel,
  SettingsHelper,
  SettingsRadioGroup,
  controlClass,
  controlClassSm,
} from './settings-ui'

export function PlayoffSettingsPanel({
  initialData,
  canEdit,
  debouncedSave,
}: {
  initialData: CommissionerSettingsFormData
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const disabled = !canEdit
  const [startWeek, setStartWeek] = useState(initialData.playoffStartWeek ?? 14)
  const [teams, setTeams] = useState(initialData.playoffTeams ?? 6)
  const [weeksPer, setWeeksPer] = useState(initialData.playoffWeeksPerRound ?? 1)
  const [champLength, setChampLength] = useState(initialData.championshipLength ?? 1)
  const [seeding, setSeeding] = useState((initialData.playoffSeedingRule ?? 'default') as string)
  const [lower, setLower] = useState((initialData.playoffLowerBracket ?? 'toilet') as string)

  useEffect(() => {
    setStartWeek(initialData.playoffStartWeek ?? 14)
    setTeams(initialData.playoffTeams ?? 6)
    setWeeksPer(initialData.playoffWeeksPerRound ?? 1)
    setChampLength(initialData.championshipLength ?? 1)
    setSeeding(initialData.playoffSeedingRule ?? 'default')
    setLower(initialData.playoffLowerBracket ?? 'toilet')
  }, [initialData])

  return (
    <div className="min-h-0 flex-1 space-y-8 px-6 py-6 text-[13px] text-white/85" data-testid="settings-playoff-panel">
      <SettingsPanelHeading
        title="Playoff settings"
        subtitle="Playoff start, bracket size, seeding rules, and consolation bracket."
      />

      <div>
        <SettingsSectionLabel>Playoffs start week</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={startWeek}
          onChange={(e) => {
            const n = Number(e.target.value)
            setStartWeek(n)
            debouncedSave({ playoffStartWeek: n })
          }}
        >
          {Array.from({ length: 8 }, (_, i) => 11 + i).map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
        <SettingsHelper>When your playoff bracket begins. Non-standard weeks are supported for custom formats.</SettingsHelper>
      </div>

      <div>
        <SettingsSectionLabel>Playoff teams</SettingsSectionLabel>
        <select
          className={controlClassSm}
          disabled={disabled}
          value={teams}
          onChange={(e) => {
            const n = Number(e.target.value)
            setTeams(n)
            debouncedSave({ playoffTeams: n })
          }}
        >
          {[4, 6, 8, 10, 12].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <SettingsSectionLabel>Playoff weeks per round</SettingsSectionLabel>
        <SettingsRadioGroup
          name="playoff-weeks-per-round"
          value={weeksPer === 2 ? '2' : '1'}
          disabled={disabled}
          onChange={(v) => {
            const n = v === '2' ? 2 : 1
            setWeeksPer(n)
            debouncedSave({ playoffWeeksPerRound: n })
          }}
          options={[
            { id: '1', title: 'One week per round', description: 'Each playoff round is one scoring week.' },
            {
              id: '2',
              title: 'Two weeks per round',
              description: 'Each round spans two scoring weeks (common for championship).',
            },
          ]}
        />
      </div>

      <div>
        <SettingsSectionLabel>Championship length</SettingsSectionLabel>
        <SettingsRadioGroup
          name="playoff-championship-length"
          value={champLength >= 2 ? '2' : '1'}
          disabled={disabled}
          onChange={(v) => {
            const n = v === '2' ? 2 : 1
            setChampLength(n)
            debouncedSave({ championshipLength: n })
          }}
          options={[
            { id: '1', title: 'Same as other rounds', description: 'The final is played over the weeks per round above.' },
            {
              id: '2',
              title: 'Two-week final',
              description: 'The championship is scored over two weeks (the MLB and NHL default).',
            },
          ]}
        />
        <SettingsHelper>Locked while the playoffs are being played.</SettingsHelper>
      </div>

      <div>
        <SettingsSectionLabel>Playoff seeding</SettingsSectionLabel>
        <SettingsRadioGroup
          name="playoff-seeding"
          value={seeding}
          disabled={disabled}
          onChange={(v) => {
            setSeeding(v)
            debouncedSave({ playoffSeedingRule: v })
          }}
          options={[
            {
              id: 'default',
              title: 'Default bracket',
              description: 'Teams stay on their side of the bracket for the whole playoffs.',
            },
            {
              id: 'reseed',
              title: 'Re-seed',
              description: 'Highest remaining seed always plays lowest remaining seed each round.',
            },
          ]}
        />
      </div>

      <div>
        <SettingsSectionLabel>Lower bracket type</SettingsSectionLabel>
        <SettingsRadioGroup
          name="playoff-lower"
          value={lower}
          disabled={disabled}
          onChange={(v) => {
            setLower(v)
            debouncedSave({ playoffLowerBracket: v })
          }}
          options={[
            {
              id: 'toilet',
              title: 'Toilet bowl',
              description: 'Losers advance in the lower bracket; last place is decided in the final.',
            },
            {
              id: 'consolation',
              title: 'Consolation bracket',
              description: 'Winners advance in the consolation bracket for best-of-the-rest.',
            },
            { id: 'none', title: 'None', description: 'No lower bracket games.' },
          ]}
        />
      </div>
    </div>
  )
}
