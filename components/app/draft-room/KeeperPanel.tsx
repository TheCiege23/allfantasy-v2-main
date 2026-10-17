'use client'

import { useState, useCallback, useEffect } from 'react'
import { Shield, Trash2, Plus } from 'lucide-react'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { useUserTimezone } from '@/hooks/useUserTimezone'

export type KeeperPanelProps = {
  leagueId: string
  isCommissioner: boolean
  slotOrder: SlotOrderEntry[]
  currentUserRosterId: string | null
  rounds: number
  onSessionUpdate?: () => void
}

type KeeperApiState = {
  config: { maxKeepers: number; deadline?: string | null; maxKeepersPerPosition?: Record<string, number> }
  deadlineLocked?: boolean
  sessionStatus?: string
  selections: Array<{ rosterId: string; roundCost: number; playerName: string; position: string; team: string | null; playerId: string | null; commissionerOverride?: boolean }>
  locks: unknown[]
  mySelections: Array<{ rosterId: string; roundCost: number; playerName: string; position: string; team: string | null }>
  myCarryover?: string[]
  carryoverByRoster?: Record<string, string[]>
  currentUserRosterId: string | undefined
}

export function KeeperPanel({
  leagueId,
  isCommissioner,
  slotOrder,
  currentUserRosterId,
  rounds,
  onSessionUpdate,
}: KeeperPanelProps) {
  const { formatInTimezone } = useUserTimezone()
  const [data, setData] = useState<KeeperApiState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [configSaving, setConfigSaving] = useState(false)

  const [addPlayerName, setAddPlayerName] = useState('')
  const [addPosition, setAddPosition] = useState('')
  const [addTeam, setAddTeam] = useState('')
  const [addRoundCost, setAddRoundCost] = useState(1)
  const [commissionerRosterId, setCommissionerRosterId] = useState<string>('')
  const [commissionerOverride, setCommissionerOverride] = useState(false)

  const [configMaxKeepers, setConfigMaxKeepers] = useState(3)
  const [configDeadline, setConfigDeadline] = useState('')
  const [configPositionCapsInput, setConfigPositionCapsInput] = useState('{}')

  const fetchKeepers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/keepers`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Failed to load keepers')
        setData(null)
        return
      }
      setData({
        config: json.config ?? { maxKeepers: 0 },
        deadlineLocked: Boolean(json.deadlineLocked),
        sessionStatus: json.sessionStatus ?? 'pre_draft',
        selections: json.selections ?? [],
        locks: json.locks ?? [],
        mySelections: json.mySelections ?? [],
        myCarryover: Array.isArray(json.myCarryover) ? json.myCarryover : [],
        carryoverByRoster:
          json.carryoverByRoster && typeof json.carryoverByRoster === 'object'
            ? json.carryoverByRoster
            : {},
        currentUserRosterId: json.currentUserRosterId,
      })
      setConfigMaxKeepers(json.config?.maxKeepers ?? 3)
      setConfigDeadline(json.config?.deadline ? String(json.config.deadline).slice(0, 16) : '')
      setConfigPositionCapsInput(JSON.stringify(json.config?.maxKeepersPerPosition ?? {}, null, 0))
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    fetchKeepers()
  }, [fetchKeepers])

  const effectiveRosterId = isCommissioner && commissionerRosterId ? commissionerRosterId : (currentUserRosterId ?? data?.currentUserRosterId ?? '')
  const canAdd = data?.config?.maxKeepers != null && data.config.maxKeepers > 0 && effectiveRosterId && addPlayerName.trim() && addRoundCost >= 1 && addRoundCost <= rounds

  const handleAddKeeper = useCallback(async () => {
    if (!canAdd || actionLoading) return
    setActionLoading('add')
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/keepers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rosterId: effectiveRosterId,
          roundCost: addRoundCost,
          playerName: addPlayerName.trim(),
          position: addPosition.trim() || '—',
          team: addTeam.trim() || null,
          commissionerOverride: isCommissioner && commissionerOverride,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.error == null) {
        setAddPlayerName('')
        setAddPosition('')
        setAddTeam('')
        await fetchKeepers()
        onSessionUpdate?.()
      } else {
        setError(json.error || 'Failed to add keeper')
      }
    } finally {
      setActionLoading(null)
    }
  }, [leagueId, canAdd, actionLoading, effectiveRosterId, addRoundCost, addPlayerName, addPosition, addTeam, isCommissioner, commissionerOverride, fetchKeepers, onSessionUpdate])

  const handleRemove = useCallback(async (rosterId: string, playerName: string) => {
    if (actionLoading) return
    setActionLoading('remove')
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/keepers/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId, playerName }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.error == null) {
        await fetchKeepers()
        onSessionUpdate?.()
      } else {
        setError(json.error || 'Failed to remove keeper')
      }
    } finally {
      setActionLoading(null)
    }
  }, [leagueId, actionLoading, fetchKeepers, onSessionUpdate])

  const handleSaveConfig = useCallback(async () => {
    if (!isCommissioner || configSaving) return
    setConfigSaving(true)
    setError(null)
    try {
      let parsedPositionCaps: Record<string, number> | null = null
      const capsRaw = configPositionCapsInput.trim()
      if (capsRaw) {
        try {
          const parsed = JSON.parse(capsRaw) as Record<string, unknown>
          parsedPositionCaps = {}
          for (const [rawPos, rawCount] of Object.entries(parsed ?? {})) {
            const pos = String(rawPos || '').trim().toUpperCase()
            const count = Math.max(0, Math.min(10, Math.round(Number(rawCount) || 0)))
            if (pos) parsedPositionCaps[pos] = count
          }
        } catch {
          setError('Position caps must be valid JSON (example: {"QB":1,"RB":2})')
          return
        }
      }
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/keepers/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxKeepers: configMaxKeepers,
          deadline: configDeadline.trim() || null,
          maxKeepersPerPosition: parsedPositionCaps,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        await fetchKeepers()
        onSessionUpdate?.()
      } else {
        setError(json.error || 'Failed to save config')
      }
    } finally {
      setConfigSaving(false)
    }
  }, [leagueId, isCommissioner, configSaving, configMaxKeepers, configDeadline, configPositionCapsInput, fetchKeepers, onSessionUpdate])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-white/50 text-sm">
        Loading keepers…
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm">
        <p className="text-red-400">{error}</p>
        <button type="button" onClick={fetchKeepers} className="rounded bg-white/10 px-2 py-1 text-white hover:bg-white/20">
          Retry
        </button>
      </div>
    )
  }

  const maxKeepers = data?.config?.maxKeepers ?? 0
  const mySelections = data?.mySelections ?? []
  const isPreDraftStatus = (data?.sessionStatus ?? 'pre_draft') === 'pre_draft'
  const deadlineLocked = Boolean(data?.deadlineLocked)
  const canEdit = isPreDraftStatus && maxKeepers > 0 && (!deadlineLocked || isCommissioner)
  const effectiveRosterCarryover =
    effectiveRosterId && data?.carryoverByRoster
      ? data.carryoverByRoster[effectiveRosterId] ?? []
      : data?.myCarryover ?? []

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-sm">
      <h3 className="mb-2 flex items-center gap-2 font-semibold text-white">
        <Shield className="h-4 w-4 text-emerald-400" aria-hidden />
        Keepers
      </h3>
      {data && (
        <>
          <p className="mb-2 text-white/60">
            Max {maxKeepers} keeper{maxKeepers !== 1 ? 's' : ''} per team.
            {data.config?.deadline ? ` Deadline: ${formatInTimezone(data.config.deadline)}` : ''}
          </p>
          {deadlineLocked && (
            <p className="mb-2 text-amber-300 text-xs" data-testid="draft-keeper-deadline-locked">
              Keeper deadline has passed. {isCommissioner ? 'Commissioner can still override.' : 'Selections are locked.'}
            </p>
          )}
          {!isPreDraftStatus && (
            <p className="mb-2 text-amber-300 text-xs" data-testid="draft-keeper-draft-started-lock">
              Draft already started. Keeper edits are disabled.
            </p>
          )}
          {error && <p className="mb-2 text-red-400 text-xs">{error}</p>}

          {isCommissioner && (
            <section className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3">
              <h4 className="mb-2 font-medium text-white/90">Commissioner: config</h4>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-white/70">
                  Max keepers
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={configMaxKeepers}
                    data-testid="draft-keeper-config-max-keepers"
                    onChange={(e) => setConfigMaxKeepers(Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)))}
                    className="ml-2 w-14 rounded border border-white/20 bg-black/40 px-1 py-0.5 text-white"
                  />
                </label>
                <label className="text-white/70">
                  Deadline
                  <input
                    type="datetime-local"
                    value={configDeadline}
                    data-testid="draft-keeper-config-deadline"
                    onChange={(e) => setConfigDeadline(e.target.value)}
                    className="ml-2 rounded border border-white/20 bg-black/40 px-1 py-0.5 text-white"
                  />
                </label>
                <label className="text-white/70">
                  Position caps JSON
                  <input
                    type="text"
                    value={configPositionCapsInput}
                    data-testid="draft-keeper-config-position-caps"
                    onChange={(e) => setConfigPositionCapsInput(e.target.value)}
                    className="ml-2 w-44 rounded border border-white/20 bg-black/40 px-1 py-0.5 text-white"
                    placeholder='{"QB":1,"RB":2}'
                  />
                </label>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={configSaving}
                  data-testid="draft-keeper-config-save"
                  className="rounded bg-cyan-600 px-2 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {configSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </section>
          )}

          <section className="mb-4">
            <h4 className="mb-2 font-medium text-white/90">My keepers</h4>
            <ul className="space-y-1">
              {mySelections.length === 0 ? (
                <li className="text-white/50" data-testid="draft-keeper-empty">
                  None selected.
                </li>
              ) : (
                mySelections.map((s, i) => (
                  <li
                    key={`${s.rosterId}-${s.playerName}-${s.roundCost}-${i}`}
                    className="flex items-center justify-between gap-2 rounded bg-white/5 py-1.5 px-2"
                    data-testid={`draft-keeper-row-${i}`}
                  >
                    <span className="truncate text-white">
                      {s.playerName} · Rd{s.roundCost} · {s.position}
                      {s.team ? ` · ${s.team}` : ''}
                    </span>
                    {canEdit && (s.rosterId === currentUserRosterId || isCommissioner) && (
                      <button
                        type="button"
                        onClick={() => handleRemove(s.rosterId, s.playerName)}
                        disabled={!!actionLoading}
                        data-testid={`draft-keeper-remove-${i}`}
                        className="shrink-0 rounded p-1 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                        aria-label={`Remove ${s.playerName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <h4 className="mb-2 font-medium text-white/90">Roster carryover visibility</h4>
            {effectiveRosterCarryover.length === 0 ? (
              <p className="text-white/55 text-xs" data-testid="draft-keeper-carryover-empty">
                No carryover roster player names were detected.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="draft-keeper-carryover-list">
                {effectiveRosterCarryover.slice(0, 24).map((name) => (
                  <span key={name} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/80">
                    {name}
                  </span>
                ))}
              </div>
            )}
          </section>

          {canEdit && (
            <section className="rounded-lg border border-white/10 bg-black/20 p-3">
              <h4 className="mb-2 flex items-center gap-1 font-medium text-white/90">
                <Plus className="h-3.5 w-3.5" /> Add keeper
              </h4>
              {isCommissioner && (
                <div className="mb-2">
                  <label className="text-white/70">Roster</label>
                  <select
                    value={(commissionerRosterId || currentUserRosterId) ?? ''}
                    data-testid="draft-keeper-select-roster"
                    onChange={(e) => setCommissionerRosterId(e.target.value)}
                    className="ml-2 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    {slotOrder.map((s) => (
                      <option key={s.rosterId} value={s.rosterId}>
                        {s.displayName || `Slot ${s.slot}`}
                      </option>
                    ))}
                  </select>
                  <label className="ml-3 inline-flex items-center gap-1 text-white/70">
                    <input
                      type="checkbox"
                      checked={commissionerOverride}
                      data-testid="draft-keeper-commissioner-override"
                      onChange={(e) => setCommissionerOverride(e.target.checked)}
                    />
                    Override eligibility
                  </label>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Player name"
                  value={addPlayerName}
                  data-testid="draft-keeper-add-player-name"
                  onChange={(e) => setAddPlayerName(e.target.value)}
                  className="min-w-[100px] rounded border border-white/20 bg-black/40 px-2 py-1 text-white placeholder:text-white/40"
                />
                <input
                  type="text"
                  placeholder="Pos"
                  value={addPosition}
                  data-testid="draft-keeper-add-position"
                  onChange={(e) => setAddPosition(e.target.value.toUpperCase())}
                  className="w-12 rounded border border-white/20 bg-black/40 px-1 py-1 text-white placeholder:text-white/40"
                />
                <input
                  type="text"
                  placeholder="Team"
                  value={addTeam}
                  data-testid="draft-keeper-add-team"
                  onChange={(e) => setAddTeam(e.target.value)}
                  className="w-14 rounded border border-white/20 bg-black/40 px-1 py-1 text-white placeholder:text-white/40"
                />
                <label className="text-white/70">
                  Round
                  <select
                    value={addRoundCost}
                    data-testid="draft-keeper-add-round-cost"
                    onChange={(e) => setAddRoundCost(parseInt(e.target.value, 10))}
                    className="ml-1 rounded border border-white/20 bg-black/40 px-1 py-1 text-white"
                  >
                    {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleAddKeeper}
                  disabled={!canAdd || !!actionLoading}
                  data-testid="draft-keeper-add-submit"
                  className="rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {actionLoading === 'add' ? 'Adding…' : 'Add'}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default KeeperPanel
