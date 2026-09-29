"use client"

import { useMemo, useState } from "react"
import { Trophy, ChevronDown, ChevronUp } from "lucide-react"
import { BracketProView } from "./BracketProView"

type StandingRow = {
  entryId: string
  entryName: string
  userId?: string
  displayName?: string | null
  avatarUrl?: string | null
  ownerName?: string
  totalPoints?: number
  points?: number
  roundCorrect?: Record<number, number>
  championPick?: string | null
  maxPossible?: number
}

type Node = {
  id: string
  slot: string
  round: number
  region: string | null
  seedHome: number | null
  seedAway: number | null
  homeTeamName: string | null
  awayTeamName: string | null
  sportsGameId: string | null
  nextNodeId: string | null
  nextNodeSide: string | null
  game: any
}

const ROUND_HEADERS = [
  { round: 1, label: "64" },
  { round: 2, label: "32" },
  { round: 3, label: "16" },
  { round: 4, label: "8" },
  { round: 5, label: "4" },
  { round: 6, icon: true },
]
const ROUND_MAX: Record<number, number> = { 1: 32, 2: 16, 3: 8, 4: 4, 5: 2, 6: 1 }

function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = (name || "?").slice(0, 2).toUpperCase()
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full bg-gradient-to-br from-orange-400 to-amber-600 flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  )
}

function BracketScoreCard({
  row,
  rank,
  isExpanded,
  onToggle,
}: {
  row: StandingRow & { rank: number }
  rank: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const pts = row.totalPoints ?? row.points ?? 0
  const roundCorrect = row.roundCorrect ?? {}
  const champion = row.championPick
  const maxPossible = row.maxPossible ?? 0
  const name = row.displayName ?? row.ownerName ?? row.entryName

  return (
    <button
      onClick={onToggle}
      className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-white/5 transition rounded-xl"
    >
      <div className="w-5 text-xs font-bold text-white/50 text-right flex-shrink-0">
        {rank}
      </div>
      <Avatar name={name} url={row.avatarUrl} size={26} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{name}</div>
        {row.entryName !== name && (
          <div className="text-[11px] text-white/30 truncate">{row.entryName}</div>
        )}
      </div>

      <div className="flex items-center gap-0 flex-shrink-0">
        {ROUND_HEADERS.map((rh) => (
          <div key={rh.round} className="w-7 text-center">
            <div className="text-[11px] font-bold text-white/30 tabular-nums">
              {rh.icon ? "" : ROUND_MAX[rh.round]}
            </div>
            <div className={`text-[11px] font-bold tabular-nums ${(roundCorrect[rh.round] ?? 0) > 0 ? "text-white" : "text-white/15"}`}>
              {roundCorrect[rh.round] ?? 0}
            </div>
          </div>
        ))}
        <div className="w-4 flex items-center justify-center">
          <Trophy className="h-2.5 w-2.5 text-amber-400/50" />
        </div>
      </div>

      <div className="text-xl font-bold text-white tabular-nums w-12 text-right flex-shrink-0">
        {pts}
      </div>

      <div className="flex-shrink-0 text-white/30">
        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </div>
    </button>
  )
}

export function PoolBrackets({
  standings,
  nodes,
  tournamentId,
  leagueId,
  currentUserId,
  allPicks,
}: {
  standings: StandingRow[]
  nodes: Node[]
  tournamentId: string
  leagueId: string
  currentUserId: string
  allPicks: Record<string, Record<string, string | null>>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const ranked = useMemo(() => {
    return standings.map((r, idx) => ({ ...r, rank: idx + 1 }))
  }, [standings])

  const userEntries = ranked.filter((r) => r.userId === currentUserId)
  const otherEntries = ranked.filter((r) => r.userId !== currentUserId)

  function toggleExpand(entryId: string) {
    setExpanded((prev) => (prev === entryId ? null : entryId))
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-white/60 px-1">Pool Brackets</h2>

      {userEntries.map((r) => (
        <div key={r.entryId} className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur overflow-hidden">
          <BracketScoreCard
            row={r}
            rank={r.rank}
            isExpanded={expanded === r.entryId}
            onToggle={() => toggleExpand(r.entryId)}
          />
          {expanded === r.entryId && (
            <div className="border-t border-white/5 p-2">
              <BracketProView
                tournamentId={tournamentId}
                leagueId={leagueId}
                entryId={r.entryId}
                nodes={nodes}
                initialPicks={allPicks[r.entryId] ?? {}}
              />
            </div>
          )}
        </div>
      ))}

      {otherEntries.map((r) => (
        <div key={r.entryId} className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur overflow-hidden">
          <BracketScoreCard
            row={r}
            rank={r.rank}
            isExpanded={expanded === r.entryId}
            onToggle={() => toggleExpand(r.entryId)}
          />
          {expanded === r.entryId && (
            <div className="border-t border-white/5 p-2">
              <BracketProView
                tournamentId={tournamentId}
                leagueId={leagueId}
                entryId={r.entryId}
                nodes={nodes}
                initialPicks={allPicks[r.entryId] ?? {}}
              />
            </div>
          )}
        </div>
      ))}

      {ranked.length === 0 && (
        <div className="text-center text-sm text-white/30 py-8">No brackets submitted yet</div>
      )}
    </div>
  )
}
