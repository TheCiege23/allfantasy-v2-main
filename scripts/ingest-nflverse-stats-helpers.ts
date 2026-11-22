/**
 * The write step of `scripts/ingest-nflverse-stats.ts`, kept apart so it can be tested with a fake client.
 *
 * 🛑 ONE PLAYER-WEEK, TWO ROWS. When the nflverse CSV has no `game_id` column the script stores a
 * synthetic id, `NFL-<season>-W<week>`. A later run against a CSV that DOES carry `game_id` writes the
 * same player-week again under the real id — a different `@@unique([playerId, sportType, gameId])` key,
 * so the upsert creates a second row instead of updating the first. Neither row carries
 * `providerGameId`, so the scorer's duplicate guard (`statRowDedupeKey`,
 * lib/multi-sport/MultiSportMatchupScoringService.ts) sees two different games and counts the week twice.
 *
 * Fixed here, at the source, with no schema change:
 *   - writing a REAL id removes the synthetic row for that player, season and week;
 *   - writing a SYNTHETIC id when an nflverse real-id row for that player-week already exists updates
 *     that row instead of creating a synthetic one beside it. More than one such row is ambiguous and is
 *     left alone (counted, never guessed).
 * Both sides are scoped to `source: 'nflverse'`: a row another ingest wrote is not this script's to delete.
 *
 * Not atomic: the real row is written BEFORE the synthetic one is deleted, so a crash in between leaves
 * the duplicate it found — never a hole — and the next run removes it.
 */

export type NflverseGameRow = {
  playerId: string
  gameId: string
  season: number
  week: number
  opponent: string | null
  team: string | null
  stats: Record<string, number>
}

export type NflverseWriteOutcome = 'written' | 'replaced_synthetic' | 'merged_into_real' | 'skipped_ambiguous'

type Where = Record<string, unknown>
/** The slice of the Prisma client this step uses. */
export type NflverseStatDb = {
  playerGameStat: {
    upsert(args: { where: Where; update: Where; create: Where }): Promise<unknown>
    deleteMany(args: { where: Where }): Promise<{ count: number }>
    findMany(args: { where: Where; select: { id: true; gameId: true } }): Promise<Array<{ id: string; gameId: string }>>
    update(args: { where: { id: string }; data: Where }): Promise<unknown>
  }
}

const SYNTHETIC = /^NFL-\d{4}-W\d{2,}$/

export function syntheticNflverseGameId(season: number, week: number): string {
  return `NFL-${season}-W${String(week).padStart(2, '0')}`
}

export function isSyntheticNflverseGameId(gameId: string): boolean {
  return SYNTHETIC.test(gameId)
}

function statFields(r: NflverseGameRow) {
  return {
    season: r.season,
    weekOrRound: r.week,
    statPayload: r.stats,
    normalizedStatMap: r.stats,
    source: 'nflverse',
  }
}

export async function writeNflverseGameRow(db: NflverseStatDb, r: NflverseGameRow): Promise<NflverseWriteOutcome> {
  const playerWeek = { playerId: r.playerId, sportType: 'NFL', season: r.season, weekOrRound: r.week, source: 'nflverse' }

  if (isSyntheticNflverseGameId(r.gameId)) {
    const real = (await db.playerGameStat.findMany({ where: playerWeek, select: { id: true, gameId: true } }))
      .filter((row) => !isSyntheticNflverseGameId(row.gameId))
    if (real.length > 1) return 'skipped_ambiguous'
    if (real.length === 1) {
      await db.playerGameStat.update({
        where: { id: real[0].id },
        data: {
          ...statFields(r),
          opponent: r.opponent ?? undefined,
          team: r.team ?? undefined,
          updatedAt: new Date(),
        },
      })
      // A synthetic row left by an even earlier run would still double the week.
      await db.playerGameStat.deleteMany({ where: { ...playerWeek, gameId: r.gameId } })
      return 'merged_into_real'
    }
  }

  await db.playerGameStat.upsert({
    where: { playerId_sportType_gameId: { playerId: r.playerId, sportType: 'NFL', gameId: r.gameId } },
    update: {
      ...statFields(r),
      opponent: r.opponent ?? undefined,
      team: r.team ?? undefined,
      updatedAt: new Date(),
    },
    create: {
      playerId: r.playerId,
      sportType: 'NFL',
      gameId: r.gameId,
      ...statFields(r),
      // ⚠ fantasyPoints stays 0 here ON PURPOSE. Points are league-specific and computed by
      // leagueScoring.ts from the raw stats above; storing a single "fantasy points" number would bake
      // one league's rules into a shared row.
      fantasyPoints: 0,
      opponent: r.opponent,
      team: r.team,
    },
  })

  if (isSyntheticNflverseGameId(r.gameId)) return 'written'
  const removed = await db.playerGameStat.deleteMany({
    where: { ...playerWeek, gameId: syntheticNflverseGameId(r.season, r.week) },
  })
  return removed.count > 0 ? 'replaced_synthetic' : 'written'
}
