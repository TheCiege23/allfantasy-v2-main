"use client"
import { useMemo } from "react"
import { WORLD_CUP_ROUNDS } from "@/lib/world-cup/types"
import type { WorldCupChallengeView, WorldCupMatchView, WorldCupPickView, WorldCupRound } from "@/lib/world-cup/types"
import WorldCupRoundColumn from "./WorldCupRoundColumn"
function project(matches: WorldCupMatchView[], picks: WorldCupPickView[]) { const out = matches.map((m) => ({ ...m })); const byId = new Map(out.map((m) => [m.id, m])); const byPick = new Map(picks.map((p) => [p.matchId, p])); for (const m of out) { const p = byPick.get(m.id), n = m.nextMatchId ? byId.get(m.nextMatchId) : null; if (!p || !n || !m.nextMatchSlot) continue; const home = p.selectedSlotKey === m.homeSlotKey || Boolean(p.selectedTeamId && p.selectedTeamId === m.homeTeamId); const t = home ? { id: m.homeTeamId, name: m.homeTeamName, logo: m.homeTeamLogo, slot: m.homeSlotKey } : { id: m.awayTeamId, name: m.awayTeamName, logo: m.awayTeamLogo, slot: m.awaySlotKey }; if (m.nextMatchSlot === "home") { n.homeTeamId = t.id; n.homeTeamName = t.name; n.homeTeamLogo = t.logo; n.homeSlotKey = t.slot } else { n.awayTeamId = t.id; n.awayTeamName = t.name; n.awayTeamLogo = t.logo; n.awaySlotKey = t.slot } } return out }
export default function WorldCupBracketBoard({ view, picks, onPick }: { view: WorldCupChallengeView; picks: WorldCupPickView[]; onPick: (match: WorldCupMatchView, side: "home" | "away") => void }) {
	const matches = useMemo(() => project(view.matches, picks), [view.matches, picks])
	const champion = picks.find((p) => p.round === "final")
	const rounds = WORLD_CUP_ROUNDS.filter((r) => matches.some((m) => m.round === r && (r !== "third_place" || view.challenge.includeThirdPlace)))
	const { pickLockStrategy, pickLockAt } = view.challenge
	return (
		<div className="h-full min-h-[620px] overflow-x-auto overflow-y-auto px-3 pb-28 pt-3 sm:px-5 sm:pb-6">
			<div className="mb-4 flex min-w-max items-center gap-3">
				<div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-3">
					<div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/60">Champion Pick</div>
					<div className="mt-1 text-lg font-black text-white">{champion?.selectedTeamName ?? "Not picked"}</div>
				</div>
				<div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
					Picks advance visually as soon as you choose a winner.
				</div>
			</div>
			<div className="flex min-w-max gap-4">
				{rounds.map((round) => (
					<WorldCupRoundColumn
						key={round}
						round={round as WorldCupRound}
						matches={matches.filter((m) => m.round === round)}
						picks={picks}
						onPick={onPick}
						lockStrategy={pickLockStrategy}
						tournamentLockAt={pickLockAt}
					/>
				))}
			</div>
		</div>
	)
}
