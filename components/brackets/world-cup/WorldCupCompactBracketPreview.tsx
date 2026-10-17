import type { WorldCupMatchView } from "@/lib/world-cup/types"

const ROUND_LABELS: Record<string, string> = {
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarterfinal: "Quarterfinals",
  semifinal: "Semifinals",
  third_place: "Third Place",
  final: "Final",
}

type WorldCupCompactBracketPreviewProps = {
  matches: WorldCupMatchView[]
}

function formatMatchTeam(name: string | null | undefined, slotKey: string) {
  const trimmed = name?.trim()
  return trimmed && trimmed !== "TBD" ? trimmed : slotKey
}

export function WorldCupCompactBracketPreview({ matches }: WorldCupCompactBracketPreviewProps) {
  const rounds = matches.reduce<Array<{ round: string; label: string; matches: WorldCupMatchView[] }>>((acc, match) => {
    const existing = acc.find((round) => round.round === match.round)
    if (existing) {
      existing.matches.push(match)
      return acc
    }

    acc.push({
      round: match.round,
      label: ROUND_LABELS[match.round] ?? match.round.replaceAll("_", " "),
      matches: [match],
    })
    return acc
  }, [])

  if (rounds.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
        <p className="text-sm font-bold text-white/70">Bracket fixtures are not loaded yet.</p>
        <p className="mt-2 text-xs text-white/45">Seed fixtures to preview the knockout path.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rounds.map((round) => (
        <section key={round.round} className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/90">{round.label}</h3>
            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] font-bold text-white/45">
              {round.matches.length} games
            </span>
          </div>
          <div className="space-y-2">
            {round.matches.slice(0, 8).map((match) => (
              <div key={match.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-2">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/35">
                  Match {match.matchNumber}
                </div>
                <div className="mt-1 grid gap-1 text-xs font-bold text-white/75">
                  <span className="truncate">{formatMatchTeam(match.homeTeamName, match.homeSlotKey)}</span>
                  <span className="truncate">{formatMatchTeam(match.awayTeamName, match.awaySlotKey)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
