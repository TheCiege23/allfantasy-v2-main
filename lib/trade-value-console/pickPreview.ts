/** A server price book belongs to one league, including during a league switch. */
export type TradePickPreviewBook = {
  leagueId: string
  values: Record<string, number | null>
}

export function pickPreviewKey(year: number, round: number): string {
  return `${year}:${round}`
}

export function readPickPreviewValue(args: {
  leagueId: string | null | undefined
  book: TradePickPreviewBook | null | undefined
  year: number
  round: number
}): number | null {
  if (!args.leagueId || args.book?.leagueId !== args.leagueId
    || !Number.isInteger(args.year) || !Number.isInteger(args.round) || args.round < 1) return null
  const value = args.book.values[pickPreviewKey(args.year, args.round)]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
