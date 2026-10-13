'use client'

import { useEffect, useState } from 'react'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

export function C2CDevyPanel({
  config,
  leagueId,
  canEdit = false,
}: {
  config: C2CConfigClient | null
  leagueId?: string
  canEdit?: boolean
}) {
  const [enabled, setEnabled] = useState<boolean>(Boolean(config?.devyScoringEnabled))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The config arrives after first render; follow it, or the panel shows "stash only" for a league
  // that has campus scoring on, and the first click "changes" it to what it already was.
  useEffect(() => setEnabled(Boolean(config?.devyScoringEnabled)), [config?.devyScoringEnabled])

  if (!config) return <p className="px-6 py-8 text-[13px] text-white/45">Loading…</p>

  const save = async (next: boolean) => {
    if (!leagueId || !canEdit) return
    setSaving(true)
    setError(null)
    const prev = enabled
    setEnabled(next)
    try {
      const res = await fetch('/api/c2c/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, devyScoringEnabled: next }),
      })
      if (!res.ok) {
        setEnabled(prev)
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Could not save')
      }
    } catch (e) {
      setEnabled(prev)
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 px-6 py-6 text-[13px] text-white/80" data-testid="c2c-devy-panel">
      <div className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-[12px] text-violet-100/90">
        Devy scoring: {enabled ? 'Campus slots eligible' : 'Stash only (default)'}
      </div>
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100/90">
          {error}
        </div>
      )}
      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="radio"
          name="devysc"
          checked={!enabled}
          disabled={!canEdit || saving}
          onChange={() => void save(false)}
        />
        Stash only
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="radio"
          name="devysc"
          checked={enabled}
          disabled={!canEdit || saving}
          onChange={() => void save(true)}
        />
        Campus scoring eligible
      </label>
      <label className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-white/60">Freshman eligible</span>
        <input type="checkbox" disabled className="accent-violet-500" />
      </label>
      <label className="block">
        <span className="text-[11px] text-white/45">Max devy per team</span>
        <input type="number" defaultValue={6} className="mt-1 w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2" disabled />
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" disabled />
        Declaration year display
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" disabled />
        Auto-graduate to pro pipeline
      </label>
    </div>
  )
}
