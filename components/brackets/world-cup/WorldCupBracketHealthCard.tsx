import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"
import { calculateWorldCupBracketHealth } from "@/lib/world-cup/worldCupAiInsights"

type EntryHealthShape = {
  championTeamId: string | null
  totalScore: number
  maxPossibleScore: number
}

export default function WorldCupBracketHealthCard({
  entry,
  matches,
  picks,
}: {
  entry: EntryHealthShape
  matches: WorldCupMatchView[]
  picks: WorldCupPickView[]
}) {
  const health = calculateWorldCupBracketHealth(entry, matches, picks)

  const scoreColor =
    health.label === "Excellent"
      ? "text-white/85"
      : health.label === "Alive"
      ? "text-white/85"
      : health.label === "Risky"
      ? "text-white/70"
      : "text-white/70"

  return (
    <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
          Bracket Health
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
            health.label === "Excellent"
              ? "bg-emerald-500/20 text-white/85"
              : health.label === "Alive"
              ? "bg-cyan-500/20 text-white/85"
              : health.label === "Risky"
              ? "bg-amber-500/20 text-white/70"
              : "bg-rose-500/20 text-white/70"
          }`}
        >
          {health.label}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-black/20">
          <span className={`text-lg font-black ${scoreColor}`}>{health.score}</span>
        </div>
        <div className="text-xs text-white/60">
          <p>{health.championAlive ? "Champion still alive" : "Champion eliminated"}</p>
          <p className="mt-1">Remaining points: {health.possiblePointsRemaining}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
        <Stat label="Correct" value={health.correctPicks} />
        <Stat label="Incorrect" value={health.incorrectPicks} />
        <Stat label="Total" value={health.totalPicks} />
      </div>

      <p className="mt-3 text-xs text-white/55">{health.summary}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
      <div className="text-[11px] text-white/40">{label}</div>
      <div className="font-bold text-white/85">{value}</div>
    </div>
  )
}
