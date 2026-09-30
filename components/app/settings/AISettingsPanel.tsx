'use client'

import { useState, useCallback, useEffect } from 'react'
import type { LeagueAISettings } from '@/lib/ai-settings'

type AIFeatureId = keyof LeagueAISettings

const AI_FEATURES: { id: AIFeatureId; label: string; description: string }[] = [
  { id: 'tradeAnalyzerEnabled', label: 'Trade Analyzer', description: 'AI-powered trade evaluations and suggestions' },
  { id: 'waiverAiEnabled', label: 'Waiver AI', description: 'Waiver wire recommendations and add/drop insights' },
  { id: 'draftAssistantEnabled', label: 'Draft Assistant', description: 'Draft room ADP, queue reorder, and pick suggestions' },
  { id: 'playerComparisonEnabled', label: 'Player Comparison', description: 'Head-to-head and context-aware player comparison' },
  { id: 'matchupSimulatorEnabled', label: 'Matchup Simulator', description: 'Matchup projections and win probability' },
  { id: 'fantasyCoachEnabled', label: 'Fantasy Coach', description: 'Lineup and strategy advice' },
  { id: 'aiChatChimmyEnabled', label: 'Chimmy Chat', description: 'League context chat and quick answers' },
  { id: 'aiDraftManagerOrphanEnabled', label: 'AI Draft Manager for orphan teams', description: 'Optional AI drafting for empty teams (with deterministic fallback when unavailable)' },
]

type Response = { settings: LeagueAISettings; isCommissioner: boolean }

export default function AISettingsPanel({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(!!leagueId)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<LeagueAISettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-settings`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to load AI settings')
        setData(null)
        return
      }
      setData(json)
      setSettings(json.settings ?? null)
    } catch {
      setError('Failed to load AI settings')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  const handleToggle = useCallback((key: AIFeatureId, value: boolean) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : null))
  }, [])

  const handleSave = useCallback(async () => {
    if (!leagueId || !data?.isCommissioner || !settings) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to save')
        return
      }
      setData((prev) => (prev ? { ...prev, settings: json.settings } : null))
      setSettings(json.settings)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [leagueId, data?.isCommissioner, settings])

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">AI Settings</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to manage AI features.</p>
      </section>
    )
  }

  if (loading && !data) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">AI Settings</h3>
        <p className="mt-2 text-xs text-white/65">Loading…</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">AI Settings</h3>
        <p className="mt-2 text-xs text-red-400/90">{error}</p>
      </section>
    )
  }

  const isCommissioner = data?.isCommissioner ?? false
  const current = settings ?? data?.settings

  return (
    <section className="space-y-6 rounded-xl border border-white/10 bg-black/20 p-4">
      <div>
        <h3 className="text-sm font-semibold text-white">AI Settings</h3>
        <p className="mt-1 text-xs text-white/65">
          Enable or disable AI features for this league. Only commissioners can change these settings.
        </p>
      </div>

      <div className="space-y-3">
        {AI_FEATURES.map(({ id, label, description }) => (
          <label
            key={id}
            className="flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left"
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-white/90">{label}</span>
              <p className="mt-0.5 text-xs text-white/50">{description}</p>
            </div>
            <input
              type="checkbox"
              checked={current?.[id] ?? false}
              onChange={(e) => handleToggle(id, e.target.checked)}
              disabled={!isCommissioner}
              className="mt-1 rounded border-white/20"
              data-testid={`commissioner-ai-toggle-${id}`}
              aria-label={`${label} ${current?.[id] ? 'on' : 'off'}`}
            />
          </label>
        ))}
      </div>

      {error ? <p className="text-xs text-red-400/90">{error}</p> : null}

      {isCommissioner && (
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            data-testid="commissioner-ai-save"
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-4 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save AI settings'}
          </button>
          {saveSuccess && <span className="text-xs text-emerald-400">Saved.</span>}
        </div>
      )}
    </section>
  )
}
