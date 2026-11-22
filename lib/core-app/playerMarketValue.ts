import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type { SectionState } from './leagueHome'
import type { ValueBook } from './valueBook'

/**
 * ONE player market value, read ONE way — the player card's, and Chimmy's `get_player_value`.
 *
 * 🛑 THESE TWO USED TO READ DIFFERENT TABLES (re-score 2026-11-17). The card priced a player from
 * `PlayerValueSnapshot` on the league's own chart (`valueBookFor`: dynasty or redraft, one-QB or superflex);
 * Chimmy's value tool read the few-hundred-row `AllFantasyMarketPlayerValue` house table on whatever concept
 * happened to be published, with no league at all. "What is he worth?" in chat could therefore disagree with the
 * number on his card, and a user has no way to know which to believe. Both now call this.
 *
 * Moved out of `playerCard.ts` unchanged, so the card reads exactly what it read before.
 */

/** How far back the move is measured. */
export const MARKET_DELTA_DAYS = 7

export type PlayerMarketValue = {
  value: number
  overallRank: number | null
  positionRank: number | null
  /** Change against the closest snapshot to `deltaDays` before the newest one. Null when history is too short. */
  delta: { change: number; days: number } | null
  format: string
  qbFormat: string
  source: string
  capturedAt: string
}

/** Positions FantasyCalc does not publish. Named so a reader can say WHY, not just fail. */
const UNPRICED_POSITIONS = new Set(['K', 'DEF', 'DST', 'D/ST', 'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'EDGE'])

export function isUnpriced(position: string | null): boolean {
  return position != null && UNPRICED_POSITIONS.has(position.toUpperCase())
}

function unavailable(reason: string): { available: false; reason: string } {
  return { available: false, reason }
}

/**
 * Price + ranks + the 7-day move, from `PlayerValueSnapshot`.
 *
 * The delta is computed against the snapshot CLOSEST to `MARKET_DELTA_DAYS` before the newest one, not against
 * "the row 7 rows back" — captures are not evenly spaced (16 distinct days across 18,955 rows), so counting rows
 * would silently compare a 4-day move against an 11-day one and label both "7d".
 */
export async function loadPlayerMarketValue(
  sleeperId: string | null,
  position: string | null,
  book: ValueBook
): Promise<SectionState<PlayerMarketValue>> {
  const { format, qbFormat } = book
  if (!sleeperId) {
    return unavailable('No Sleeper id on file for this player, so no market row can be matched.')
  }

  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: { sleeperId, source: book.source, format, qbFormat },
      orderBy: { capturedAt: 'desc' },
      take: 40,
      select: { value: true, overallRank: true, positionRank: true, capturedAt: true, source: true },
    })
    .catch(() => [])

  if (rows.length === 0) {
    return unavailable(
      isUnpriced(position)
        ? 'FantasyCalc publishes no value for kickers or defenders, so this player has no market price.'
        : 'No market snapshot on file for this player.'
    )
  }

  const newest = rows[0]!
  const target = newest.capturedAt.getTime() - MARKET_DELTA_DAYS * 86_400_000

  let prior: (typeof rows)[number] | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const r of rows.slice(1)) {
    const gap = Math.abs(r.capturedAt.getTime() - target)
    if (gap < bestGap) {
      bestGap = gap
      prior = r
    }
  }

  // A "7d" label on a 2-day comparison is a small lie that compounds; only
  // claim the delta when a snapshot actually sits near the window.
  const priorDays = prior ? Math.round((newest.capturedAt.getTime() - prior.capturedAt.getTime()) / 86_400_000) : 0
  const delta =
    prior && priorDays >= 3 ? { change: newest.value - prior.value, days: priorDays } : null

  return {
    available: true,
    data: {
      value: newest.value,
      overallRank: newest.overallRank,
      positionRank: newest.positionRank,
      delta,
      format,
      qbFormat,
      source: newest.source,
      capturedAt: newest.capturedAt.toISOString(),
    },
  }
}

export type PricedPlayerMatch = { sleeperId: string; name: string; position: string | null }

/**
 * Players on the book's NEWEST capture whose name normalizes to `name`'s. Several when two players share a name —
 * the caller must not pick one. `capturedAt` is null when the book has no capture at all (or the read failed),
 * which is a different fact from "captured, and he is not on it".
 *
 * ⚠ MATCHED IN MEMORY WITH `normalizePlayerName`, NOT IN SQL: the identity authority's apostrophe and suffix rules
 * are JavaScript, and CLAUDE.md records a SQL copy of a normalizer disagreeing with it on 7.2% of rows.
 */
export async function findPricedPlayersByName(
  name: string,
  book: ValueBook,
): Promise<{ capturedAt: string | null; matches: PricedPlayerMatch[] }> {
  const where = { source: book.source, format: book.format, qbFormat: book.qbFormat }
  const latest = await prisma.playerValueSnapshot
    .findFirst({ where, orderBy: { capturedAt: 'desc' }, select: { capturedAt: true } })
    .catch(() => null)
  if (!latest) return { capturedAt: null, matches: [] }
  const target = normalizePlayerName(name)
  if (!target) return { capturedAt: latest.capturedAt.toISOString(), matches: [] }
  const rows = await prisma.playerValueSnapshot
    .findMany({ where: { ...where, capturedAt: latest.capturedAt }, select: { sleeperId: true, name: true, position: true } })
    .catch(() => [] as PricedPlayerMatch[])
  const seen = new Set<string>()
  const matches = rows.filter((r) => {
    if (seen.has(r.sleeperId) || normalizePlayerName(r.name) !== target) return false
    seen.add(r.sleeperId)
    return true
  })
  return { capturedAt: latest.capturedAt.toISOString(), matches }
}
