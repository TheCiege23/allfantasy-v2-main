'use client'

import { useMemo, useState, useEffect } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'
import { buildDraftPlayerDisplayModel } from '@/lib/draft-sports-models/build-display-model'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

type SharedReplayPick = {
  overall: number
  round: number
  pick: number
  manager: string
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  byeWeek?: number | null
  injuryStatus?: string | null
}

const SPEEDS = [
  { label: '0.75x', ms: 1200 },
  { label: '1x', ms: 800 },
  { label: '1.5x', ms: 520 },
  { label: '2x', ms: 300 },
]

export function MockDraftSharedReplayTimeline({
  picks,
  title,
  sport = DEFAULT_SPORT,
}: {
  picks: SharedReplayPick[]
  title: string
  sport?: string
}) {
  const normalizedSport = normalizeToSupportedSport(sport)
  const [visiblePicks, setVisiblePicks] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedIndex, setSpeedIndex] = useState(1)

  useEffect(() => {
    if (!playing) return
    if (visiblePicks >= picks.length) {
      setPlaying(false)
      return
    }
    const ms = SPEEDS[speedIndex]?.ms ?? 800
    const timer = setTimeout(() => setVisiblePicks((prev) => Math.min(picks.length, prev + 1)), ms)
    return () => clearTimeout(timer)
  }, [playing, visiblePicks, picks.length, speedIndex])

  const revealed = useMemo(() => picks.slice(0, visiblePicks), [picks, visiblePicks])
  const currentPick = revealed[revealed.length - 1] ?? null

  const byRound = useMemo(() => {
    const map = new Map<number, SharedReplayPick[]>()
    for (const pick of revealed) {
      const list = map.get(pick.round) ?? []
      list.push(pick)
      map.set(pick.round, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [revealed])

  return (
    <section className="space-y-4 rounded-2xl border border-white/12 bg-black/25 p-4 text-xs text-white/80" data-testid="mock-draft-shared-replay">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">{title} · Shared Replay</p>
        <p className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/75">
          {visiblePicks}/{picks.length} picks
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setVisiblePicks(0)}
          className="rounded-lg border border-white/20 px-2 py-1 hover:bg-white/10"
          data-testid="mock-draft-shared-replay-reset"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setVisiblePicks((prev) => Math.max(0, prev - 1))}
          className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 hover:bg-white/10"
        >
          <SkipBack className="h-3.5 w-3.5" />
          Prev
        </button>
        <button
          type="button"
          onClick={() => setPlaying((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-500/15 px-2 py-1 text-cyan-100 hover:bg-cyan-500/25"
          data-testid="mock-draft-shared-replay-play"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => setVisiblePicks((prev) => Math.min(picks.length, prev + 1))}
          className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 hover:bg-white/10"
        >
          Next
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <select
          value={String(speedIndex)}
          onChange={(e) => setSpeedIndex(Number(e.target.value))}
          className="rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-white"
          data-testid="mock-draft-shared-replay-speed"
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
        max={picks.length}
        value={visiblePicks}
        onChange={(e) => {
          setPlaying(false)
          setVisiblePicks(Number(e.target.value))
        }}
        className="w-full"
        data-testid="mock-draft-shared-replay-slider"
      />

      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <p className="mb-1 text-[11px] font-medium text-white/90">Current reveal</p>
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
                sport: normalizedSport,
              })}
              name={currentPick.playerName}
              position={currentPick.position}
              team={currentPick.team ?? null}
              byeWeek={currentPick.byeWeek ?? null}
              variant="row"
            />
          </div>
        ) : (
          <p className="text-[11px] text-white/55">Press play to start replay.</p>
        )}
      </div>

      <div className="space-y-3">
        {byRound.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/55">
            No picks revealed yet.
          </p>
        ) : (
          byRound.map(([round, roundPicks]) => (
            <div key={round} className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="mb-2 text-[11px] font-semibold text-cyan-200">Round {round}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {roundPicks.map((pick) => (
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
                        sport: normalizedSport,
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

