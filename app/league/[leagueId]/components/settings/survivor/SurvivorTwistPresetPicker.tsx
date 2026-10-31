'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  detectSurvivorTwistPreset,
  SURVIVOR_TWIST_PRESET_IDS,
  SURVIVOR_TWIST_PRESETS,
  type SurvivorTwistPresetId,
} from '@/lib/survivor/survivorTwistPresets'
import type { SurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'

type IdolView = { config: { mode: string; count: number; pickedTypeIds: string[] }; saved: boolean; locked: boolean }

/**
 * Simple, Classic or Full twists in one tap. Shows which one the league's settings match today
 * ("Custom" once a rule was changed by hand), and locks with the rest of the rules at the draft.
 */
export function SurvivorTwistPresetPicker({ leagueId, canEdit, settings, onApplied }: {
  leagueId: string
  canEdit: boolean
  settings: SurvivorFoundationSettings
  onApplied: () => void
}) {
  const [idol, setIdol] = useState<IdolView | null>(null)
  const [busy, setBusy] = useState<SurvivorTwistPresetId | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadIdols = useCallback(async () => {
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/idol-setup`, { credentials: 'include', cache: 'no-store' })
      if (response.ok) setIdol((await response.json()) as IdolView)
    } catch { /* the picker still works; detection reads "custom" without the idol setup */ }
  }, [leagueId])
  useEffect(() => { void loadIdols() }, [loadIdols])

  const current = idol ? detectSurvivorTwistPreset(settings, idol.saved ? idol.config : null) : null
  const locked = Boolean(idol?.locked)

  async function apply(preset: SurvivorTwistPresetId) {
    setBusy(preset)
    setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/apply-twist-preset`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Could not apply the twists')
      setMessage(`${SURVIVOR_TWIST_PRESETS[preset].label} twists applied.`)
      await loadIdols()
      onApplied()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not apply the twists')
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3" data-testid="survivor-twist-preset-picker">
      <p className="text-[12px] text-white/60">
        {current === 'custom' ? 'Custom: your rules were changed by hand. Pick a preset to start over from it.' : 'One choice sets idols, Exile and surprise tribes. Fine-tune any rule in the other tabs.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {SURVIVOR_TWIST_PRESET_IDS.map(id => {
          const preset = SURVIVOR_TWIST_PRESETS[id]
          const active = current === id
          return (
            <div key={id} className={`rounded-xl border p-3 ${active ? 'border-amber-300/60 bg-amber-400/10' : 'border-white/10 bg-white/[0.02]'}`} data-testid={`survivor-twist-${id}`}>
              <p className="text-sm font-semibold text-white">{preset.label}{active ? ' · current' : ''}</p>
              <p className="mt-1 text-[11px] text-white/55">{preset.tagline}</p>
              <ul className="mt-2 space-y-1 text-[11px] text-white/65">{preset.bullets.map(bullet => <li key={bullet}>• {bullet}</li>)}</ul>
              {!active && (
                <button type="button" disabled={!canEdit || locked || busy != null} onClick={() => void apply(id)}
                  className="mt-3 rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
                  {busy === id ? 'Applying…' : `Use ${preset.label}`}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {locked ? <p className="text-[11px] text-white/45">Twists locked when the draft started.</p> : null}
      {message ? <p role="status" className="text-sm text-amber-200">{message}</p> : null}
    </div>
  )
}
