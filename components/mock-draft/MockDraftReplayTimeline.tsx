'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'
import { buildDraftPlayerDisplayModel } from '@/lib/draft-sports-models/build-display-model'

type ReplayPick = {
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

type ReplayDraft = {
  id: string
  status: string
  updatedAt: string
  settings: {
    sport: string
    draftType: string
    rounds: number
    numTeams: number
  }
  progress?: {
    totalPicks: number
    completedPicks: number
  }
  results: ReplayPick[]
}

const SPEEDS = [
  { label: '0.75x', ms: 1200 },
  { label: '1x', ms: 800 },
  { label: '1.5x', ms: 520 },
  { label: '2x', ms: 300 },
]

export function MockDraftReplayTimeline({ draftId }: { draftId: string }) {
  const [draft, setDraft] = useState<ReplayDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visiblePicks, setVisiblePicks] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedIndex, setSpeedIndex] = useState(1)

  const loadDraft = useCallback(async () => {
    const res = await fetch(`/api/mock-draft/${draftId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.draft) {
      setError(data.error || 'Unable to load replay.')
      return
    }
    setDraft(data.draft as ReplayDraft)
    setError(null)
  }, [draftId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadDraft()
      .catch(() => {
        if (!cancelled) setError('Unable to load replay.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadDraft])

  useEffect(() => {
    if (!draftId) return
    const poll = async () => {
      const since = draft?.updatedAt || new Date(0).toISOString()
      const res = await fetch(`/api/mock-draft/${draftId}/events?since=${encodeURIComponent(since)}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.changed && data.draft) {
        setDraft(data.draft as ReplayDraft)
      }
    }
    const id = setInterval(poll, 3500)
    return () => clearInterval(id)
  }, [draftId, draft?.updatedAt])

  const total = draft?.results.length ?? 0

  useEffect(() => {
    if (!playing || total === 0) return
    if (visiblePicks >= total) {
      setPlaying(false)
      return
    }
    const ms = SPEEDS[speedIndex]?.ms ?? 800
    const timer = setTimeout(() => {
      setVisiblePicks((prev) => Math.min(total, prev + 1))
    }, ms)
    return () => clearTimeout(timer)
  }, [playing, visiblePicks, total, speedIndex])

  const revealed = useMemo(() => (draft?.results ?? []).slice(0, visiblePicks), [draft?.results, visiblePicks])
  const currentPick = revealed.length > 0 ? revealed[revealed.length - 1] : null
  const nextPick = (draft?.results ?? [])[visiblePicks] ?? null

  const byRound = useMemo(() => {
    const map = new Map<number, ReplayPick[]>()
    for (const pick of revealed) {
      const list = map.get(pick.round) ?? []
      list.push(pick)
      map.set(pick.round, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [revealed])

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/12 bg-black/25 p-6 text-white/70">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
        <div className="flex items-center justify-between gap-2">
          <span>{error || 'Replay unavailable'}</span>
          <button
            type="button"
            onClick={() => {
              setError(null)
              loadDraft().catch(() => setError('Unable to refresh replay.'))
            }}
            className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
            data-testid="mock-draft-replay-refresh"
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/12 bg-black/25 p-4 text-xs text-white/80" data-testid="mock-draft-replay-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">
            Mock Replay - {draft.settings.sport}
          </p>
          <p className="text-[11px] text-white/60">
            {draft.settings.draftType} · {draft.settings.numTeams} teams · {draft.settings.rounds} rounds
          </p>
        </div>
        <p className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/75">
          {visiblePicks}/{total} picks shown
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setVisiblePicks(0)}
          className="rounded-lg border border-white/20 px-2 py-1 hover:bg-white/10"
          data-testid="mock-draft-replay-reset"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setVisiblePicks((prev) => Math.max(0, prev - 1))}
          className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 hover:bg-white/10"
          data-testid="mock-draft-replay-prev"
        >
          <SkipBack className="h-3.5 w-3.5" />
          Prev
        </button>
        <button
          type="button"
          onClick={() => setPlaying((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/15 px-2 py-1 text-cyan-100 hover:bg-cyan-500/25"
          data-testid="mock-draft-replay-play"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => setVisiblePicks((prev) => Math.min(total, prev + 1))}
          className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 hover:bg-white/10"
          data-testid="mock-draft-replay-next"
        >
          Next
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <select
          value={String(speedIndex)}
          onChange={(e) => setSpeedIndex(Number(e.target.value))}
          className="rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-white"
          data-testid="mock-draft-replay-speed"
        >
          {SPEEDS.map((speed, index) => (
            <option key={speed.label} value={index}>
              {speed.label}
            </option>
          ))}
        </select>
      </div>

      <input
        type="range"
        min={0}
        max={total}
        value={visiblePicks}
        onChange={(e) => {
          setPlaying(false)
          setVisiblePicks(Number(e.target.value))
        }}
        className="w-full"
        data-testid="mock-draft-replay-slider"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="mb-1 text-[11px] font-medium text-white/90">Current pick</p>
          {currentPick ? (
            <div className="space-y-1">
              <p className="text-[11px] text-white/60">#{currentPick.overall} · {currentPick.manager}</p>
              <DraftPlayerCard
                display={buildDraftPlayerDisplayModel({
                  playerName: currentPick.playerName,
                  position: currentPick.position,
                  team: currentPick.team ?? null,
                  playerId: currentPick.playerId ?? null,
                  byeWeek: currentPick.byeWeek ?? null,
                  injuryStatus: currentPick.injuryStatus ?? null,
                  sport: draft.settings.sport,
                })}
                name={currentPick.playerName}
                position={currentPick.position}
                team={currentPick.team ?? null}
                byeWeek={currentPick.byeWeek ?? null}
                variant="row"
              />
            </div>
          ) : (
            <p className="text-[11px] text-white/55">Replay has not started.</p>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="mb-1 text-[11px] font-medium text-white/90">Next up</p>
          {nextPick ? (
            <div className="space-y-1">
              <p className="text-[11px] text-white/60">#{nextPick.overall} · {nextPick.manager}</p>
              <DraftPlayerCard
                display={buildDraftPlayerDisplayModel({
                  playerName: nextPick.playerName,
                  position: nextPick.position,
                  team: nextPick.team ?? null,
                  playerId: nextPick.playerId ?? null,
                  byeWeek: nextPick.byeWeek ?? null,
                  injuryStatus: nextPick.injuryStatus ?? null,
                  sport: draft.settings.sport,
                })}
                name={nextPick.playerName}
                position={nextPick.position}
                team={nextPick.team ?? null}
                byeWeek={nextPick.byeWeek ?? null}
                variant="row"
              />
            </div>
          ) : (
            <p className="text-[11px] text-white/55">No remaining picks.</p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {byRound.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/55">
            Move the slider or press play to begin.
          </p>
        ) : (
          byRound.map(([round, picks]) => (
            <div key={round} className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="mb-2 text-[11px] font-semibold text-cyan-200">Round {round}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {picks.map((pick) => (
                  <div key={`${pick.overall}-${pick.playerName}`} className="rounded-lg border border-white/10 bg-black/35 p-2">
                    <p className="mb-1 text-[11px] text-white/60">#{pick.overall} · {pick.manager}</p>
                    <DraftPlayerCard
                      display={buildDraftPlayerDisplayModel({
                        playerName: pick.playerName,
                        position: pick.position,
                        team: pick.team ?? null,
                        playerId: pick.playerId ?? null,
                        byeWeek: pick.byeWeek ?? null,
                        injuryStatus: pick.injuryStatus ?? null,
                        sport: draft.settings.sport,
                      })}
                      name={pick.playerName}
                      position={pick.position}
                      team={pick.team ?? null}
                      byeWeek={pick.byeWeek ?? null}
                      variant="row"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

