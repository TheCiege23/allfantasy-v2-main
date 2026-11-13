import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { FUTURE_DISCOUNT, pickSlotInRound } from './sportDynastyValue'

type Pick = Extract<TradeAssetInput, { kind: 'pick' }>

/** A combined pick selects the next prospect from one board, after both pools share a value scale. */
export function combinedDraftPickValue(args: {
  pick: Pick
  campus: readonly number[]
  canton: readonly number[]
  teams: number
  nextDraftYear: number
  rounds: number
  /** The Canton chart can already quote a particular draft year. */
  boardYear?: number
}): number | null {
  const { pick, campus, canton, teams, nextDraftYear, rounds, boardYear = nextDraftYear } = args
  if (!Number.isInteger(teams) || teams < 2 || !Number.isInteger(rounds) ||
      !Number.isInteger(pick.year) || pick.year < nextDraftYear || pick.year < boardYear ||
      !Number.isInteger(pick.round) || pick.round < 1 || pick.round > rounds) return null
  const before = (pick.round - 1) * teams
  const overall = pick.overall ?? before + pickSlotInRound(pick.tier, teams) + 1
  if (!Number.isInteger(overall) || overall <= before || overall > before + teams) return null
  const usable = (values: readonly number[]) => values.filter((value) => Number.isFinite(value) && value > 0)
  const college = usable(campus)
  const pro = usable(canton)
  if (!college.length || !pro.length) return null
  const board = [...college, ...pro].sort((a, b) => b - a)
  const quote = board[overall - 1]
  return quote == null ? null : quote * FUTURE_DISCOUNT ** (pick.year - boardYear)
}
