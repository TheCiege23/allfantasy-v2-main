'use client'

import React from 'react'
import { useChimmyAlertPreferences } from '@/hooks/useChimmyAlertPreferences'
import type { ChimmyAlertClass, ChimmyAlertUserPreferences } from '@/lib/chimmy-alerts/types'

const ALERT_CLASSES: { id: ChimmyAlertClass; label: string }[] = [
  { id: 'lineup', label: 'Lineup' },
  { id: 'waiver', label: 'Waivers' },
  { id: 'trade', label: 'Trades' },
  { id: 'draft', label: 'Draft' },
  { id: 'matchup', label: 'Matchup' },
  { id: 'team_roster', label: 'Roster' },
  { id: 'commissioner', label: 'Commissioner' },
  { id: 'story_engagement', label: 'Stories' },
  { id: 'specialty', label: 'Specialty' },
]

// ── Shared sub-components ────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-white/45">
      {children}
    </p>
  )
}

function SegmentButton<T extends string>({
  value,
  current,
  label,
  onClick,
}: {
  value: T
  current?: string
  label: string
  onClick: () => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[40px] flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
        active
          ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
          : 'border-white/15 bg-white/5 text-white/55 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-white/80">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-cyan-400/50 bg-cyan-500' : 'border-white/20 bg-white/10'
        }`}
      >
        <span
          className={`absolute top-px h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-px'
          }`}
        />
      </button>
    </label>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

export interface ChimmyAlertPreferencesPanelProps {
  role?: 'member' | 'commissioner' | 'admin'
  className?: string
}

export default function ChimmyAlertPreferencesPanel({
  role = 'member',
  className = '',
}: ChimmyAlertPreferencesPanelProps) {
  const { prefs, loading, error, saving, patch } = useChimmyAlertPreferences()

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>
    )
  }

  if (error || !prefs) {
    return (
      <p className={`text-xs text-red-400 ${className}`}>
        {error ?? 'Failed to load preferences.'}
      </p>
    )
  }

  const mutedClasses = prefs.mutedClasses ?? []
  const cp = prefs.channelPreferences ?? {}
  const commPrefs = prefs.commissionerPrefs

  const toggleClass = (cls: ChimmyAlertClass) => {
    const next = mutedClasses.includes(cls)
      ? mutedClasses.filter((c) => c !== cls)
      : [...mutedClasses, cls]
    void patch({ mutedClasses: next } as Partial<ChimmyAlertUserPreferences>)
  }

  return (
    <div className={`space-y-5 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Chimmy Alert Settings</h3>
        {saving && <span className="text-[11px] text-cyan-400/70">Saving…</span>}
      </div>

      {/* Alert Volume */}
      <section className="space-y-2.5">
        <SectionLabel>Alert Volume</SectionLabel>
        <div className="flex gap-2">
          {(
            [
              { value: 'normal', label: 'Normal' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'minimal', label: 'Minimal' },
            ] as const
          ).map((opt) => (
            <SegmentButton
              key={opt.value}
              value={opt.value}
              current={prefs.frequency ?? 'normal'}
              label={opt.label}
              onClick={() =>
                void patch({ frequency: opt.value } as Partial<ChimmyAlertUserPreferences>)
              }
            />
          ))}
        </div>
      </section>

      {/* Sensitivity */}
      <section className="space-y-2.5">
        <SectionLabel>Sensitivity</SectionLabel>
        <div className="flex gap-2">
          {(
            [
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
            ] as const
          ).map((opt) => (
            <SegmentButton
              key={opt.value}
              value={opt.value}
              current={prefs.sensitivity ?? 'normal'}
              label={opt.label}
              onClick={() =>
                void patch({ sensitivity: opt.value } as Partial<ChimmyAlertUserPreferences>)
              }
            />
          ))}
        </div>
      </section>

      {/* Channel Preferences */}
      <section className="space-y-3">
        <SectionLabel>Delivery Channels</SectionLabel>
        <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
          <Toggle
            label="Push notifications"
            checked={!(cp.disablePush ?? false)}
            onChange={(v) =>
              void patch({
                channelPreferences: { ...cp, disablePush: !v },
              } as Partial<ChimmyAlertUserPreferences>)
            }
          />
          <Toggle
            label="Email alerts"
            checked={!(cp.disableEmail ?? false)}
            onChange={(v) =>
              void patch({
                channelPreferences: { ...cp, disableEmail: !v },
              } as Partial<ChimmyAlertUserPreferences>)
            }
          />
          <Toggle
            label="SMS alerts"
            checked={!(cp.disableSms ?? false)}
            onChange={(v) =>
              void patch({
                channelPreferences: { ...cp, disableSms: !v },
              } as Partial<ChimmyAlertUserPreferences>)
            }
          />
        </div>
      </section>

      {/* Muted Categories */}
      <section className="space-y-2.5">
        <SectionLabel>Muted Categories</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {ALERT_CLASSES.map((cls) => {
            const isMuted = mutedClasses.includes(cls.id)
            return (
              <button
                key={cls.id}
                type="button"
                onClick={() => toggleClass(cls.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  isMuted
                    ? 'border-red-400/40 bg-red-500/15 text-red-300 line-through'
                    : 'border-white/15 bg-white/5 text-white/65 hover:bg-white/10'
                }`}
              >
                {cls.label}
              </button>
            )
          })}
        </div>
        {mutedClasses.length > 0 && (
          <p className="text-[11px] text-white/35">
            {mutedClasses.length} categor{mutedClasses.length === 1 ? 'y' : 'ies'} muted
          </p>
        )}
      </section>

      {/* Commissioner Prefs */}
      {(role === 'commissioner' || role === 'admin') && (
        <section className="space-y-3">
          <SectionLabel>Commissioner Alerts</SectionLabel>
          <div className="space-y-2.5 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3.5 py-3">
            <Toggle
              label="Enable commissioner alerts"
              checked={commPrefs?.enabled ?? true}
              onChange={(v) =>
                void patch({
                  commissionerPrefs: { ...(commPrefs ?? { enabled: true }), enabled: v },
                } as Partial<ChimmyAlertUserPreferences>)
              }
            />
            {(commPrefs?.enabled ?? true) && (
              <>
                <Toggle
                  label="Suspicious trade alerts"
                  checked={commPrefs?.receiveSuspiciousTradeAlerts ?? true}
                  onChange={(v) =>
                    void patch({
                      commissionerPrefs: {
                        ...(commPrefs ?? { enabled: true }),
                        receiveSuspiciousTradeAlerts: v,
                      },
                    } as Partial<ChimmyAlertUserPreferences>)
                  }
                />
                <Toggle
                  label="Orphan team alerts"
                  checked={commPrefs?.receiveOrphanTeamAlerts ?? true}
                  onChange={(v) =>
                    void patch({
                      commissionerPrefs: {
                        ...(commPrefs ?? { enabled: true }),
                        receiveOrphanTeamAlerts: v,
                      },
                    } as Partial<ChimmyAlertUserPreferences>)
                  }
                />
                <Toggle
                  label="Integrity alerts"
                  checked={commPrefs?.receiveIntegrityAlerts ?? true}
                  onChange={(v) =>
                    void patch({
                      commissionerPrefs: {
                        ...(commPrefs ?? { enabled: true }),
                        receiveIntegrityAlerts: v,
                      },
                    } as Partial<ChimmyAlertUserPreferences>)
                  }
                />
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
