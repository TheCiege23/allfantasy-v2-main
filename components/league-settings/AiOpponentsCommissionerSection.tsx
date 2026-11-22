'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSectionLabel, SettingsToggleRow } from '@/app/league/[leagueId]/components/settings/settings-ui'
import type { AiOpponentsLeagueSettings } from '@/lib/ai/opponents/types'

export function AiOpponentsCommissionerSection({
  leagueId,
  canEdit,
}: {
  leagueId: string
  canEdit: boolean
}) {
  const disabled = !canEdit
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<AiOpponentsLeagueSettings>({})

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/ai-opponents`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { aiOpponents?: AiOpponentsLeagueSettings } | null) => {
        if (d?.aiOpponents) setSettings(d.aiOpponents)
      })
      .finally(() => setLoading(false))
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  const patch = async (partial: Partial<AiOpponentsLeagueSettings>) => {
    if (!canEdit) return
    setSaving(true)
    try {
      const r = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/ai-opponents`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      if (r.ok) {
        const d = await r.json()
        if (d.aiOpponents) setSettings(d.aiOpponents)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-[12px] text-white/50">Loading Chimmy opponents…</p>
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div>
        <SettingsSectionLabel>Chimmy opponents</SettingsSectionLabel>
        <p className="mt-1 text-[12px] leading-relaxed text-white/55">
          Bot managers for mocks, fill-ins, and orphan takeovers. Off by default — no impact until enabled.
        </p>
      </div>
      {saving ? <p className="text-[11px] text-white/40">Saving…</p> : null}
      <SettingsToggleRow
        label="Enable Chimmy opponents"
        checked={Boolean(settings.enabled)}
        disabled={disabled}
        onChange={(v) => void patch({ enabled: v })}
      />
      <SettingsToggleRow
        label="Fill empty slots with Chimmy (when commissioner adds bots)"
        checked={Boolean(settings.fillEmptyWithAi)}
        disabled={disabled || !settings.enabled}
        onChange={(v) => void patch({ fillEmptyWithAi: v })}
      />
      <SettingsToggleRow
        label="Allow Chimmy takeover for inactive / orphan teams"
        checked={Boolean(settings.takeoverInactive)}
        disabled={disabled || !settings.enabled}
        onChange={(v) => void patch({ takeoverInactive: v })}
      />
      <SettingsToggleRow
        label="Mock / practice drafts only (no live Chimmy without explicit assignment)"
        checked={Boolean(settings.mockDraftsOnly)}
        disabled={disabled || !settings.enabled}
        onChange={(v) => void patch({ mockDraftsOnly: v })}
      />
      <SettingsToggleRow
        label="Allow full Chimmy leagues"
        checked={Boolean(settings.allowFullAiLeagues)}
        disabled={disabled || !settings.enabled}
        onChange={(v) => void patch({ allowFullAiLeagues: v })}
      />
    </div>
  )
}
