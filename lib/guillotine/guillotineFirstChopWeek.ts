/**
 * Commissioner edit of a guillotine league's FIRST CHOP WEEK
 * (`GuillotineLeagueConfig.eliminationStartWeek`).
 *
 * Before this there was no way to change it after creation: `upsertGuillotineConfig` exists but
 * nothing validated its input and no route called it with a commissioner check. The handler that
 * uses this lives on the existing `/api/leagues/[leagueId]/guillotine/summary` route as PATCH,
 * because the app sits at the route-count ceiling (see app/api/leagues/join/route.ts).
 *
 * Rules:
 *  - integer, 1 <= start <= eliminationEndWeek (the config's end week, else the sport default)
 *  - refused once the season's first chop has happened — moving the start after a team is already
 *    gone would rewrite who was eligible to be chopped. ANY of the three chop records counts,
 *    because two chop pipelines write different tables (event log + roster state for the native
 *    engine, `GuillotineElimination` for the season engine).
 */

import { prisma } from '@/lib/prisma'
import { getGuillotineConfig, upsertGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import type { GuillotineConfig } from '@/lib/guillotine/types'

type CountDelegate = { count: (args: { where: Record<string, unknown> }) => Promise<number> }

export type FirstChopDb = {
  guillotineEventLog: CountDelegate
  guillotineRosterState: CountDelegate
  guillotineElimination: CountDelegate
  guillotineLeagueConfig: { findUnique: (args: { where: { leagueId: string }; select: { id: true } }) => Promise<{ id: string } | null> }
}

export type FirstChopDeps = {
  db: FirstChopDb
  getConfig: (leagueId: string) => Promise<GuillotineConfig | null>
  upsert: typeof upsertGuillotineConfig
}

const defaultDeps = (): FirstChopDeps => ({
  db: prisma as unknown as FirstChopDb,
  getConfig: getGuillotineConfig,
  upsert: upsertGuillotineConfig,
})

export type FirstChopValidation =
  | { ok: true; week: number }
  | { ok: false; status: 400; error: string }

/** Pure range check. `endWeek` is the last chop week the config allows. */
export function validateFirstChopWeek(raw: unknown, endWeek: number): FirstChopValidation {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    return { ok: false, status: 400, error: 'First chop week must be a whole number.' }
  }
  if (n < 1) return { ok: false, status: 400, error: 'First chop week must be week 1 or later.' }
  if (n > endWeek) {
    return { ok: false, status: 400, error: `First chop week must be on or before the last chop week (${endWeek}).` }
  }
  return { ok: true, week: n }
}

/** True once any chop has been recorded for this league, by either chop engine. */
export async function hasFirstChopHappened(leagueId: string, db: FirstChopDb = defaultDeps().db): Promise<boolean> {
  const [events, states, eliminations] = await Promise.all([
    db.guillotineEventLog.count({ where: { leagueId, eventType: 'chop' } }),
    db.guillotineRosterState.count({ where: { leagueId, OR: [{ choppedAt: { not: null } }, { choppedInPeriod: { not: null } }] } }),
    db.guillotineElimination.count({ where: { leagueId } }),
  ])
  return events > 0 || states > 0 || eliminations > 0
}

export type UpdateFirstChopResult =
  | { ok: true; eliminationStartWeek: number; eliminationEndWeek: number }
  | { ok: false; status: 400 | 404 | 409; error: string }

/**
 * Validate and save. Caller is responsible for the commissioner check.
 *
 * ⚠ When no config ROW exists yet, `getGuillotineConfig` derives one from `League.settings`, and
 * a bare `upsert({ eliminationStartWeek })` would CREATE the row with schema defaults for every
 * other field — silently replacing settings-derived values (teams per chop, end week…). So on
 * create the whole derived config is written, with only the start week changed.
 */
export async function updateGuillotineFirstChopWeek(
  leagueId: string,
  rawWeek: unknown,
  deps: FirstChopDeps = defaultDeps(),
): Promise<UpdateFirstChopResult> {
  const config = await deps.getConfig(leagueId)
  if (!config) return { ok: false, status: 404, error: 'Not a guillotine league' }

  const endWeek = config.eliminationEndWeek ?? 18
  const validation = validateFirstChopWeek(rawWeek, endWeek)
  if (!validation.ok) return validation

  if (await hasFirstChopHappened(leagueId, deps.db)) {
    return { ok: false, status: 409, error: 'The first chop has already happened — the first chop week can no longer change.' }
  }

  const row = await deps.db.guillotineLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  const input = row
    ? { eliminationStartWeek: validation.week }
    : {
        eliminationStartWeek: validation.week,
        eliminationEndWeek: config.eliminationEndWeek,
        teamsPerChop: config.teamsPerChop,
        correctionWindow: config.correctionWindow,
        customCutoffDayOfWeek: config.customCutoffDayOfWeek,
        customCutoffTimeUtc: config.customCutoffTimeUtc,
        statCorrectionHours: config.statCorrectionHours,
        tiebreakerOrder: config.tiebreakerOrder,
        dangerMarginPoints: config.dangerMarginPoints,
        rosterReleaseTiming: config.rosterReleaseTiming,
        commissionerOverride: config.commissionerOverride,
      }
  const saved = await deps.upsert(leagueId, input)
  if (!saved) return { ok: false, status: 404, error: 'League not found' }
  return { ok: true, eliminationStartWeek: saved.eliminationStartWeek, eliminationEndWeek: saved.eliminationEndWeek ?? endWeek }
}
