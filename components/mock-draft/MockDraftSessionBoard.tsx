'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Share2 } from 'lucide-react'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'
import { buildDraftPlayerDisplayModel } from '@/lib/draft-sports-models/build-display-model'

type SessionPick = {
  overall: number
  round: number
  pick: number
  slot: number
  manager: string
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  byeWeek?: number | null
  injuryStatus?: string | null
  source?: string
}

type SessionDraft = {
  id: string
  status: string
  updatedAt: string
  shareId?: string | null
  inviteLink?: string | null
  settings: {
    sport: string
    draftType: string
    numTeams: number
    rounds: number
    timerSeconds: number
    poolType?: string
    roomMode?: string
    humanTeams?: number
  }
  progress?: {
    totalPicks: number
    completedPicks: number
    currentOverall: number | null
    currentRound: number | null
    currentSlot: number | null
    currentManager: string | null
    currentSlotType: 'human' | 'cpu' | null
    isViewerOnClock: boolean
    remainingSeconds: number | null
  }
  slotConfig: Array<{
    slot: number
    type: 'human' | 'cpu'
    userId?: string | null
    displayName?: string | null
  }>
  results: SessionPick[]
  summary?: {
    topPicks: SessionPick[]
  } | null
}

type MockDraftSessionBoardProps = {
  draftId: string
  canManage?: boolean
}

export function MockDraftSessionBoard({ draftId, canManage = false }: MockDraftSessionBoardProps) {
  const [draft, setDraft] = useState<SessionDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [submittingPick, setSubmittingPick] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playerName, setPlayerName] = useState('')
  const [position, setPosition] = useState('')
  const [team, setTeam] = useState('')
  const [settingsForm, setSettingsForm] = useState({
    timerSeconds: 60,
    rounds: 15,
    poolType: 'all',
    roomMode: 'solo',
    humanTeams: 1,
  })

  const loadDraft = useCallback(async () => {
    const res = await fetch(`/api/mock-draft/${draftId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Unable to load draft')
      return
    }
    const nextDraft = data.draft as SessionDraft
    setDraft(nextDraft)
    setSettingsForm({
      timerSeconds: Number(nextDraft.settings?.timerSeconds || 60),
      rounds: Number(nextDraft.settings?.rounds || 15),
      poolType: String(nextDraft.settings?.poolType || 'all'),
      roomMode: String(nextDraft.settings?.roomMode || 'solo'),
      humanTeams: Number(nextDraft.settings?.humanTeams || 1),
    })
    setError(null)
  }, [draftId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadDraft()
      .catch(() => {
        if (alive) setError('Unable to load draft')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [loadDraft])

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    const run = async () => {
      const since = draft?.updatedAt || new Date(0).toISOString()
      const res = await fetch(`/api/mock-draft/${draftId}/events?since=${encodeURIComponent(since)}`)
      const data = await res.json().catch(() => ({}))
      if (cancelled || !res.ok) return
      if (data.changed && data.draft) {
        setDraft(data.draft)
      }
    }
    const interval = setInterval(run, 3500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [draftId, draft?.updatedAt])

  const recentPicks = useMemo(() => {
    if (!draft) return []
    return [...draft.results].slice(-10).reverse()
  }, [draft])

  const saveSettings = async () => {
    if (!canManage) return
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/mock-draft/${draftId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timerSeconds: settingsForm.timerSeconds,
          rounds: settingsForm.rounds,
          poolType: settingsForm.poolType,
          roomMode: settingsForm.roomMode,
          humanTeams: settingsForm.humanTeams,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not update settings')
        return
      }
      await loadDraft()
    } finally {
      setSavingSettings(false)
    }
  }

  const submitPick = async () => {
    if (!playerName.trim() || !position.trim()) return
    setSubmittingPick(true)
    try {
      const res = await fetch(`/api/mock-draft/${draftId}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: playerName.trim(),
          position: position.trim().toUpperCase(),
          team: team.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not submit pick')
        return
      }
      if (data.draft) setDraft(data.draft)
      setPlayerName('')
      setPosition('')
      setTeam('')
      setError(null)
    } finally {
      setSubmittingPick(false)
    }
  }

  const createShareLink = async () => {
    setSharing(true)
    try {
      const res = await fetch('/api/mock-draft/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.shareId) {
        setError(data.error || 'Could not create share link')
        return
      }
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      const url = `${base}/mock-draft/share/${data.shareId}`
      setShareUrl(url)
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {})
      }
      await loadDraft()
    } finally {
      setSharing(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/12 bg-black/25 p-4 text-sm text-white/70">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (!draft) return null

  return (
    <section className="space-y-3 rounded-2xl border border-white/12 bg-black/25 p-4 text-xs text-white/80" data-testid="mock-draft-session-board">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          Mock Session - {draft.settings.sport} - {draft.status.replace('_', ' ')}
        </p>
        <div className="flex items-center gap-2">
          <a
            href={`/mock-draft/${encodeURIComponent(draft.id)}/replay`}
            className="rounded-lg border border-white/20 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
            data-testid="mock-draft-open-replay"
          >
            Open replay
          </a>
          <p className="text-[11px] text-white/60">
            {draft.progress?.completedPicks ?? draft.results.length}/{draft.progress?.totalPicks ?? draft.settings.numTeams * draft.settings.rounds} picks
          </p>
        </div>
      </div>

      {draft.progress?.currentOverall && draft.status === 'in_progress' && (
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
          <p className="text-[11px] text-cyan-200">
            On the clock: #{draft.progress.currentOverall} - {draft.progress.currentManager || 'Manager'}
            {draft.progress.remainingSeconds != null ? ` (${draft.progress.remainingSeconds}s)` : ''}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-amber-200 flex items-center justify-between gap-2">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null)
              loadDraft().catch(() => setError('Unable to refresh draft state'))
            }}
            className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
            data-testid="mock-draft-session-refresh"
          >
            Refresh
          </button>
        </div>
      )}

      {canManage && draft.status === 'pre_draft' && (
        <div className="grid gap-2 rounded-xl border border-white/10 bg-black/30 p-3 sm:grid-cols-5" data-testid="mock-draft-settings-panel">
          <label className="space-y-1">
            <span className="text-[11px] text-white/60">Timer</span>
            <input
              value={settingsForm.timerSeconds}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, timerSeconds: Number(e.target.value) || 0 }))}
              className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-white/60">Rounds</span>
            <input
              value={settingsForm.rounds}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, rounds: Number(e.target.value) || 1 }))}
              className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-white/60">Pool</span>
            <select
              value={settingsForm.poolType}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, poolType: e.target.value }))}
              className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-white"
            >
              <option value="all">all</option>
              <option value="rookies">rookies</option>
              <option value="vets">vets</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-white/60">Room</span>
            <select
              value={settingsForm.roomMode}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, roomMode: e.target.value }))}
              className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-white"
            >
              <option value="solo">solo</option>
              <option value="mixed">mixed</option>
              <option value="linked_public">linked public</option>
              <option value="cpu_only">cpu only</option>
            </select>
          </label>
          <button
            type="button"
            onClick={saveSettings}
            disabled={savingSettings}
            className="inline-flex items-center justify-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-1 text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
            data-testid="mock-draft-settings-save"
          >
            {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      )}

      {draft.progress?.isViewerOnClock && draft.status === 'in_progress' && (
        <div className="grid gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3 sm:grid-cols-4">
          <input
            placeholder="Player"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-1 text-white"
          />
          <input
            placeholder="POS"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-1 text-white"
          />
          <input
            placeholder="Team"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-1 text-white"
          />
          <button
            type="button"
            onClick={submitPick}
            disabled={submittingPick || !playerName.trim() || !position.trim()}
            className="rounded border border-cyan-500/40 bg-cyan-500/20 px-2 py-1 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
            data-testid="mock-draft-submit-pick"
          >
            {submittingPick ? 'Submitting...' : 'Submit pick'}
          </button>
        </div>
      )}

      {draft.status === 'completed' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-green-100">
          <span>Mock completed.</span>
          <button
            type="button"
            onClick={createShareLink}
            disabled={sharing}
            className="inline-flex items-center gap-1 rounded border border-green-400/40 px-2 py-1 text-[11px] hover:bg-green-400/15 disabled:opacity-50"
            data-testid="mock-draft-share-complete"
          >
            {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
            {sharing ? 'Sharing...' : 'Share summary'}
          </button>
          {shareUrl && <span className="text-[11px] text-green-200">{shareUrl}</span>}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <p className="mb-2 text-[11px] font-semibold text-white/90">Recent picks</p>
        {recentPicks.length === 0 ? (
          <p className="text-white/55">No picks yet.</p>
        ) : (
          <ul className="space-y-2 text-[11px]">
            {recentPicks.map((pick, index) => {
              const display = buildDraftPlayerDisplayModel({
                playerName: pick.playerName,
                position: pick.position,
                team: pick.team ?? null,
                playerId: pick.playerId ?? null,
                byeWeek: pick.byeWeek ?? null,
                injuryStatus: pick.injuryStatus ?? null,
                sport: draft.settings.sport,
              })
              return (
                <li key={`${pick.overall}-${pick.playerName}`} data-testid={`mock-draft-session-pick-${index}`}>
                  <p className="mb-1 text-[11px] text-white/60">#{pick.overall} · {pick.manager}</p>
                  <DraftPlayerCard
                    display={display}
                    name={pick.playerName}
                    position={pick.position}
                    team={pick.team ?? null}
                    byeWeek={pick.byeWeek ?? null}
                    variant="row"
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

