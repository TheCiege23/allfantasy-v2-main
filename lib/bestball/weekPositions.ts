/**
 * A PLAYER'S POSITION FOR ONE SCORING WEEK — the position history the schema did not have.
 *
 * `SportsPlayer.position` and the roster rows hold the CURRENT position only, so rescoring a past best
 * ball week seated a re-listed player at today's position (audit 2026-11-06, "Position-change effective
 * dates"). A sealed week already keeps its positions in the result stamp (`sealedPositions`,
 * resultRuleStamp.ts). This covers every week, sealed or not, from the moment its weekly score is written:
 *
 *   record   The weekly score sync (playerWeeklyScoreService.ts) records the position it computed each
 *            player's week with. While the week is open the row follows the roster's position; once the
 *            week finalizes (weekFinalizer.ts) the row is FROZEN and never rewritten.
 *   read     Best ball (redraft/scoringEngine.ts) seats a player at: the sealed position, else this
 *            week's recorded position, else his current one.
 *
 * The listed (roster) position is recorded, not a box-score position. Rolling Insights game rows carry a
 * per-game position for NBA/NHL/soccer/NCAAB, but they include generic codes (`G`, `F`) that no lineup seat
 * accepts as eligibility, so seating by them could strand a player. Weeks before this existed have no row
 * and keep today's behaviour; nothing is back-filled.
 *
 * 🛑 THE TABLE ARRIVES BY MIGRATION (20261110210000_player_week_positions), WHICH IS APPLIED SEPARATELY.
 * Until then every call here is a no-op that answers "nothing recorded", so scoring is exactly what it
 * was. Only Prisma's "table/column does not exist" errors are swallowed; any other database error still
 * throws, so an outage never reads as "no history".
 */

type WeekKey = { sport: string; season: number; week: number }

type PositionRow = { playerId: string; position: string | null; frozen: boolean }

/** The subset of the Prisma client this module uses (a transaction client works too). */
export type WeekPositionDb = {
  playerWeekPosition: {
    findMany(args: unknown): Promise<PositionRow[]>
    createMany(args: unknown): Promise<{ count: number }>
    updateMany(args: unknown): Promise<{ count: number }>
  }
}

export const WEEK_POSITION_SOURCE = 'weekly_score_sync'

/** Prisma's codes for "the migration has not been applied here". */
export function isMissingWeekPositionTable(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  if (code === 'P2021' || code === 'P2022') return true
  const msg = e instanceof Error ? e.message : String(e)
  return /does not exist in the current database|relation .* does not exist/i.test(msg)
}

/**
 * A client generated before the model existed (or a test double without it) has no `playerWeekPosition`
 * delegate at all — the same "not migrated here" as a missing table, so the same no-op answer.
 */
async function orMissing<T>(db: WeekPositionDb, fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!(db as Partial<WeekPositionDb>)?.playerWeekPosition) return fallback
  try {
    return await fn()
  } catch (e) {
    if (isMissingWeekPositionTable(e)) return fallback
    throw e
  }
}

/**
 * Record each player's position for the week. New rows are created; an existing row is updated only
 * while it is not frozen and only when the position changed. Returns how many rows were written.
 */
export async function recordWeekPositions(
  db: WeekPositionDb,
  key: WeekKey,
  positions: ReadonlyMap<string, string | null>,
): Promise<number> {
  const playerIds = [...positions.keys()]
  if (playerIds.length === 0) return 0
  return orMissing(db, async () => {
    const existing = await db.playerWeekPosition.findMany({
      where: { sport: key.sport, season: key.season, week: key.week, playerId: { in: playerIds } },
      select: { playerId: true, position: true, frozen: true },
    })
    const byId = new Map(existing.map((row) => [row.playerId, row]))
    const creates = playerIds.filter((id) => !byId.has(id))
    let written = 0
    if (creates.length > 0) {
      const created = await db.playerWeekPosition.createMany({
        data: creates.map((playerId) => ({
          playerId,
          sport: key.sport,
          season: key.season,
          week: key.week,
          position: positions.get(playerId) ?? null,
          source: WEEK_POSITION_SOURCE,
        })),
        skipDuplicates: true,
      })
      written += created.count
    }
    for (const [playerId, row] of byId) {
      const position = positions.get(playerId) ?? null
      if (row.frozen || row.position === position) continue
      // `frozen: false` in the WHERE as well: a finalize that lands between the read and this write wins.
      const updated = await db.playerWeekPosition.updateMany({
        where: { playerId, sport: key.sport, season: key.season, week: key.week, frozen: false },
        data: { position },
      })
      written += updated.count
    }
    return written
  }, 0)
}

/** Freeze the week's rows for these players: from now on their recorded position never changes. */
export async function freezeWeekPositions(db: WeekPositionDb, key: WeekKey, playerIds: readonly string[]): Promise<number> {
  if (playerIds.length === 0) return 0
  return orMissing(
    db,
    async () =>
      (
        await db.playerWeekPosition.updateMany({
          where: { sport: key.sport, season: key.season, week: key.week, playerId: { in: [...playerIds] }, frozen: false },
          data: { frozen: true },
        })
      ).count,
    0,
  )
}

/** playerId -> the position recorded for this week. A player with no row is absent (use his current one). */
export async function readWeekPositions(
  db: WeekPositionDb,
  key: WeekKey,
  playerIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (playerIds.length === 0) return new Map()
  return orMissing(db, async () => {
    const rows = await db.playerWeekPosition.findMany({
      where: { sport: key.sport, season: key.season, week: key.week, playerId: { in: [...playerIds] } },
      select: { playerId: true, position: true, frozen: true },
    })
    return new Map(rows.map((row) => [row.playerId, row.position]))
  }, new Map<string, string | null>())
}
