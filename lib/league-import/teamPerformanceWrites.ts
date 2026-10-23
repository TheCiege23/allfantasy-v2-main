/**
 * Change-aware, batched `team_performances` writes for an imported league's schedule.
 *
 * The league sync re-applies every played week of the schedule on every run, and a past week's
 * score almost never moves. The old path issued two `upsert`s per matchup per week, every run, so
 * each of the table's ~106k rows was rewritten ~15 times a day (14.8M upserts in 9 days, measured
 * 2026-10-23). This reads the season once, writes only rows that are new or differ, and sends
 * those in one statement.
 *
 * ⚠ THE "KEEP WHAT IS STORED" RULES OF THE OLD UPSERT ARE PRESERVED EXACTLY, because they are what
 * stops a partial provider response from erasing a known value:
 *   - `opponent` was `tid ?? undefined` on update, so a matchup whose opponent did not resolve to a
 *     team left the stored opponent alone. Here: COALESCE(incoming, stored).
 *   - `result` was `undefined` on update when the opponent had no points yet. Same rule.
 *   - On create, both are null when unknown.
 * The comparison below applies the same rules, so "unchanged" means "the old upsert would have
 * written exactly what is already there".
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export type TeamPerformanceWrite = {
  teamId: string
  week: number
  points: number
  /** Null when the opponent did not resolve to one of this league's teams — keeps the stored value. */
  opponent: string | null
  /** Null when the opponent has no points yet — keeps the stored value. */
  result: string | null
}

type StoredPerformance = {
  teamId: string
  week: number
  points: number
  opponent: string | null
  result: string | null
}

const keyOf = (teamId: string, week: number) => `${teamId}\u0001${week}`

/**
 * Collapse repeated (team, week) entries the way the old sequential upserts did: the later entry's
 * points win, and a null opponent/result keeps whatever the earlier entry set.
 */
export function collapseTeamPerformanceWrites(rows: TeamPerformanceWrite[]): TeamPerformanceWrite[] {
  const byKey = new Map<string, TeamPerformanceWrite>()
  for (const row of rows) {
    const key = keyOf(row.teamId, row.week)
    const prev = byKey.get(key)
    byKey.set(key, {
      ...row,
      opponent: row.opponent ?? prev?.opponent ?? null,
      result: row.result ?? prev?.result ?? null,
    })
  }
  return [...byKey.values()]
}

/** The rows that would change the table, given what is stored. Pure, for tests. */
export function changedTeamPerformances(
  rows: TeamPerformanceWrite[],
  stored: StoredPerformance[],
): TeamPerformanceWrite[] {
  const storedByKey = new Map(stored.map((s) => [keyOf(s.teamId, s.week), s]))
  return rows.filter((row) => {
    const prior = storedByKey.get(keyOf(row.teamId, row.week))
    if (!prior) return true
    return !(
      prior.points === row.points &&
      prior.opponent === (row.opponent ?? prior.opponent) &&
      prior.result === (row.result ?? prior.result)
    )
  })
}

export type TeamPerformanceWriteResult = {
  /** Distinct (team, week) rows the schedule carried — what the old path counted as "created". */
  processed: number
  /** Rows sent because they were new or differed. */
  changed: number
  /** Rows the database actually inserted or updated. */
  written: number
  /** True when the batch failed and the per-row fallback ran. */
  fellBack: boolean
}

export async function writeTeamPerformances(input: {
  season: number
  rows: TeamPerformanceWrite[]
}): Promise<TeamPerformanceWriteResult> {
  const rows = collapseTeamPerformanceWrites(input.rows)
  const out: TeamPerformanceWriteResult = { processed: rows.length, changed: 0, written: 0, fellBack: false }
  if (rows.length === 0) return out

  const teamIds = [...new Set(rows.map((r) => r.teamId))]
  let stored: StoredPerformance[] | null = null
  try {
    stored = await prisma.teamPerformance.findMany({
      where: { teamId: { in: teamIds }, season: input.season },
      select: { teamId: true, week: true, points: true, opponent: true, result: true },
    })
  } catch {
    // Could not tell what is stored: treat every row as changed and take the per-row path below.
  }
  const changed = stored ? changedTeamPerformances(rows, stored) : rows
  out.changed = changed.length
  if (changed.length === 0) return out

  const payload = changed.map((r) => ({ id: randomUUID(), ...r }))
  try {
    if (!stored) throw new Error('stored performances unavailable')
    out.written = await prisma.$executeRaw`
      INSERT INTO team_performances (id, "teamId", week, season, points, opponent, result, "createdAt")
      SELECT r.id, r."teamId", r.week, ${input.season}, r.points, r.opponent, r.result, now()
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
          AS r(id text, "teamId" text, week integer, points double precision, opponent text, result text)
      ON CONFLICT ("teamId", season, week) DO UPDATE
        SET points = EXCLUDED.points,
            opponent = COALESCE(EXCLUDED.opponent, team_performances.opponent),
            result = COALESCE(EXCLUDED.result, team_performances.result)
      WHERE (team_performances.points, team_performances.opponent, team_performances.result)
            IS DISTINCT FROM
            (EXCLUDED.points,
             COALESCE(EXCLUDED.opponent, team_performances.opponent),
             COALESCE(EXCLUDED.result, team_performances.result))`
    return out
  } catch {
    /*
     * The old path wrapped each upsert in its own try/catch and ignored failures, so one bad row
     * (a team removed mid-sync, say) never cost the rest of the schedule. A single statement fails
     * as a whole, so on failure fall back to that exact per-row behaviour for the changed rows.
     */
    out.fellBack = true
  }

  for (const r of changed) {
    try {
      await prisma.teamPerformance.upsert({
        where: { teamId_season_week: { teamId: r.teamId, season: input.season, week: r.week } },
        create: {
          teamId: r.teamId,
          week: r.week,
          season: input.season,
          points: r.points,
          opponent: r.opponent ?? undefined,
          result: r.result,
        },
        update: {
          points: r.points,
          opponent: r.opponent ?? undefined,
          result: r.result ?? undefined,
        },
      })
      out.written += 1
    } catch {
      // ignore duplicate or constraint errors, as the per-row path always has
    }
  }
  return out
}
