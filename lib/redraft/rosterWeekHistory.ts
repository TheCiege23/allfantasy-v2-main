import { prisma } from '@/lib/prisma'

/**
 * WHO WAS ON A TEAM IN WEEK N — the roster record a sealed week is re-scored from.
 *
 * 🛑 THE CURRENT ROSTER CANNOT ANSWER THIS. A drop soft-deletes (`droppedAt`), but a trade MOVES the
 * `RedraftRosterPlayer` row to the other team (`tradeSettlement.ts` updates `rosterId`), so after a
 * week-5 trade the sending team has no row at all for the player it started in weeks 1–4, and the
 * receiving team's row says he is theirs. Re-scoring week 3 from the current roster — a stat
 * correction, a commish lineup edit — takes his points off the team that played him and can hand
 * them to the team that did not have him yet.
 *
 * So every scoring pass records the roster it scored (`redraft_roster_weeks`, one row per roster per
 * week) and FREEZES it once the matchup is final. A frozen row is the roster for that week from then
 * on; an unfrozen one is rewritten on each pass, so it follows waiver adds and trades while the week
 * is still live, exactly as scoring did before.
 *
 * ⚠ ADDITIVE, AND IT MAY RUN AHEAD OF ITS MIGRATION. Every read and write here swallows a failure and
 * returns the pre-existing behaviour (current roster, nothing recorded): code that ships before
 * `20261013230000_redraft_roster_weeks` is applied must not take scoring down with P2021.
 *
 * ⚠ WEEKS SEALED BEFORE THIS LANDED HAVE NO ROW, and are re-scored from the current roster as before.
 */

export type WeekRosterPlayer = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  sport: string
  slotType: string
}

/** The fields scoring reads off a roster player — what a `RedraftRosterPlayer` row and a recorded one share. */
export type ScoringRosterPlayer = WeekRosterPlayer & { rosterId: string }

type Db = Pick<typeof prisma, 'redraftRosterWeek' | 'redraftRosterPlayer'>

function readPlayers(raw: unknown): WeekRosterPlayer[] | null {
  if (!Array.isArray(raw)) return null
  const out: WeekRosterPlayer[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') return null
    const r = p as Record<string, unknown>
    if (typeof r.playerId !== 'string' || !r.playerId) return null
    out.push({
      playerId: r.playerId,
      playerName: typeof r.playerName === 'string' ? r.playerName : r.playerId,
      position: typeof r.position === 'string' ? r.position : '',
      team: typeof r.team === 'string' ? r.team : null,
      sport: typeof r.sport === 'string' ? r.sport : 'NFL',
      slotType: typeof r.slotType === 'string' ? r.slotType : 'BENCH',
    })
  }
  return out
}

/** The frozen roster for (roster, week), or null when the week was never frozen (or the table is absent). */
export async function loadFrozenWeekRoster(
  rosterId: string,
  week: number,
  db: Db = prisma,
): Promise<WeekRosterPlayer[] | null> {
  try {
    const row = await db.redraftRosterWeek.findUnique({
      where: { rosterId_week: { rosterId, week } },
      select: { frozen: true, players: true },
    })
    if (!row?.frozen) return null
    return readPlayers(row.players)
  } catch {
    return null
  }
}

/** Who to score for (roster, week): the frozen record when there is one, else the current roster. */
export async function rosterPlayersForWeek(
  rosterId: string,
  week: number,
  db: Db = prisma,
): Promise<{ players: ScoringRosterPlayer[]; frozen: boolean }> {
  const frozen = await loadFrozenWeekRoster(rosterId, week, db)
  if (frozen) return { players: frozen.map((p) => ({ ...p, rosterId })), frozen: true }
  const rows = await db.redraftRosterPlayer.findMany({
    where: { rosterId, droppedAt: null },
    select: { rosterId: true, playerId: true, playerName: true, position: true, team: true, sport: true, slotType: true },
  })
  return { players: rows, frozen: false }
}

/**
 * Record what a scoring pass scored. Never touches a frozen row — only `replaceFrozenWeekRoster` does,
 * and only for the commish. `freeze` is set when the matchup went final on this pass.
 */
export async function recordWeekRoster(
  input: { rosterId: string; seasonId: string; week: number; players: WeekRosterPlayer[]; freeze: boolean },
  db: Db = prisma,
): Promise<void> {
  const players = input.players.map(toRecord)
  try {
    const updated = await db.redraftRosterWeek.updateMany({
      where: { rosterId: input.rosterId, week: input.week, frozen: false },
      data: { players, frozen: input.freeze, seasonId: input.seasonId },
    })
    if (updated.count > 0) return
    await db.redraftRosterWeek.create({
      data: { rosterId: input.rosterId, seasonId: input.seasonId, week: input.week, players, frozen: input.freeze },
    })
  } catch {
    // P2002: the row exists and is frozen (or a concurrent pass created it) — nothing to do.
    // P2021: the migration is not applied yet — scoring carries on exactly as before.
  }
}

/** The commish's correction of who was on a team for a sealed week. Writes the row frozen. */
export async function replaceFrozenWeekRoster(
  input: { rosterId: string; seasonId: string; week: number; players: WeekRosterPlayer[] },
  db: Db = prisma,
): Promise<boolean> {
  const players = input.players.map(toRecord)
  try {
    await db.redraftRosterWeek.upsert({
      where: { rosterId_week: { rosterId: input.rosterId, week: input.week } },
      create: { rosterId: input.rosterId, seasonId: input.seasonId, week: input.week, players, frozen: true },
      update: { players, frozen: true },
    })
    return true
  } catch {
    return false
  }
}

function toRecord(p: WeekRosterPlayer) {
  return {
    playerId: p.playerId,
    playerName: p.playerName,
    position: p.position,
    team: p.team,
    sport: p.sport,
    slotType: p.slotType,
  }
}
