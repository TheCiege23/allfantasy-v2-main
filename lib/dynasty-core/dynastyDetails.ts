/**
 * Small, pure readers behind the dynasty detail polish: the pick chip a trade asset draws, the taxi
 * badges a lineup row draws, and the "Year N" a history card draws.
 *
 * Every value comes from a field that already exists. Nothing here estimates: when the field is not
 * there, the reader returns null and the surface draws nothing.
 */
import { parseFuturePickRef } from '@/lib/league-trade-engine/pickTerms'

/** The structured half of a traded pick. The display label stays where it was. */
export type TradePickChip = {
  /** The draft year, when the pick names one. A current-draft pick (`rdp:`) does not. */
  season: number | null
  round: number
  /** The team whose pick it originally was. */
  originalRosterId: string | null
  /** The team sending it in this trade, when the row says so. */
  fromRosterId: string | null
}

const positiveInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * The chip for one `AfLeagueTrade` item, or null when the item is not a pick or names no round.
 *
 * The id is read first because it is the pick's own key (`fdp:<season>:<round>:<original>` for a
 * dynasty future pick, `rdp:<session>:<round>:<original>` for a current-draft pick); metadata is the
 * fallback for rows written before those ids existed.
 */
export function pickChipFromTradeItem(item: {
  itemType?: string | null
  itemReference?: string | null
  metadata?: unknown
  fromRosterId?: string | null
}): TradePickChip | null {
  const type = String(item.itemType ?? '').toLowerCase()
  if (!type.includes('pick')) return null
  const ref = String(item.itemReference ?? '')
  const from = text(item.fromRosterId)

  const future = parseFuturePickRef(ref)
  if (future) return { season: future.season, round: future.round, originalRosterId: future.originalRosterId, fromRosterId: from }

  const current = /^rdp:[^:]+:(\d{1,3}):(.+)$/.exec(ref)
  if (current && Number(current[1]) > 0) {
    return { season: null, round: Number(current[1]), originalRosterId: current[2]!, fromRosterId: from }
  }

  const meta = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? (item.metadata as Record<string, unknown>) : {}
  const round = positiveInt(meta.pickRound ?? meta.round)
  if (round == null) return null
  const season = positiveInt(meta.pickSeason ?? meta.season)
  return { season, round, originalRosterId: text(meta.originalRosterId), fromRosterId: from }
}

/**
 * Who the pick came "via": the original team, but only when it is a different team from the one
 * sending it. Null when either side is unknown — a missing "via" is honest, a guessed one is not.
 */
export function pickChipViaRosterId(chip: Pick<TradePickChip, 'originalRosterId' | 'fromRosterId'>): string | null {
  if (!chip.originalRosterId || !chip.fromRosterId) return null
  return chip.originalRosterId === chip.fromRosterId ? null : chip.originalRosterId
}

/** `2027 R1`, or `R2` for a current-draft pick with no year. */
export function pickChipLabel(chip: Pick<TradePickChip, 'season' | 'round'>): string {
  return chip.season != null ? `${chip.season} R${chip.round}` : `R${chip.round}`
}

/**
 * Which season of a taxi stint this is, counting the one being played: a player with no completed
 * taxi seasons is in season 1. Null when the league sets no limit (there is nothing to count down
 * to), or when the inputs are unreadable.
 */
export function taxiSeasonOf(seasonsUsed: number | null | undefined, maxYears: number | null | undefined): { season: number; of: number } | null {
  if (maxYears == null || !Number.isInteger(maxYears) || maxYears < 1) return null
  const used = typeof seasonsUsed === 'number' && Number.isInteger(seasonsUsed) && seasonsUsed >= 0 ? seasonsUsed : 0
  return { season: Math.min(used + 1, maxYears), of: maxYears }
}

/** A rookie is a player with no completed pro seasons. Unknown experience is not a rookie. */
export function isRookieByExperience(yearsExp: number | null | undefined): boolean {
  return yearsExp === 0
}

/**
 * "Year N" for a season of this league: seasons since the earliest season the league has on file,
 * counting that first one as Year 1. Null when either is missing, or the season predates the first.
 */
export function dynastyYearOf(season: number | null | undefined, firstSeason: number | null | undefined): number | null {
  if (!Number.isInteger(season) || !Number.isInteger(firstSeason)) return null
  const n = (season as number) - (firstSeason as number) + 1
  return n >= 1 ? n : null
}

/** The earliest season in a list, or null for an empty one. */
export function firstSeasonOf(seasons: ReadonlyArray<{ season: number }>): number | null {
  let first: number | null = null
  for (const s of seasons) if (Number.isInteger(s.season) && (first == null || s.season < first)) first = s.season
  return first
}
