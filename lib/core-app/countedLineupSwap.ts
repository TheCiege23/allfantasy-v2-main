import { importedLineupTemplateSlots, parseProviderRosterPositions } from '@/lib/league/importedLineupTemplate'
import { normalizePosition } from './positionNormalization'

/**
 * Counted provider slots have no positional relationship to `starters` order.
 * Prove a replacement fits the entire lineup instead of guessing its exact seat.
 */
export function countedLineupReplacementIsLegal(args: {
  sport: string
  settings: unknown
  starterPositions: readonly (string | null)[]
  replacedIndex: number
  candidatePosition: string | null
}): boolean {
  const settings = args.settings && typeof args.settings === 'object' && !Array.isArray(args.settings)
    ? args.settings as Record<string, unknown> : {}
  if (!parseProviderRosterPositions(settings.roster_positions)?.pairs) return false
  const template = importedLineupTemplateSlots({ sport: args.sport, settings })
  if (!template) return false
  const seats = template.flatMap((slot) => Array.from({ length: slot.starterCount }, () =>
    slot.allowedPositions.map(normalizePosition).filter((position): position is string => Boolean(position))))
  if (seats.length !== args.starterPositions.length || args.replacedIndex < 0 || args.replacedIndex >= seats.length) return false
  const original = args.starterPositions.map(normalizePosition)
  const replacement = normalizePosition(args.candidatePosition)
  if (original.some((position) => !position) || !replacement) return false

  const canSeat = (positions: readonly (string | null)[]) => {
    const seatOwner = Array<number>(seats.length).fill(-1)
    const place = (playerIndex: number, seen: Set<number>): boolean => {
      for (let seat = 0; seat < seats.length; seat++) {
        if (seen.has(seat) || !seats[seat]!.includes(positions[playerIndex]!)) continue
        seen.add(seat)
        if (seatOwner[seat] < 0 || place(seatOwner[seat]!, seen)) {
          seatOwner[seat] = playerIndex
          return true
        }
      }
      return false
    }
    return positions.every((_, index) => place(index, new Set()))
  }
  if (!canSeat(original)) return false
  const next = [...original]
  next[args.replacedIndex] = replacement
  return canSeat(next)
}
