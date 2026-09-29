"use client"

import { useMemo, useState } from "react"
import { Trophy, ChevronDown, ChevronUp } from "lucide-react"

type StandingRow = {
  entryId: string
  entryName: string
  userId?: string
  displayName?: string | null
  avatarUrl?: string | null
  ownerName?: string
  points?: number
  totalPoints?: number
  correctPicks?: number
  totalPicks?: number
  roundCorrect?: Record<number, number>
  roundPoints?: Record<number, number>
  championPick?: string | null
  maxPossible?: number
  scoringDetails?: any
}

const ROUND_HEADERS = [
  { round: 1, label: "R64", short: "64" },
  { round: 2, label: "R32", short: "32" },
  { round: 3, label: "S16", short: "16" },
  { round: 4, label: "E8", short: "8" },
  { round: 5, label: "F4", short: "4" },
  { round: 6, label: "CH", short: "CH", icon: true },
]

const ROUND_MAX_PICKS: Record<number, number> = { 1: 32, 2: 16, 3: 8, 4: 4, 5: 2, 6: 1 }

function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = (name || "?").slice(0, 2).toUpperCase()
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden") }}
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

function StandingCard({
  row,
  rank,
  isUser,
  expanded,
  onToggle,
}: {
  row: StandingRow
  rank: number
  isUser: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const pts = row.totalPoints ?? row.points ?? 0
  const maxPossible = row.maxPossible ?? 0
  const roundCorrect = row.roundCorrect ?? {}
  const roundPoints = row.roundPoints ?? {}
  const champion = row.championPick
  const displayName = row.displayName ?? row.ownerName ?? row.entryName

  const hasRoundData = Object.values(roundCorrect).some(v => v > 0) || Object.values(roundPoints).some(v => v > 0)

  return (
    <div
      className="transition-colors cursor-pointer"
      style={{ background: isUser ? 'rgba(251,146,60,0.04)' : 'transparent' }}
      onClick={onToggle}
    >
      <div className="py-3 px-3">
        <div className="flex items-center gap-2">
          <div className="w-6 text-xs font-bold text-right flex-shrink-0" style={{ color: rank === 1 ? '#fbbf24' : rank === 2 ? '#94a3b8' : rank === 3 ? '#cd7f32' : 'rgba(255,255,255,0.4)' }}>
            {rank}
          </div>

          <Avatar name={displayName} url={row.avatarUrl} size={28} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-white truncate">{displayName}</span>
              {isUser && <span className="text-[11px] px-1 py-0.5 rounded" style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c' }}>YOU</span>}
            </div>
            {row.entryName && row.entryName !== displayName && (
              <div className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {row.entryName}
              </div>
            )}
          </div>

          <div className="text-right flex items-center gap-2">
            <div>
              <div className="text-lg font-bold tabular-nums" style={{ color: '#fb923c' }}>{pts}</div>
              <div className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {row.correctPicks ?? 0}/{row.totalPicks ?? 0}
              </div>
            </div>
            {hasRoundData && (
              expanded
                ? <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
                : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
            )}
          </div>
        </div>
      </div>

      {expanded && hasRoundData && (
        <div className="px-3 pb-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="ml-8 mt-2">
            <div className="grid gap-0" style={{ gridTemplateColumns: `repeat(6, 1fr) auto` }}>
              {ROUND_HEADERS.map((rh) => (
                <div key={`h-${rh.round}`} className="text-center">
                  <div className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {rh.icon ? <Trophy className="h-2.5 w-2.5 mx-auto" style={{ color: 'rgba(255,255,255,0.3)' }} /> : rh.label}
                  </div>
                </div>
              ))}
              <div />

              {ROUND_HEADERS.map((rh) => {
                const correct = roundCorrect[rh.round] ?? 0
                const max = ROUND_MAX_PICKS[rh.round] ?? 0
                return (
                  <div key={`c-${rh.round}`} className="text-center">
                    <div className="text-[11px] font-semibold tabular-nums" style={{ color: correct > 0 ? 'rgba(34,197,94,0.8)' : 'rgba(255,255,255,0.15)' }}>
                      {correct}/{max}
                    </div>
                  </div>
                )
              })}
              <div className="text-[11px] pl-2 font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>PICKS</div>

              {ROUND_HEADERS.map((rh) => {
                const rPts = roundPoints[rh.round] ?? 0
                return (
                  <div key={`p-${rh.round}`} className="text-center">
                    <div className="text-[11px] font-bold tabular-nums" style={{ color: rPts > 0 ? '#fb923c' : 'rgba(255,255,255,0.12)' }}>
                      {rPts > 0 ? rPts : '-'}
                    </div>
                  </div>
                )
              })}
              <div className="text-[11px] pl-2 font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>PTS</div>
            </div>

            <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              {champion && (
                <span className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <Trophy className="h-2.5 w-2.5" style={{ color: '#fbbf24' }} />
                  Champion: {champion}
                </span>
              )}
              <span className="text-[11px] ml-auto" style={{ color: 'rgba(255,255,255,0.25)' }}>
                MAX {maxPossible}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function PoolStandings({
  standings,
  currentUserId,
  totalEntries,
}: {
  standings: StandingRow[]
  currentUserId: string
  totalEntries: number
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { userRows, allRanked } = useMemo(() => {
    const ranked = standings.map((r, idx) => ({
      ...r,
      rank: idx + 1,
      isUser: r.userId === currentUserId,
    }))
    return {
      userRows: ranked.filter((r) => r.isUser),
      allRanked: ranked,
    }
  }, [standings, currentUserId])

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id)

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }} data-testid="bracket-pool-standings">
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <h2 className="text-base font-bold text-white">Standings</h2>
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{totalEntries} brackets in pool</p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)' }}>
          TAP TO EXPAND
        </span>
      </div>

      {userRows.length > 0 && (
        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(251,146,60,0.5)' }}>Your Brackets</span>
          </div>
          {userRows.map((r) => (
            <div key={r.entryId} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
              <StandingCard
                row={r}
                rank={r.rank}
                isUser
                expanded={expandedId === r.entryId}
                onToggle={() => toggle(r.entryId)}
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="px-3 py-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>All Brackets</span>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
            <span>RANK</span>
            <span>PTS</span>
          </div>
        </div>
        {allRanked.map((r) => (
          <div key={r.entryId} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
            <StandingCard
              row={r}
              rank={r.rank}
              isUser={r.isUser}
              expanded={expandedId === r.entryId}
              onToggle={() => toggle(r.entryId)}
            />
          </div>
        ))}
        {allRanked.length === 0 && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: 'rgba(255,255,255,0.2)' }}>No entries yet</div>
        )}
      </div>
    </div>
  )
}
