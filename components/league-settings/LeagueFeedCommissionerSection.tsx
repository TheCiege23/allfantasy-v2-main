'use client'

import { useEffect, useState } from 'react'
import { SettingsSectionLabel, SettingsToggleRow } from '@/app/league/[leagueId]/components/settings/settings-ui'
import {
  getLeagueFeedSettings,
  mergeLeagueFeedSettings,
  type LeagueFeedSettings,
} from '@/lib/league-feed/leagueFeedSettings'

export function LeagueFeedCommissionerSection({
  settingsSnapshot,
  canEdit,
  debouncedSave,
}: {
  settingsSnapshot: Record<string, unknown>
  canEdit: boolean
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const disabled = !canEdit
  const [feed, setFeed] = useState<LeagueFeedSettings>(() => getLeagueFeedSettings(settingsSnapshot))

  useEffect(() => {
    setFeed(getLeagueFeedSettings(settingsSnapshot))
  }, [settingsSnapshot])

  const push = (patch: Partial<LeagueFeedSettings>) => {
    const next = { ...feed, ...patch }
    setFeed(next)
    debouncedSave({
      settingsMerge: mergeLeagueFeedSettings(settingsSnapshot, patch),
    })
  }

  const verbosity = feed.verbosity ?? 'medium'

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-4">
      <div>
        <SettingsSectionLabel>League feed & AI flavor</SettingsSectionLabel>
        <p className="mt-1 text-[11px] leading-relaxed text-white/45">
          Central activity stream for the league. AI personality lines are optional and never change outcomes.
        </p>
      </div>

      <div className="space-y-2">
        <SettingsToggleRow
          label="Enable league feed"
          checked={feed.enabled !== false}
          disabled={disabled}
          onChange={(v) => push({ enabled: v })}
        />
        <SettingsToggleRow
          label="AI personality flavor (quotes)"
          checked={feed.aiFlavorEnabled !== false}
          disabled={disabled || feed.enabled === false}
          onChange={(v) => push({ aiFlavorEnabled: v })}
        />
        <SettingsToggleRow
          label="Show AI archetypes to the league"
          checked={feed.showArchetypesPublic !== false}
          disabled={disabled}
          onChange={(v) => push({ showArchetypesPublic: v })}
        />
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-medium text-white/55">Feed verbosity</p>
        <div className="flex flex-wrap gap-2">
          {(['low', 'medium', 'high'] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={disabled || feed.enabled === false}
              onClick={() => push({ verbosity: v })}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold capitalize transition ${
                verbosity === v
                  ? 'border-sky-400/50 bg-sky-500/15 text-sky-100'
                  : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20'
              } ${disabled ? 'opacity-50' : ''}`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-white/35">
          Low throttles optional AI quotes on busy stretches; high keeps more flavor on marquee moments.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-medium text-white/55">Bot reactions (flavor) by surface</p>
        <div className="space-y-2">
          <SettingsToggleRow
            label="Draft"
            checked={feed.reactions?.draft !== false}
            disabled={disabled || feed.enabled === false || feed.aiFlavorEnabled === false}
            onChange={(v) => push({ reactions: { ...feed.reactions, draft: v } })}
          />
          <SettingsToggleRow
            label="Waivers"
            checked={feed.reactions?.waiver !== false}
            disabled={disabled || feed.enabled === false || feed.aiFlavorEnabled === false}
            onChange={(v) => push({ reactions: { ...feed.reactions, waiver: v } })}
          />
          <SettingsToggleRow
            label="Trades"
            checked={feed.reactions?.trade !== false}
            disabled={disabled || feed.enabled === false || feed.aiFlavorEnabled === false}
            onChange={(v) => push({ reactions: { ...feed.reactions, trade: v } })}
          />
          <SettingsToggleRow
            label="Matchups"
            checked={feed.reactions?.matchup !== false}
            disabled={disabled || feed.enabled === false || feed.aiFlavorEnabled === false}
            onChange={(v) => push({ reactions: { ...feed.reactions, matchup: v } })}
          />
        </div>
      </div>
    </div>
  )
}
