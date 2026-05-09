'use client'

import { useCallback, useRef, useState } from 'react'

export type ViewerAutopickData = {
  enabled: boolean
  mode: 'standard' | 'ai_queue'
  isProEligible: boolean
  updatedAt: string | null
}

export type AutopickMeToggleProps = {
  viewerAutopick: ViewerAutopickData | null | undefined
  leagueId: string
  onUpdate: (updated: ViewerAutopickData) => void
}

export function AutopickMeToggle({ viewerAutopick, leagueId, onUpdate }: AutopickMeToggleProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localEnabled, setLocalEnabled] = useState(viewerAutopick?.enabled ?? false)
  const [localMode, setLocalMode] = useState<'standard' | 'ai_queue'>(
    viewerAutopick?.mode ?? 'standard',
  )

  // Holds the last server-confirmed state so we can roll back on failure.
  const committedRef = useRef<{ enabled: boolean; mode: 'standard' | 'ai_queue' }>({
    enabled: viewerAutopick?.enabled ?? false,
    mode: viewerAutopick?.mode ?? 'standard',
  })

  const isProEligible = viewerAutopick?.isProEligible ?? false

  const save = useCallback(
    async (enabled: boolean, mode: 'standard' | 'ai_queue') => {
      setSaving(true)
      setError(null)
      // Optimistic update
      setLocalEnabled(enabled)
      setLocalMode(mode)

      try {
        const res = await fetch(`/api/leagues/${leagueId}/draft/autopick/me`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, mode }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string }
          const msg =
            data?.error ??
            (res.status === 403
              ? 'AF Pro required to enable AI queue auto-pick.'
              : 'Failed to save preference.')
          throw new Error(msg)
        }

        const data = await res.json() as { viewerAutopick?: ViewerAutopickData }
        if (data.viewerAutopick) {
          committedRef.current = {
            enabled: data.viewerAutopick.enabled,
            mode: data.viewerAutopick.mode,
          }
          setLocalEnabled(data.viewerAutopick.enabled)
          setLocalMode(data.viewerAutopick.mode)
          onUpdate(data.viewerAutopick)
        }
      } catch (err) {
        // Roll back to last server-confirmed state
        setLocalEnabled(committedRef.current.enabled)
        setLocalMode(committedRef.current.mode)
        setError(err instanceof Error ? err.message : 'Failed to save preference.')
      } finally {
        setSaving(false)
      }
    },
    [leagueId, onUpdate],
  )

  if (viewerAutopick === null || viewerAutopick === undefined) return null

  return (
    <div
      data-testid="autopick-me-toggle"
      className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-1.5"
    >
      <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-white/70">
        <input
          type="checkbox"
          checked={localEnabled}
          disabled={saving}
          data-testid="autopick-me-enabled"
          onChange={(e) => void save(e.target.checked, localMode)}
          className="rounded border-white/20 bg-transparent"
        />
        Auto-pick me
      </label>

      {localEnabled ? (
        <>
          <button
            type="button"
            disabled={saving}
            data-testid="autopick-mode-standard"
            onClick={() => void save(true, 'standard')}
            className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
              localMode === 'standard'
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                : 'border-white/15 text-white/45 hover:border-white/25 hover:text-white/70'
            }`}
          >
            Standard
          </button>
          <button
            type="button"
            disabled={saving}
            aria-disabled={!isProEligible || saving}
            data-testid="autopick-mode-ai-queue"
            title={isProEligible ? undefined : 'AF Pro required'}
            onClick={() => {
              if (!isProEligible) {
                setError('AF Pro required to enable AI queue auto-pick.')
                return
              }
              void save(true, 'ai_queue')
            }}
            className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
              localMode === 'ai_queue'
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                : 'border-white/15 text-white/45 hover:border-white/25 hover:text-white/70'
            } ${!isProEligible ? 'cursor-not-allowed opacity-45' : ''}`}
          >
            AI Queue{!isProEligible ? ' (Pro)' : ''}
          </button>
        </>
      ) : null}

      {error ? (
        <span
          data-testid="autopick-me-error"
          role="alert"
          className="ml-auto shrink-0 text-[10px] text-red-300"
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}
