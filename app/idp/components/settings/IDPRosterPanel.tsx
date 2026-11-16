'use client'

/**
 * IDP defensive roster: position mode and roster preset, saved to the league's IDP config (2026-11-15).
 *
 * 🛑 THIS PANEL WAS A MOCK-UP THAT SAVED NOTHING. It held its own DL / LB / DB counts in local state, took no league,
 * and said "UI preview". Its tab looked like the place to set defensive slots. It now edits the IDP config through
 * `/api/leagues/[leagueId]/idp/config`, which is what the lineup screen's roster template reads
 * (lib/idp/IDPLeagueConfig.ts `getRosterDefaultsForIdpLeague`), and shows the slots that config produces. The route
 * keeps its own rules: the settings lock, IDP's position lock, preset validation, and the league log.
 */
import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow } from '@/app/league/[leagueId]/components/settings/ui'

const POSITION_MODES: Array<{ id: string; label: string }> = [
  { id: 'standard', label: 'Standard (DL, LB, DB)' },
  { id: 'advanced', label: 'Advanced (DE, DT, LB, CB, S)' },
  { id: 'hybrid', label: 'Hybrid (grouped + split)' },
]
const ROSTER_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'beginner', label: 'Beginner IDP' },
  { id: 'standard', label: 'Standard IDP' },
  { id: 'advanced', label: 'Advanced IDP' },
]

type Loaded = {
  positionMode: string
  rosterPreset: string
  settingsLockedAt: string | null
  starterSlots: Record<string, number> | null
}

export function IDPRosterPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [state, setState] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/idp/config`, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as {
        config?: { positionMode?: string; rosterPreset?: string; settingsLockedAt?: string | null } | null
        rosterPreview?: { starterSlots?: Record<string, number> } | null
        error?: string
      }
      if (!res.ok || !data.config) {
        setError(data.error ?? 'Could not load the IDP roster.')
        return
      }
      setState({
        positionMode: data.config.positionMode ?? 'standard',
        rosterPreset: data.config.rosterPreset ?? 'standard',
        settingsLockedAt: data.config.settingsLockedAt ?? null,
        starterSlots: data.rosterPreview?.starterSlots ?? null,
      })
    } catch {
      setError('Could not load the IDP roster.')
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const saveField = async (patch: { positionMode?: string; rosterPreset?: string }) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/idp/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Could not save the IDP roster.')
        return
      }
      await load()
    } catch {
      setError('Could not save the IDP roster.')
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return (
      <div className="space-y-6" data-testid="idp-roster-panel">
        <p className="text-xs text-white/55">{error ?? 'Loading…'}</p>
      </div>
    )
  }

  const locked = Boolean(state.settingsLockedAt)
  const disabled = !canEdit || saving || locked
  const presetIsCustom = !ROSTER_PRESETS.some((p) => p.id === state.rosterPreset)

  return (
    <div className="space-y-6" data-testid="idp-roster-panel">
      <SettingsSection title="Defensive slots" description="Sets the defensive starters every lineup in this league uses.">
        {locked ? (
          <p className="text-[11px] text-amber-300/80" data-testid="idp-roster-locked">
            IDP positions are locked for the season, so the defensive layout can no longer change.
          </p>
        ) : null}
        <SettingsRow label="Position mode">
          <div className="flex flex-wrap gap-2">
            {POSITION_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                aria-pressed={state.positionMode === m.id}
                onClick={() => state.positionMode !== m.id && void saveField({ positionMode: m.id })}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  state.positionMode === m.id ? 'border-cyan-500/50 bg-cyan-950/40 text-cyan-100' : 'border-white/10 text-white/50'
                } disabled:opacity-60`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="Roster preset">
          <div className="flex flex-wrap gap-2">
            {ROSTER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                aria-pressed={state.rosterPreset === p.id}
                onClick={() => state.rosterPreset !== p.id && void saveField({ rosterPreset: p.id })}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  state.rosterPreset === p.id ? 'border-cyan-500/50 bg-cyan-950/40 text-cyan-100' : 'border-white/10 text-white/50'
                } disabled:opacity-60`}
              >
                {p.label}
              </button>
            ))}
            {presetIsCustom ? <span className="self-center text-[11px] text-white/45">Custom layout in use</span> : null}
          </div>
        </SettingsRow>
        {state.starterSlots ? (
          <SettingsRow label="Starters this gives">
            <p className="text-xs text-white/70" data-testid="idp-roster-preview">
              {Object.entries(state.starterSlots)
                .filter(([, n]) => Number(n) > 0)
                .map(([slot, n]) => `${slot} ${n}`)
                .join(' · ')}
            </p>
          </SettingsRow>
        ) : null}
        {error ? (
          <p className="text-[11px] text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </SettingsSection>
    </div>
  )
}
