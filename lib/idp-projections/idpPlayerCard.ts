import type { PrismaClient } from '@prisma/client'

import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'
import { projectFromRecentForm } from '@/lib/waivers/recentFormProjection'

import { deriveDefenderRole, type DefenderRoleLine } from './defenderRole'

/**
 * One defender's card: what he has actually done, priced by this league.
 *
 * ⚠ THIS REPLACES A MODAL THAT WAS FABRICATED ALMOST END TO END. `IDPPlayerModal` rendered a
 * full box score from `mockStatPills` — a hash of the player id — beside his real name and
 * photograph. It also printed hashed IDP points, a hashed snap share, a matchup graded by
 * `playerId.length % 3`, an opponent rank of `10 + playerId.charCodeAt(0) % 22`, a hardcoded
 * "Partly cloudy, 48°F", and a coloured gradient captioned as a week-by-week sparkline. None of
 * it was marked as sample data anywhere the reader would look.
 *
 * So the rule here is that every number comes from a row, and anything without a row is named
 * as absent rather than filled in.
 */

export type IdpPlayerCardState = 'ok' | 'no-league' | 'no-scoring' | 'no-games'

export interface IdpPlayerCardStat {
  key: string
  label: string
  total: number
  perGame: number
}

export interface IdpPlayerCardWeek {
  week: number
  /** Null when this league prices nothing in that week's line. */
  points: number | null
  snaps: number | null
}

export interface IdpPlayerCardPayload {
  state: IdpPlayerCardState
  season: number
  /** Games carrying a defensive snap count — the sample behind the stats and the role lines. */
  games: number
  stats: IdpPlayerCardStat[]
  weeks: IdpPlayerCardWeek[]
  seasonPoints: { total: number; perGame: number; games: number } | null
  projection: { points: number; basis: 'form'; games: number } | null
  role: { lines: DefenderRoleLine[]; games: number } | null
  notes: string[]
}

/**
 * The counting stats the modal used to invent, and the keys that actually carry them.
 *
 * ⚠ MEASURED, NOT ASSUMED. Across 8,000 rows of the 2025 NFL season: `idp_tkl_solo` appears on
 * 1,564, `idp_tkl_ast` 1,279, `idp_pass_def` 361, `idp_sack` 241, `idp_ff` 80, `idp_int` 74,
 * `idp_fum_rec` 43. Defensive touchdowns are written under two spellings on the same six rows,
 * so both are read and the larger taken rather than summed.
 */
const STAT_FIELDS: ReadonlyArray<{ key: string; label: string; from: readonly string[] }> = [
  { key: 'tkl_solo', label: 'Solo tackles', from: ['idp_tkl_solo'] },
  { key: 'tkl_ast', label: 'Assisted tackles', from: ['idp_tkl_ast'] },
  { key: 'tkl_loss', label: 'Tackles for loss', from: ['idp_tkl_loss'] },
  { key: 'sack', label: 'Sacks', from: ['idp_sack'] },
  { key: 'qb_hit', label: 'QB hits', from: ['idp_qb_hit'] },
  { key: 'pass_def', label: 'Passes defended', from: ['idp_pass_def'] },
  { key: 'int', label: 'Interceptions', from: ['idp_int'] },
  { key: 'ff', label: 'Forced fumbles', from: ['idp_ff'] },
  { key: 'fum_rec', label: 'Fumble recoveries', from: ['idp_fum_rec'] },
  { key: 'def_td', label: 'Defensive TDs', from: ['idp_def_td', 'idp_defensive_touchdown'] },
]

const NO_MATCHUP_NOTE =
  'No matchup grade or opponent rank. The Defense Hub reached the same conclusion on the same ' +
  'data: grading opponent tendencies measured worse than leaving them out over 5,291 ' +
  'out-of-sample player-weeks, so neither surface prints one.'

const NO_SNAP_SHARE_NOTE =
  'No snap share. A share needs the team defensive snap total for the same game, and no feed ' +
  'we ingest carries one, so only this defender’s own snap count is shown.'

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

function readNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function extractScoring(settings: unknown): Record<string, unknown> | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.scoring_settings ?? s.scoringSettings ?? null) as unknown
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

export interface LoadIdpPlayerCardArgs {
  prisma: PrismaClient
  /** Either id space — `League.id` uuid or the platform's own league id. */
  leagueId: string
  playerId: string
  season: number
  sport?: string
}

export async function loadIdpPlayerCard(
  args: LoadIdpPlayerCardArgs,
): Promise<IdpPlayerCardPayload> {
  const season = args.season
  const sport = args.sport ?? 'NFL'
  const empty = (state: IdpPlayerCardState, notes: string[]): IdpPlayerCardPayload => ({
    state,
    season,
    games: 0,
    stats: [],
    weeks: [],
    seasonPoints: null,
    projection: null,
    role: null,
    notes,
  })

  /*
   * ⚠ TWO QUERIES, NOT AN `OR`, AND SCORING LIVES INSIDE `settings`. `League` has no
   * `scoringSettings` column — the scoring map is nested in the `settings` JSON under either
   * spelling. And `platformLeagueId` is not unique, so the two id spaces are resolved in order
   * (uuid first, then the platform's own id, newest wins) exactly as `loadWaiverBoard` does.
   * Matching it matters: a surface that resolved the league differently from the board beside
   * it could price the same player two ways on one screen.
   */
  const league =
    (await args.prisma.league
      .findUnique({ where: { id: args.leagueId }, select: { id: true, settings: true } })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, settings: true },
      })
      .catch(() => null))

  if (!league) return empty('no-league', ['League not found, so nothing can be priced.'])

  const scoring = extractScoring(league.settings)

  if (!scoring || Object.keys(scoring).length === 0) {
    return empty('no-scoring', [
      'This league carries no scoring settings, so every points figure would be invented.',
    ])
  }

  const rows = await args.prisma.playerGameStat
    .findMany({
      where: { sportType: sport, season, playerId: args.playerId },
      select: { weekOrRound: true, normalizedStatMap: true },
      orderBy: [{ weekOrRound: 'asc' }],
    })
    .catch(() => [] as Array<{ weekOrRound: number; normalizedStatMap: unknown }>)

  if (rows.length === 0) {
    return empty('no-games', [
      `No ${season} game rows on file for this player, so there is nothing to total or price.`,
    ])
  }

  const notes: string[] = []
  const maps = rows.map((r) => (r.normalizedStatMap ?? {}) as Record<string, unknown>)

  /*
   * ⚠ THE SNAP COUNT IS THE DISCRIMINATOR, EXACTLY AS IN `deriveDefenderRole`. A game carrying
   * `def_snp` is one we have a record of, so an absent event in it is a real zero. A game
   * without it cannot tell a blank from a zero, and totalling those would quietly understate
   * every defender whose feed coverage is patchy.
   */
  const counted = maps.filter((m) => {
    const snp = readNumber(m.def_snp)
    return snp != null && snp > 0
  })

  const stats: IdpPlayerCardStat[] = []
  if (counted.length > 0) {
    for (const field of STAT_FIELDS) {
      let total = 0
      let seen = false
      for (const m of counted) {
        let best = 0
        let present = false
        for (const key of field.from) {
          const v = readNumber(m[key])
          if (v == null) continue
          present = true
          if (v > best) best = v
        }
        if (present) {
          seen = true
          total += best
        }
      }
      // A stat no counted game carries at all is a coverage gap, not a zero, so it is dropped.
      if (!seen) continue
      stats.push({
        key: field.key,
        label: field.label,
        total: round1(total),
        perGame: round1(total / counted.length),
      })
    }
  } else {
    notes.push(
      `None of the ${rows.length} game row${rows.length === 1 ? '' : 's'} on file carries a ` +
        'defensive snap count, so a blank cannot be told from a zero and no totals are shown.',
    )
  }

  const weeks: IdpPlayerCardWeek[] = rows.map((r, i) => {
    const scored = computeLeagueProjectedPoints(maps[i], scoring)
    return {
      week: r.weekOrRound,
      points: scored ? scored.points : null,
      snaps: readNumber(maps[i].def_snp),
    }
  })

  const scoredWeeks = weeks.filter((w) => w.points != null)
  const seasonTotal = scoredWeeks.reduce((a, w) => a + (w.points ?? 0), 0)
  const seasonPoints =
    scoredWeeks.length > 0
      ? {
          total: round2(seasonTotal),
          perGame: round2(seasonTotal / scoredWeeks.length),
          games: scoredWeeks.length,
        }
      : null

  if (!seasonPoints) {
    notes.push(
      'This league prices nothing in any of these game lines, so no points total is shown. ' +
        'That is a statement about the league’s scoring settings, not about the player.',
    )
  }

  const formMap = await projectFromRecentForm({
    prisma: args.prisma,
    sport,
    season,
    playerIds: [args.playerId],
    scoring,
  })
  const form = formMap.get(args.playerId) ?? null

  const role = deriveDefenderRole(maps)

  notes.push(NO_SNAP_SHARE_NOTE)
  notes.push(NO_MATCHUP_NOTE)

  return {
    state: 'ok',
    season,
    games: counted.length,
    stats,
    weeks,
    seasonPoints,
    projection: form ? { points: form.points, basis: 'form', games: form.games } : null,
    role: { lines: role.lines, games: role.games },
    notes,
  }
}
