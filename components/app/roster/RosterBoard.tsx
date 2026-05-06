"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { ChevronsDown, Users, Activity, Info, ArrowRightLeft } from "lucide-react"
import { useRosterManager, type RosterPlayer, type RosterSectionKey } from "./useRosterManager"
import LineupLockBanner from "./LineupLockBanner"
import { teamLogoUrl } from "@/lib/media-url"
import PlayerCardAnalytics from "@/components/player-card/PlayerCardAnalytics"
import { useUserTimezone } from "@/hooks/useUserTimezone"

type RosterBoardProps = {
  leagueId?: string
}

type DragState = {
  playerId: string
  fromSlot: RosterSectionKey
} | null

type ActiveSwapState = {
  playerId: string
  slot: RosterSectionKey
  name: string
} | null

const SECTION_DEFINITIONS: { key: RosterSectionKey; label: string }[] = [
  { key: "starters", label: "Starters" },
  { key: "bench", label: "Bench" },
  { key: "ir", label: "IR" },
  { key: "taxi", label: "Taxi" },
  { key: "devy", label: "Devy" },
]

const EMPTY_ROSTER = {
  starters: [],
  bench: [],
  ir: [],
  taxi: [],
  devy: [],
} as const

const SWAPPABLE_SLOTS: RosterSectionKey[] = ["starters", "bench"]

function isSleeperSwapSlot(slot: RosterSectionKey): boolean {
  return SWAPPABLE_SLOTS.includes(slot)
}

export default function RosterBoard({ leagueId }: RosterBoardProps) {
  const { formatTimeInTimezone } = useUserTimezone()
  const {
    roster,
    leagueSport,
    saving,
    saveError,
    lastSavedAt,
    lineupLock,
    canEditLineup,
    slotLimits,
    availablePlayers,
    poolLoading,
    movePlayer,
    swapPlayers,
    dropPlayer,
    addPlayerFromPool,
    optimizeLineup,
  } = useRosterManager({
    leagueId,
  })
  const [drag, setDrag] = useState<DragState>(null)
  const [activeSwap, setActiveSwap] = useState<ActiveSwapState>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<RosterPlayer | null>(null)
  const [poolSearch, setPoolSearch] = useState("")
  const [poolSlot, setPoolSlot] = useState<RosterSectionKey>("bench")
  const [poolPlayerId, setPoolPlayerId] = useState("")
  const rosterState = roster ?? EMPTY_ROSTER

  const handleDropOnSection = (slot: RosterSectionKey) => {
    if (!drag) return
    const moved = movePlayer(drag.playerId, slot)
    if (moved) {
      setActiveSwap(null)
      setDrag(null)
    }
  }

  const handleDropOnPlayer = (targetId: string) => {
    if (!drag) return
    const swapped = swapPlayers(drag.playerId, targetId)
    if (swapped) {
      setActiveSwap(null)
      setDrag(null)
    }
  }

  const handleSleeperStyleTap = (player: RosterPlayer) => {
    if (!isSleeperSwapSlot(player.slot)) {
      setSelectedPlayer(player)
      return
    }
    if (!activeSwap) {
      setActiveSwap({ playerId: player.id, slot: player.slot, name: player.name })
      return
    }
    if (activeSwap.playerId === player.id) {
      setActiveSwap(null)
      return
    }
    const swapped = swapPlayers(activeSwap.playerId, player.id)
    if (swapped) {
      setActiveSwap(null)
    }
  }

  const filteredPool = availablePlayers
    .filter((p) => {
      if (!poolSearch.trim()) return true
      const q = poolSearch.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        (p.position ?? "").toLowerCase().includes(q) ||
        (p.team ?? "").toLowerCase().includes(q)
      )
    })
    .slice(0, 100)

  const visibleSections = useMemo(
    () =>
      SECTION_DEFINITIONS.filter((section) => {
        const limit = Number(slotLimits[section.key] ?? 0)
        return limit > 0 || rosterState[section.key].length > 0
      }),
    [slotLimits, rosterState]
  )
  const addTargetSections = useMemo(
    () => visibleSections.filter((section) => Number(slotLimits[section.key] ?? 0) > 0),
    [visibleSections, slotLimits]
  )
  const resolvedPoolSlot = addTargetSections.some((s) => s.key === poolSlot)
    ? poolSlot
    : (addTargetSections[0]?.key ?? "bench")

  useEffect(() => {
    if (poolSlot !== resolvedPoolSlot) {
      setPoolSlot(resolvedPoolSlot)
    }
  }, [poolSlot, resolvedPoolSlot])

  if (!roster) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-white/70">
        Loading roster...
      </div>
    )
  }

  return (
    <section className="space-y-2.5 text-xs">
      <header className="rounded-2xl border border-white/10 bg-[#050a18]/95 p-2.5 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-[#0a1228]">
              <Users className="h-3.5 w-3.5 text-white/70" />
            </div>
            <div className="leading-tight">
              <p className="text-[13px] font-semibold text-white/95">Roster</p>
              <p className="hidden text-[10px] text-white/65 sm:block">
                Sleeper-style lineup flow: tap player, then tap swap target.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={optimizeLineup}
            disabled={!canEditLineup}
            className="inline-flex items-center gap-1 rounded-full border border-cyan-300/35 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Activity className="h-3 w-3" />
            <span>Optimize lineup</span>
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
          {saving && <span className="text-white/70">Saving…</span>}
          {!saving && !saveError && lastSavedAt && (
            <span className="text-white/65">
              Saved {formatTimeInTimezone(lastSavedAt)}
            </span>
          )}
          {saveError && (
            <span className="rounded-full border border-red-300/25 bg-red-500/10 px-2 py-0.5 text-red-200">
              {saveError}
            </span>
          )}
        </div>
      </header>

      <LineupLockBanner lineupLock={lineupLock} canEditLineup={canEditLineup} />

      {activeSwap && (
        <div className="rounded-xl border border-sky-300/30 bg-[#0b1630]/95 px-2.5 py-2 text-[10px] sm:text-[11px] text-sky-100">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span>
                Selected <strong>{activeSwap.name}</strong>. Tap a {activeSwap.slot === "starters" ? "bench" : "starter"} player to swap.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveSwap(null)}
                className="rounded border border-sky-200/30 px-2 py-0.5 text-[10px] hover:bg-sky-300/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        <div className="rounded-2xl border border-white/10 bg-[#070d1d]/95 p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-white/82">Add from player pool</p>
            <span className="text-[10px] text-white/45">
              {poolLoading ? "Loading…" : `${availablePlayers.length} available`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={poolSearch}
              onChange={(e) => setPoolSearch(e.target.value)}
              placeholder="Search free agents"
              aria-label="Search available players"
              className="flex-1 min-w-[160px] rounded-xl border border-white/12 bg-[#030814]/90 px-2 py-1.5 text-[10px] sm:text-[11px] text-white/95 placeholder:text-white/35"
            />
            <select
              aria-label="Choose roster section for add"
              value={resolvedPoolSlot}
              onChange={(e) => setPoolSlot(e.target.value as RosterSectionKey)}
              className="rounded-xl border border-white/12 bg-[#030814]/90 px-2 py-1.5 text-[10px] sm:text-[11px] text-white/90"
            >
              {addTargetSections.map((section) => (
                <option key={section.key} value={section.key}>
                  {section.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Available player list"
              value={poolPlayerId}
              onChange={(e) => setPoolPlayerId(e.target.value)}
              className="flex-1 min-w-[220px] rounded-xl border border-white/12 bg-[#030814]/90 px-2 py-1.5 text-[10px] sm:text-[11px] text-white/90"
            >
              <option value="">Select player</option>
              {filteredPool.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.position ? `(${p.position})` : ""} {p.team ? `- ${p.team}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="roster-add-player-button"
              disabled={!poolPlayerId}
              onClick={() => {
                if (!poolPlayerId) return
                addPlayerFromPool(poolPlayerId, resolvedPoolSlot)
                setPoolPlayerId("")
              }}
              className="rounded-xl border border-white/20 bg-white/5 px-2.5 py-1.5 text-[10px] sm:text-[11px] text-white/85 hover:bg-white/10 disabled:opacity-50"
            >
              Add player
            </button>
          </div>
        </div>

        {visibleSections.map((section) => (
          <RosterSection
            key={section.key}
            label={section.label}
            slot={section.key}
            players={roster[section.key]}
            drag={drag}
            activeSwap={activeSwap}
            setDrag={setDrag}
            onDropSection={handleDropOnSection}
            onDropPlayer={handleDropOnPlayer}
            onMovePlayer={movePlayer}
            onSwapCancel={() => setActiveSwap(null)}
            onDrop={dropPlayer}
            sectionLimit={slotLimits[section.key]}
            onPlayerInspect={setSelectedPlayer}
            onPlayerTap={handleSleeperStyleTap}
            leagueSport={leagueSport}
            moveToBenchEnabled={Number(slotLimits.bench ?? 0) > 0}
            moveToIrEnabled={Number(slotLimits.ir ?? 0) > 0}
          />
        ))}
      </div>
      {selectedPlayer && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-label="Roster player details"
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#111219] p-4 text-white">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{selectedPlayer.name}</p>
                <p className="text-[11px] text-white/60">
                  {selectedPlayer.position} · {selectedPlayer.team}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlayer(null)}
                className="rounded border border-white/20 px-2 py-1 text-[10px] text-white/75 hover:bg-white/10"
              >
                Close
              </button>
            </div>
            <dl className="space-y-1 text-[11px] text-white/75">
              <div className="flex justify-between gap-2">
                <dt>Section</dt>
                <dd className="text-white/90">{selectedPlayer.slot}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Status</dt>
                <dd className="text-white/90">{selectedPlayer.status.toUpperCase()}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Projection</dt>
                <dd className="text-white/90">{selectedPlayer.projection.toFixed(1)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Game</dt>
                <dd className="text-white/90">{selectedPlayer.opponent}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <PlayerCardAnalytics
                playerId={selectedPlayer.id}
                playerName={selectedPlayer.name}
                position={selectedPlayer.position}
                team={selectedPlayer.team}
                sport={leagueSport}
                eager={false}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

type RosterSectionProps = {
  label: string
  slot: RosterSectionKey
  players: RosterPlayer[]
  drag: DragState
  activeSwap: ActiveSwapState
  setDrag: (s: DragState) => void
  onDropSection: (slot: RosterSectionKey) => void
  onDropPlayer: (id: string) => void
  onMovePlayer: (id: string, toSlot: RosterSectionKey) => boolean
  onSwapCancel: () => void
  onDrop: (id: string) => void
  sectionLimit?: number
  onPlayerTap: (player: RosterPlayer) => void
  onPlayerInspect: (player: RosterPlayer) => void
  leagueSport: string
  moveToBenchEnabled: boolean
  moveToIrEnabled: boolean
}

function RosterSection({
  label,
  slot,
  players,
  drag,
  activeSwap,
  setDrag,
  onDropSection,
  onDropPlayer,
  onMovePlayer,
  onSwapCancel,
  onDrop,
  sectionLimit,
  onPlayerTap,
  onPlayerInspect,
  leagueSport,
  moveToBenchEnabled,
  moveToIrEnabled,
}: RosterSectionProps) {
  const isEmpty = players.length === 0
  const activeSwapCanMoveToSection =
    !!activeSwap && activeSwap.slot !== slot && isSleeperSwapSlot(activeSwap.slot) && isSleeperSwapSlot(slot)

  return (
    <div
      className="rounded-2xl border border-[#1a2338] bg-[#060c1b]/95 p-2"
      data-testid={`roster-section-${slot}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (drag) onDropSection(slot)
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] sm:text-[11px] text-white/70">
        <div className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-[0.08em] text-white/78">{label}</span>
          <span className="rounded-full border border-white/12 px-1.5 py-0.5 text-[10px] text-white/50">
            {players.length}
            {typeof sectionLimit === "number" && sectionLimit > 0 ? ` / ${sectionLimit}` : ""}
          </span>
        </div>
        {activeSwapCanMoveToSection && (
          <button
            type="button"
            onClick={() => {
              if (!activeSwap) return
              const moved = onMovePlayer(activeSwap.playerId, slot)
              if (moved) onSwapCancel()
            }}
            className="rounded-full border border-sky-300/35 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-100 hover:bg-sky-500/20"
          >
            Move here
          </button>
        )}
      </div>
      <div className="space-y-1">
        {isEmpty ? (
          <div className="rounded-xl border border-dashed border-white/15 px-2 py-3 text-center text-[10px] text-white/35">
            Drag players here to assign to {label.toLowerCase()}.
          </div>
        ) : (
          players.map((p) => (
            <PlayerCard
              key={p.id}
              player={p}
              isDragging={drag?.playerId === p.id}
              isSwapActive={activeSwap?.playerId === p.id}
              isSwapCandidate={Boolean(
                activeSwap &&
                  activeSwap.playerId !== p.id &&
                  isSleeperSwapSlot(activeSwap.slot) &&
                  isSleeperSwapSlot(p.slot)
              )}
              onDragStart={() => setDrag({ playerId: p.id, fromSlot: slot })}
              onDropOn={() => onDropPlayer(p.id)}
              onMove={(toSlot) => onMovePlayer(p.id, toSlot)}
              onDropSelf={() => onDrop(p.id)}
              onTap={() => onPlayerTap(p)}
              onInspect={() => onPlayerInspect(p)}
              leagueSport={leagueSport}
              moveToBenchEnabled={moveToBenchEnabled}
              moveToIrEnabled={moveToIrEnabled}
            />
          ))
        )}
      </div>
    </div>
  )
}

type PlayerCardProps = {
  player: RosterPlayer
  isDragging: boolean
  isSwapActive: boolean
  isSwapCandidate: boolean
  onDragStart: () => void
  onDropOn: () => void
  onMove: (toSlot: RosterSectionKey) => void
  onDropSelf: () => void
  onTap: () => void
  onInspect: () => void
  leagueSport: string
  moveToBenchEnabled: boolean
  moveToIrEnabled: boolean
}

function PlayerCard({
  player,
  isDragging,
  isSwapActive,
  isSwapCandidate,
  onDragStart,
  onDropOn,
  onMove,
  onDropSelf,
  onTap,
  onInspect,
  leagueSport,
  moveToBenchEnabled,
  moveToIrEnabled,
}: PlayerCardProps) {
  const statusColor =
    player.status === "healthy"
      ? "bg-emerald-400"
      : player.status === "q"
      ? "bg-amber-400"
      : player.status === "out"
      ? "bg-red-500"
      : "bg-purple-400"
  const logo = player.team ? teamLogoUrl(player.team, leagueSport) : ''

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        onDragStart()
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropOn()
      }}
      onClick={() => {
        onTap()
      }}
      onTouchStart={() => {
        // placeholder: long-press detection for mobile can be wired here
      }}
      className={`group flex items-center justify-between gap-1.5 rounded-xl border px-2 py-1.5 text-xs transition ${
        isDragging
          ? "opacity-60 ring-2 ring-cyan-300/60"
          : isSwapActive
            ? "border-sky-300/70 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.25)_inset]"
            : isSwapCandidate
              ? "border-sky-300/35 bg-sky-500/5 hover:border-sky-200/55"
              : "border-[#1a2338] bg-[#070d1c] hover:border-[#2a3553]"
      }`}
      data-testid={`roster-player-card-${player.id}`}
    >
      <div className="flex flex-1 items-center gap-1.5 min-w-0">
        {player.headshotUrl && /^https?:\/\//i.test(player.headshotUrl) ? (
          <Image
            src={player.headshotUrl}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/10"
            unoptimized
          />
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#111a31] text-[9px] font-semibold text-white/90">
            {player.position}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {logo ? (
              <img
                src={logo}
                alt={`${player.team} logo`}
                data-testid={`roster-player-team-logo-${player.id}`}
                className="h-3.5 w-3.5 rounded object-contain"
                loading="lazy"
              />
            ) : null}
            <p className="truncate text-[10px] sm:text-[11px] font-semibold text-white/95">{player.name}</p>
            <span className="shrink-0 rounded bg-white/[0.06] px-1 py-0 text-[8px] font-semibold text-white/55">
              {player.position}
            </span>
            <span className="text-[9px] text-[#7f8aa6]">{player.team}</span>
          </div>
          <p className="truncate text-[9px] sm:text-[10px] text-[#6b7696]">
            {player.opponent} • {player.gameTime}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0 text-right">
        <div className="flex items-center gap-1 text-[9px] sm:text-[10px]">
          <span className="text-white/40">P</span>
          <span className="font-semibold text-white/90">{player.projection.toFixed(1)}</span>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-[10px]">
          <span className="text-white/40">A</span>
          <span className="font-semibold text-white/75">
            {player.actual != null ? player.actual.toFixed(1) : "-"}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onInspect()
          }}
          data-testid={`roster-player-details-${player.id}`}
          className="rounded border border-white/12 bg-black/20 px-1 py-0.5 text-[8px] sm:text-[9px] text-white/75 hover:bg-white/10"
          aria-label={`Open details for ${player.name}`}
        >
          <Info className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
        </button>
        <span
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${statusColor}`}
          title={player.status.toUpperCase()}
        >
          <span className="text-[8px] font-bold text-black">
            {player.status === "healthy" ? "H" : player.status.toUpperCase()}
          </span>
        </span>
        {moveToBenchEnabled && player.slot !== "bench" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onMove("bench")
            }}
            data-testid={`roster-move-bench-${player.id}`}
            className="rounded border border-white/12 bg-black/20 px-1 py-0.5 text-[8px] sm:text-[9px] text-white/70 hover:bg-white/10"
          >
            Bench
          </button>
        )}
        {moveToIrEnabled && player.slot !== "ir" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onMove("ir")
            }}
            data-testid={`roster-move-ir-${player.id}`}
            className="rounded border border-white/12 bg-black/20 px-1 py-0.5 text-[8px] sm:text-[9px] text-white/70 hover:bg-white/10"
          >
            IR
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDropSelf()
          }}
          data-testid={`roster-drop-${player.id}`}
          className="inline-flex items-center justify-center rounded-full border border-white/12 bg-black/20 px-1 py-0.5 text-[8px] sm:text-[9px] text-white/70 hover:bg-white/10"
        >
          <ChevronsDown className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
        </button>
      </div>
    </div>
  )
}

