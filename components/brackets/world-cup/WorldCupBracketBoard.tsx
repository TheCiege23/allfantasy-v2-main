"use client"
import { useMemo } from "react"
import type { WorldCupChallengeView, WorldCupMatchView, WorldCupPickView, WorldCupRound } from "@/lib/world-cup/types"
import { buildWorldCupProjectedMatches, hasWorldCupPickSelection } from "@/lib/world-cup/worldCupProjectedBracket"
import WorldCupRoundColumn from "./WorldCupRoundColumn"

/** Knockout wings flowing toward center hub (mirrors compact preview). */
const WING_ROUNDS: readonly WorldCupRound[] = ["round_of_32", "round_of_16", "quarterfinal", "semifinal"]

function splitWingMatches(round: WorldCupRound, roundMatches: WorldCupMatchView[]): {
	left: WorldCupMatchView[]
	right: WorldCupMatchView[]
} {
	const sorted = [...roundMatches].sort((a, b) => a.matchNumber - b.matchNumber)
	const n = sorted.length
	if (n === 0) return { left: [], right: [] }

	switch (round) {
		case "round_of_32":
			if (n >= 16) return { left: sorted.slice(0, 8), right: sorted.slice(8, 16) }
			break
		case "round_of_16":
			if (n >= 8) return { left: sorted.slice(0, 4), right: sorted.slice(4, 8) }
			break
		case "quarterfinal":
			if (n >= 4) return { left: sorted.slice(0, 2), right: sorted.slice(2, 4) }
			break
		case "semifinal":
			if (n >= 2) return { left: sorted.slice(0, 1), right: sorted.slice(1, 2) }
			break
		default:
			return { left: sorted, right: [] }
	}
	/** Partial knockout data: split evenly so both wings stay populated toward the hub. */
	const mid = Math.floor(n / 2)
	return { left: sorted.slice(0, mid), right: sorted.slice(mid) }
}

export default function WorldCupBracketBoard({
	view,
	picks,
	onPick,
	onOpenMatchupPicker,
	isLocked = false,
}: {
	view: WorldCupChallengeView
	picks: WorldCupPickView[]
	onPick: (match: WorldCupMatchView, side: "home" | "away") => void
	onOpenMatchupPicker?: (matchId: string) => void
	isLocked?: boolean
}) {
	const matches = useMemo(() => buildWorldCupProjectedMatches(view.matches, picks), [view.matches, picks])
	const champion = picks.find((p) => p.round === "final" && hasWorldCupPickSelection(p))
	const { pickLockStrategy, pickLockAt } = view.challenge

	const wingRoundsOrdered = WING_ROUNDS.filter((r) => matches.some((m) => m.round === r))
	const rightWingRoundsOrdered = [...wingRoundsOrdered].reverse()

	const thirdMatches = matches.filter((m) => m.round === "third_place")
	const finalMatches = matches.filter((m) => m.round === "final")
	const showThirdHub = view.challenge.includeThirdPlace && thirdMatches.length > 0

	const sharedColumnProps = {
		picks,
		onPick,
		onOpenMatchupPicker,
		isBracketLocked: isLocked,
		lockStrategy: pickLockStrategy,
		tournamentLockAt: pickLockAt,
	}

	return (
		<div className="min-h-full touch-pan-x overflow-x-auto px-3 pb-7 pt-2 [-webkit-overflow-scrolling:touch] sm:px-5">
			<div className="mb-4 flex min-w-0 flex-col gap-2 sm:mb-5 sm:min-w-max sm:flex-row sm:items-center sm:gap-3">
				<div className="rounded-2xl bg-gradient-to-br from-cyan-400/15 to-transparent px-4 py-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] ring-1 ring-cyan-300/25 backdrop-blur-md sm:py-3.5">
					<div className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-100/70 sm:text-[10px]">Champion Pick</div>
					<div className="mt-0.5 truncate text-base font-black text-white sm:mt-1 sm:text-lg">{champion?.selectedTeamName ?? "Not picked"}</div>
				</div>
				<div className="rounded-2xl bg-white/[0.04] px-4 py-3 text-[11px] leading-snug text-white/50 ring-1 ring-white/[0.07] backdrop-blur-md sm:text-xs">
					Picks advance visually as soon as you choose a winner.
				</div>
			</div>

			<div className="flex min-w-max items-start justify-center gap-3 sm:gap-4">
				<div className="flex gap-3 sm:gap-4">
					{wingRoundsOrdered.map((round) => {
						const roundMatches = matches.filter((m) => m.round === round)
						const { left } = splitWingMatches(round, roundMatches)
						if (left.length === 0) return null
						return (
							<WorldCupRoundColumn
								key={`wing-L-${round}`}
								round={round}
								matches={left}
								{...sharedColumnProps}
							/>
						)
					})}
				</div>

				<div className="flex min-w-[15rem] max-w-[21rem] shrink-0 flex-col justify-start gap-4 px-1 pt-1">
					{showThirdHub ? (
						<WorldCupRoundColumn key="hub-third" round="third_place" matches={thirdMatches} {...sharedColumnProps} />
					) : null}
					{finalMatches.length > 0 ? (
						<WorldCupRoundColumn key="hub-final" round="final" matches={finalMatches} {...sharedColumnProps} />
					) : null}
				</div>

				<div className="flex gap-3 sm:gap-4">
					{rightWingRoundsOrdered.map((round) => {
						const roundMatches = matches.filter((m) => m.round === round)
						const { right } = splitWingMatches(round, roundMatches)
						if (right.length === 0) return null
						return (
							<WorldCupRoundColumn
								key={`wing-R-${round}`}
								round={round}
								matches={right}
								{...sharedColumnProps}
							/>
						)
					})}
				</div>
			</div>
		</div>
	)
}
