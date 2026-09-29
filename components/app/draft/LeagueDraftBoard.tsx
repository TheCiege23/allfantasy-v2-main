'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Users, Maximize2, Minimize2, MessageCircle, ArrowRight } from 'lucide-react'

type AdpEntry = {
  name: string
  position: string
  team: string | null
  adp?: number | null
  value?: number | null
}

export type DraftBoardConfig = {
  rounds: number
  timer_seconds: number | null
  leagueSize: number
}

type LeagueDraftBoardProps = {
  leagueId: string
  entries: AdpEntry[]
  onAddToQueue: (item: { id: string; name: string; position: string; team: string; rank: number }) => void
  /** When provided, uses sport/variant draft config; otherwise falls back to defaults. */
  config?: DraftBoardConfig | null
}

type DraftPick = {
  overall: number
  round: number
  slot: number
  teamName: string
  playerName: string
  position: string
  team: string | null
}

const DEFAULT_TEAMS = 12
const DEFAULT_ROUNDS = 15
const DEFAULT_SECONDS_PER_PICK = 60

export function LeagueDraftBoard({ leagueId, entries, onAddToQueue, config }: LeagueDraftBoardProps) {
  const [numTeams, setNumTeams] = useState(config?.leagueSize ?? DEFAULT_TEAMS)
  const [numRounds, setNumRounds] = useState(config?.rounds ?? DEFAULT_ROUNDS)
  const [secondsPerPick, setSecondsPerPick] = useState(config?.timer_seconds ?? DEFAULT_SECONDS_PER_PICK)
  const [picks, setPicks] = useState<DraftPick[]>([])
  useEffect(() => {
    if (config) {
      if (config.leagueSize != null) setNumTeams(config.leagueSize)
      if (config.rounds != null) setNumRounds(config.rounds)
      if (config.timer_seconds != null) setSecondsPerPick(config.timer_seconds)
    }
  }, [config?.leagueSize, config?.rounds, config?.timer_seconds])
  const [isPaused, setIsPaused] = useState(false)
  const [bigScreen, setBigScreen] = useState(false)
  const [inviteLink] = useState<string>(() => `${process.env.NEXT_PUBLIC_APP_URL || ''}/leagues/${encodeURIComponent(leagueId)}/draft`)

  const totalPicks = numTeams * numRounds
  const currentOverall = picks.length + 1
  const draftComplete = currentOverall > totalPicks

  const teams = useMemo(
    () => Array.from({ length: numTeams }, (_, i) => `Team ${i + 1}`),
    [numTeams],
  )

  const [tickBase, setTickBase] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => {
      if (!isPaused && !draftComplete) {
        setTickBase((prev) => prev)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [isPaused, draftComplete])

  const timeRemaining = useMemo(() => {
    if (draftComplete) return 0
    const elapsedSec = Math.floor((Date.now() - tickBase) / 1000)
    const remaining = secondsPerPick - (elapsedSec % secondsPerPick)
    return Math.max(0, remaining)
  }, [draftComplete, secondsPerPick, tickBase])

  const currentRound = useMemo(
    () => Math.ceil(currentOverall / numTeams),
    [currentOverall, numTeams],
  )
  const currentSlotInRound = useMemo(
    () => ((currentOverall - 1) % numTeams),
    [currentOverall, numTeams],
  )
  const currentTeamName = draftComplete ? null : teams[currentSlotInRound]

  const sortedEntries = useMemo(() => {
    return [...entries]
      .filter((e) => e && e.name)
      .sort((a, b) => {
        const aAdp = a.adp ?? Number.MAX_SAFE_INTEGER
        const bAdp = b.adp ?? Number.MAX_SAFE_INTEGER
        if (aAdp !== bAdp) return aAdp - bAdp
        const aVal = (b.value ?? 0) - (a.value ?? 0)
        return aVal
      })
  }, [entries])

  const draftedNames = useMemo(() => new Set(picks.map((p) => p.playerName)), [picks])

  const availablePlayers = useMemo(
    () => sortedEntries.filter((e) => !draftedNames.has(e.name)),
    [sortedEntries, draftedNames],
  )

  function handleDraftPlayer(player: AdpEntry) {
    if (draftComplete) return
    const overall = currentOverall
    const round = currentRound
    const slot = currentSlotInRound
    const teamName = teams[slot]

    setPicks((prev) => [
      ...prev,
      {
        overall,
        round,
        slot,
        teamName,
        playerName: player.name,
        position: player.position,
        team: player.team ?? null,
      },
    ])
    setTickBase(Date.now())
  }

  function handleUndoLastPick() {
    setPicks((prev) => prev.slice(0, -1))
    setTickBase(Date.now())
  }

  function handleResetDraft() {
    setPicks([])
    setTickBase(Date.now())
  }

  function handleCopyInvite() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(inviteLink).catch(() => {})
    }
  }

  return (
    <div className={bigScreen ? 'space-y-4 xl:col-span-2' : 'space-y-4'}>
      {/* Current pick header */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/12 bg-gradient-to-r from-black/60 via-cyan-950/40 to-black/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/40">
              <LayoutIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Live Draft Board</p>
              <p className="text-sm text-white/80">
                Round {currentRound > numRounds ? numRounds : currentRound} · Pick {draftComplete ? '-' : currentOverall} of {totalPicks}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/70">
            <div className="flex items-center gap-1 rounded-full bg-black/40 px-3 py-1">
              <Clock className="h-3.5 w-3.5 text-cyan-300" />
              <span className="font-mono text-sm">
                {String(Math.floor(timeRemaining / 60)).padStart(2, '0')}:
                {String(timeRemaining % 60).padStart(2, '0')}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-1 rounded-full bg-black/40 px-3 py-1">
              <Users className="h-3.5 w-3.5 text-cyan-300" />
              <span>{numTeams}-team · {numRounds} rounds</span>
            </div>
            <button
              type="button"
              onClick={() => setIsPaused((v) => !v)}
              className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] text-white/80 hover:bg-white/10"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => setBigScreen((v) => !v)}
              className="hidden rounded-full border border-white/20 px-2.5 py-1 text-[11px] text-white/80 hover:bg-white/10 sm:inline-flex"
            >
              {bigScreen ? (
                <>
                  <Minimize2 className="mr-1 h-3 w-3" /> Exit big screen
                </>
              ) : (
                <>
                  <Maximize2 className="mr-1 h-3 w-3" /> Big screen
                </>
              )}
            </button>
          </div>
        </div>
        {!draftComplete && currentTeamName && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-50">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/40 text-[11px] font-semibold">
                {currentRound}-{currentSlotInRound + 1}
              </span>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-cyan-200">On the clock</p>
                <p className="text-sm font-semibold text-white">{currentTeamName}</p>
              </div>
            </div>
            <p className="text-[11px] text-cyan-100/80">
              Select a player from the list to assign this pick. Autopick from queue is not yet enabled.
            </p>
          </div>
        )}
      </div>

      {/* Main layout: board + right rail */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)]">
        {/* Board grid */}
        <div className="overflow-hidden rounded-2xl border border-white/12 bg-black/40">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] text-white/70">
            <span>Draft board</span>
            <span className="text-white/50">
              Tap/hover cells to see picks. Scroll horizontally to see all teams.
            </span>
          </div>
          <div className="relative max-h-[420px] overflow-auto">
            <table className="min-w-full border-separate border-spacing-0 text-[11px] text-white/80">
              <thead className="sticky top-0 z-10 bg-black/80 backdrop-blur">
                <tr>
                  <th className="sticky left-0 z-20 bg-black/90 px-2 py-1 text-left text-[11px] font-semibold text-white/60">
                    Round
                  </th>
                  {teams.map((name, idx) => (
                    <th key={idx} className="min-w-[110px] border-b border-l border-white/10 px-2 py-1 text-left text-[11px] font-semibold text-white/70">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: numRounds }).map((_, rIdx) => (
                  <tr key={rIdx}>
                    <td className="sticky left-0 z-10 border-b border-white/10 bg-black/90 px-2 py-1 text-xs font-semibold text-white/70">
                      {rIdx + 1}
                    </td>
                    {teams.map((_, tIdx) => {
                      const overall = rIdx * numTeams + (tIdx + 1)
                      const pick = picks.find((p) => p.overall === overall)
                      const isCurrent = !draftComplete && overall === currentOverall
                      return (
                        <td
                          key={tIdx}
                          className={`border-b border-l border-white/10 px-2 py-1 align-top ${
                            isCurrent ? 'bg-cyan-500/15 ring-1 ring-cyan-400/60' : 'bg-black/40'
                          }`}
                        >
                          {pick ? (
                            <div className="space-y-0.5">
                              <p className="truncate text-[11px] font-semibold text-white">
                                {pick.playerName}
                              </p>
                              <p className="text-[11px] text-white/60">
                                {pick.position} · {pick.team || 'FA'}
                              </p>
                              <p className="text-[11px] text-white/40">Pick {overall}</p>
                            </div>
                          ) : (
                            <p className="text-[11px] text-white/25">Pick {overall}</p>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right rail: available players + recent picks + chat & commissioner controls */}
        <div className="space-y-3">
          {/* Available players */}
          <section className="space-y-2 rounded-2xl border border-white/12 bg-black/35 p-3 text-xs text-white/80">
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/60">
                  <Users className="h-3.5 w-3.5 text-cyan-300" />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-white">Available players</p>
                  <p className="text-[11px] text-white/65">
                    Tap to draft or add to queue. Sorted by ADP.
                  </p>
                </div>
              </div>
            </header>
            <div className="max-h-[220px] space-y-1.5 overflow-auto rounded-xl border border-white/10 bg-black/40 px-1 py-1.5">
              {availablePlayers.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-white/55">
                  All ADP players have been drafted. Use the commissioner controls below to reset the board if needed.
                </p>
              ) : (
                availablePlayers.slice(0, 60).map((p, idx) => {
                  const id = `${p.name}-${p.position}-${p.team ?? 'FA'}`
                  const rank = idx + 1
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] hover:bg-white/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">
                          {rank}. {p.name}
                        </p>
                        <p className="text-[11px] text-white/60">
                          {p.position} · {p.team || 'FA'}{' '}
                          {typeof p.adp === 'number' && (
                            <span className="ml-1 text-[11px] text-white/45">ADP {p.adp.toFixed(1)}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onAddToQueue({
                              id,
                              name: p.name,
                              position: p.position,
                              team: p.team || '',
                              rank,
                            })
                          }
                          className="rounded-full border border-white/25 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/10"
                        >
                          Queue
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDraftPlayer(p)}
                          className="inline-flex items-center gap-1 rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/35"
                        >
                          Draft
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          {/* Recent picks */}
          <section className="space-y-2 rounded-2xl border border-white/12 bg-black/35 p-3 text-xs text-white/80">
            <header className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Recent picks</p>
              <span className="text-[11px] text-white/60">
                Showing last 8 picks
              </span>
            </header>
            <ul className="space-y-1.5 text-[11px]">
              {picks.slice(-8).reverse().map((p) => (
                <li
                  key={p.overall}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/12 bg-black/45 px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">
                      {p.playerName}
                    </p>
                    <p className="text-[11px] text-white/60">
                      {p.position} · {p.team || 'FA'} · {p.teamName}
                    </p>
                  </div>
                  <p className="text-[11px] text-white/50">
                    R{p.round} · P{p.overall}
                  </p>
                </li>
              ))}
              {picks.length === 0 && (
                <li className="rounded-lg border border-dashed border-white/15 bg-black/40 px-2.5 py-2 text-[11px] text-white/55">
                  No picks have been made yet. Once players are drafted, they will appear here.
                </li>
              )}
            </ul>
          </section>

          {/* Chat & commissioner controls */}
          <section className="space-y-2 rounded-2xl border border-white/12 bg-black/35 p-3 text-xs text-white/80">
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/60">
                  <MessageCircle className="h-3.5 w-3.5 text-cyan-300" />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-white">Draft room tools</p>
                  <p className="text-[11px] text-white/65">
                    Share your draft link and control the room.
                  </p>
                </div>
              </div>
            </header>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={inviteLink}
                  readOnly
                  className="w-full rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white/70"
                />
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  className="rounded-lg border border-cyan-400/60 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                >
                  Copy
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                <button
                  type="button"
                  onClick={handleUndoLastPick}
                  className="rounded-full border border-white/25 px-2.5 py-0.5 hover:bg-white/10"
                  disabled={picks.length === 0}
                >
                  Undo last pick
                </button>
                <button
                  type="button"
                  onClick={handleResetDraft}
                  className="rounded-full border border-red-400/60 px-2.5 py-0.5 text-red-200 hover:bg-red-500/15"
                  disabled={picks.length === 0}
                >
                  Reset board
                </button>
                <span className="ml-auto text-[11px] text-white/45">
                  Commissioner tools are local only in this preview. League‑attached live drafts can reuse this shell.
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function LayoutIcon() {
  return (
    <div className="grid h-6 w-6 grid-cols-3 grid-rows-2 gap-0.5">
      <span className="rounded-sm bg-cyan-400/70" />
      <span className="rounded-sm bg-cyan-400/40" />
      <span className="rounded-sm bg-cyan-400/25" />
      <span className="rounded-sm bg-cyan-400/25" />
      <span className="rounded-sm bg-cyan-400/40" />
      <span className="rounded-sm bg-cyan-400/70" />
    </div>
  )
}

