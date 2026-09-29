/**
 * AutoCoach Position Overrides Advanced Settings
 * For managing position-specific swap behavior
 */

'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAutoCoachPreferences } from '@/lib/autocoach/useAutoCoachPreferences'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IDL', 'EDGE', 'LB', 'CB', 'S'] as const

export function AutoCoachPositionOverridesPanel() {
  const { preferences, setPositionOverride } = useAutoCoachPreferences()
  const [isExpanded, setIsExpanded] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  const handleTogglePosition = async (position: (typeof POSITIONS)[number]) => {
    setSaving(position)
    try {
      const override = preferences?.positionOverrides?.[position]
      const nextDisabled = !override?.disabled
      await setPositionOverride(position, nextDisabled, undefined)
    } catch (e) {
      console.error('Failed to update position override:', e)
    } finally {
      setSaving(null)
    }
  }

  const handleSetPositionDelta = async (
    position: (typeof POSITIONS)[number],
    newDelta: string
  ) => {
    if (!newDelta || isNaN(parseFloat(newDelta))) return
    setSaving(`${position}-delta`)
    try {
      const override = preferences?.positionOverrides?.[position]
      await setPositionOverride(position, override?.disabled, parseFloat(newDelta))
    } catch (e) {
      console.error('Failed to update position delta:', e)
    } finally {
      setSaving(null)
    }
  }

  const activeOverrides = Object.entries(preferences?.positionOverrides ?? {}).filter(
    ([, override]) => override?.disabled || override?.minProjectionDelta
  )

  if (!preferences) return null

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] p-3">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between text-sm font-semibold text-white/70 hover:text-white/90 transition"
      >
        <span>⚙️ Position-Specific Overrides</span>
        <ChevronDown
          size={16}
          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
          {activeOverrides.length === 0 && (
            <p className="text-xs text-white/40">No position overrides set. Expand below to add.</p>
          )}
          {activeOverrides.map(([pos, override]) => (
            <div
              key={pos}
              className="flex items-center justify-between rounded-md bg-white/[0.04] px-2.5 py-2"
            >
              <span className="font-mono text-sm font-semibold text-white/80">{pos}</span>
              <div className="flex items-center gap-2">
                {override?.disabled && (
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                    Disabled
                  </span>
                )}
                {override?.minProjectionDelta && (
                  <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-400">
                    Δ +{override.minProjectionDelta.toFixed(1)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleTogglePosition(pos as (typeof POSITIONS)[number])}
                  disabled={saving === pos}
                  className="text-xs text-white/40 hover:text-red-400 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          ))}

          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <p className="text-[11px] font-semibold uppercase text-white/30 mb-2">Add Override</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {POSITIONS.map((pos) => {
                const override = preferences.positionOverrides?.[pos]
                const isDisabled = override?.disabled || false
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => handleTogglePosition(pos)}
                    disabled={saving?.startsWith(pos) || false}
                    className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                      isDisabled
                        ? 'border-red-500/30 bg-red-500/20 text-red-200'
                        : 'border border-white/[0.1] bg-white/[0.04] text-white/70 hover:bg-white/[0.08]'
                    } ${saving?.startsWith(pos) ? 'opacity-50' : ''}`}
                  >
                    {pos}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
