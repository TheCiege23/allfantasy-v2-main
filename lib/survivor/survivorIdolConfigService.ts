import { randomInt } from 'node:crypto'
import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { survivorIdolEnginePowerFor } from './survivorIdolEngines'
import {
  BUNDLED_SURVIVOR_IDOL_TYPES,
  SURVIVOR_IDOL_CATEGORIES,
  isSurvivorIdolTypePlayable,
  SURVIVOR_IDOL_COUNT_DEFAULT,
  SURVIVOR_POINT_SURGE_DEFAULT_PCT,
  SURVIVOR_TRIBUTE_DEFAULT_PCT,
  type SurvivorIdolCategory,
  type SurvivorIdolTypeDef,
} from './survivorIdolTypes'
import {
  isSurvivorIdolCount,
  resolveSurvivorIdolTypeIds,
  validatePickedIdolTypes,
  type SurvivorIdolDrawMode,
  type SurvivorRandomInt,
} from './survivorIdolDraw'

/**
 * Commissioner idol setup (survivor-theme handoff, IdolSetup) and the sealed draw at draft lock.
 *
 * Secrecy:
 *  - `resolvedTypeIds` (the league's drawn types) reach the commissioner only, and never when they
 *    chose "Hide the draw from me too". Other managers learn types only as idols are played.
 *  - `pickedTypeIds` (pick mode) reach the commissioner only.
 *  - Which players hold idols is never part of this service; see survivorIdolProvisioning.
 * Settings lock once the draft starts.
 */

type Db = Prisma.TransactionClient | typeof prisma

export type SurvivorIdolConfigValues = {
  mode: SurvivorIdolDrawMode
  count: number
  hideFromCommish: boolean
  pickedTypeIds: string[]
  pointSurgePct: number
  tributePct: number
}

type ConfigRow = SurvivorIdolConfigValues & { resolvedTypeIds: string[]; resolvedAt: Date | null }

export const SURVIVOR_IDOL_CONFIG_DEFAULTS: SurvivorIdolConfigValues = {
  mode: 'random',
  count: SURVIVOR_IDOL_COUNT_DEFAULT,
  hideFromCommish: false,
  pickedTypeIds: [],
  pointSurgePct: SURVIVOR_POINT_SURGE_DEFAULT_PCT,
  tributePct: SURVIVOR_TRIBUTE_DEFAULT_PCT,
}

/** Server draws use the OS CSPRNG. */
export const secureRandomInt: SurvivorRandomInt = (maxExclusive) => (maxExclusive <= 1 ? 0 : randomInt(0, maxExclusive))

const STARTED_DRAFT_STATUSES = ['in_progress', 'paused', 'completed']

function clampCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SURVIVOR_IDOL_COUNT_DEFAULT
  return Math.min(8, Math.max(6, Math.round(value)))
}

type TypeRow = {
  id: string; name: string; glow: string; category: string; tier: number; alwaysIn: boolean
  shortText: string; powerText: string; whenText: string; targetText: string; enginePowerType: string | null; sortOrder: number
}

function fromRow(row: TypeRow): SurvivorIdolTypeDef {
  const category = (SURVIVOR_IDOL_CATEGORIES as readonly string[]).includes(row.category) ? row.category as SurvivorIdolCategory : 'Game'
  return {
    id: row.id, name: row.name, glow: row.glow, category, tier: row.tier >= 3 ? 3 : row.tier <= 1 ? 1 : 2,
    alwaysIn: row.alwaysIn, short: row.shortText, power: row.powerText, when: row.whenText, target: row.targetText,
    // Playability comes from the play-engine registry, not from the stored column alone.
    enginePowerType: survivorIdolEnginePowerFor(row.id, row.enginePowerType), sortOrder: row.sortOrder,
  }
}

let tablesReady = false

/**
 * Whether this handoff's tables exist. Checked with to_regclass, which never errors, because a
 * failed query inside a transaction would abort the caller's whole transaction (idol seeding).
 */
export async function survivorIdolTablesReady(db: Db = prisma): Promise<boolean> {
  if (tablesReady) return true
  const raw = (db as { $queryRaw?: unknown }).$queryRaw
  if (typeof raw !== 'function') return true
  try {
    const rows = await (db as typeof prisma).$queryRaw<Array<{ t: string | null; c: string | null }>>`SELECT to_regclass('survivor_idol_types')::text AS t, to_regclass('survivor_idol_configs')::text AS c`
    tablesReady = Boolean(rows[0]?.t && rows[0]?.c)
  } catch {
    tablesReady = false
  }
  return tablesReady
}

/** Active idol types from `survivor_idol_types`; the bundled catalog until that table is migrated. */
export async function loadSurvivorIdolTypes(db: Db = prisma): Promise<SurvivorIdolTypeDef[]> {
  try {
    if (!(await survivorIdolTablesReady(db))) return [...BUNDLED_SURVIVOR_IDOL_TYPES]
    const rows = await (db as typeof prisma).survivorIdolType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
    if (rows.length) return rows.map(fromRow)
  } catch {
    // Table not migrated yet: fall through to the bundled catalog.
  }
  return [...BUNDLED_SURVIVOR_IDOL_TYPES]
}

export async function isSurvivorDraftStarted(leagueId: string, db: Db = prisma): Promise<boolean> {
  const started = await db.draftSession.findFirst({
    where: { leagueId, status: { in: STARTED_DRAFT_STATUSES }, NOT: { sessionKind: 'mock' } },
    select: { id: true },
  })
  return Boolean(started)
}

async function readConfigRow(leagueId: string, db: Db): Promise<ConfigRow | null> {
  const row = await (db as typeof prisma).survivorIdolConfig.findUnique({ where: { leagueId } })
  if (!row) return null
  return {
    mode: row.mode === 'pick' ? 'pick' : 'random',
    count: clampCount(row.count),
    hideFromCommish: row.hideFromCommish,
    pickedTypeIds: row.pickedTypeIds ?? [],
    pointSurgePct: row.pointSurgePct,
    tributePct: row.tributePct,
    resolvedTypeIds: row.resolvedTypeIds ?? [],
    resolvedAt: row.resolvedAt,
  }
}

export type SurvivorIdolSetupView = {
  types: SurvivorIdolTypeDef[]
  isCommissioner: boolean
  locked: boolean
  config: SurvivorIdolConfigValues
  /** The drawn types. Null unless the viewer is a commissioner who did not hide the draw. */
  resolvedTypeIds: string[] | null
  resolved: boolean
  saved: boolean
}

/** Pure projection of the setup for one viewer; every secrecy rule lives here. */
export function projectSurvivorIdolSetup(input: {
  types: SurvivorIdolTypeDef[]
  row: ConfigRow | null
  fallbackCount: number | null
  isCommissioner: boolean
  /**
   * Whether the viewer may see the sealed draw (`resolvedTypeIds`). A commissioner who PLAYS is a
   * manager for hidden information, so this is false for them even though `isCommissioner` is true
   * and they still edit the setup. Defaults to `isCommissioner` for internal callers.
   */
  canSeeDraw?: boolean
  locked: boolean
}): SurvivorIdolSetupView {
  const { row, isCommissioner } = input
  const canSeeDraw = input.canSeeDraw ?? isCommissioner
  const values: SurvivorIdolConfigValues = row
    ? { mode: row.mode, count: row.count, hideFromCommish: row.hideFromCommish, pickedTypeIds: row.pickedTypeIds, pointSurgePct: row.pointSurgePct, tributePct: row.tributePct }
    : { ...SURVIVOR_IDOL_CONFIG_DEFAULTS, count: clampCount(input.fallbackCount) }
  const resolved = Boolean(row?.resolvedTypeIds.length)
  const canSeeTypes = canSeeDraw && !values.hideFromCommish
  return {
    types: input.types,
    isCommissioner,
    locked: input.locked,
    config: { ...values, pickedTypeIds: isCommissioner && values.mode === 'pick' ? values.pickedTypeIds : [] },
    resolvedTypeIds: canSeeTypes && resolved ? row!.resolvedTypeIds : null,
    resolved,
    saved: Boolean(row),
  }
}

export async function getSurvivorIdolSetupView(leagueId: string, viewer: { isCommissioner: boolean; canSeeDraw?: boolean }, db: Db = prisma): Promise<SurvivorIdolSetupView> {
  const [types, locked, league] = await Promise.all([
    loadSurvivorIdolTypes(db),
    isSurvivorDraftStarted(leagueId, db),
    db.league.findUnique({ where: { id: leagueId }, select: { survivorIdolCount: true } }),
  ])
  let row: ConfigRow | null = null
  if (await survivorIdolTablesReady(db)) {
    try { row = await readConfigRow(leagueId, db) } catch { row = null }
  }
  return projectSurvivorIdolSetup({ types, row, fallbackCount: league?.survivorIdolCount ?? null, isCommissioner: viewer.isCommissioner, canSeeDraw: viewer.canSeeDraw, locked })
}

export type SaveSurvivorIdolConfigResult =
  | { ok: true; config: SurvivorIdolConfigValues }
  | { ok: false; status: 400 | 409 | 422 | 503; code: string; error: string }

export function parseSurvivorIdolConfigInput(body: unknown): { ok: true; value: SurvivorIdolConfigValues } | { ok: false; error: string } {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const mode = raw.mode === 'pick' ? 'pick' : raw.mode === 'random' || raw.mode == null ? 'random' : null
  if (!mode) return { ok: false, error: 'Mode must be random or pick.' }
  const count = raw.count == null ? SURVIVOR_IDOL_COUNT_DEFAULT : Number(raw.count)
  if (!isSurvivorIdolCount(count)) return { ok: false, error: 'Choose 6, 7 or 8 idols.' }
  const picked = raw.pickedTypeIds == null ? [] : raw.pickedTypeIds
  if (!Array.isArray(picked) || picked.some(id => typeof id !== 'string')) return { ok: false, error: 'Picked idol types must be a list of ids.' }
  const surge = raw.pointSurgePct == null ? SURVIVOR_POINT_SURGE_DEFAULT_PCT : Number(raw.pointSurgePct)
  const tribute = raw.tributePct == null ? SURVIVOR_TRIBUTE_DEFAULT_PCT : Number(raw.tributePct)
  if (!Number.isInteger(surge) || surge < 1 || surge > 100) return { ok: false, error: 'Point surge must be a whole percent from 1 to 100.' }
  if (!Number.isInteger(tribute) || tribute < 1 || tribute > 50) return { ok: false, error: 'Tribute must be a whole percent from 1 to 50.' }
  return {
    ok: true,
    value: {
      mode, count, hideFromCommish: mode === 'random' && raw.hideFromCommish === true,
      pickedTypeIds: mode === 'pick' ? picked as string[] : [], pointSurgePct: surge, tributePct: tribute,
    },
  }
}

/**
 * Save the commissioner's setup. Refused once the draft starts. Any earlier provisional draw is
 * discarded, so turning "hide" off can never reveal a draw made while it was on.
 */
export async function saveSurvivorIdolConfig(leagueId: string, body: unknown, db: Db = prisma): Promise<SaveSurvivorIdolConfigResult> {
  const parsed = parseSurvivorIdolConfigInput(body)
  if (!parsed.ok) return { ok: false, status: 400, code: 'invalid_config', error: parsed.error }
  if (await isSurvivorDraftStarted(leagueId, db)) {
    return { ok: false, status: 409, code: 'settings_locked', error: 'Idol settings lock when the draft starts.' }
  }
  const value = parsed.value
  if (value.mode === 'pick') {
    const check = validatePickedIdolTypes(await loadSurvivorIdolTypes(db), value.count, value.pickedTypeIds)
    if (!check.ok) return { ok: false, status: 422, code: check.code, error: check.error }
  }
  const data = { ...value, resolvedTypeIds: [] as string[], resolvedAt: null }
  if (!(await survivorIdolTablesReady(db))) {
    return { ok: false, status: 503, code: 'not_migrated', error: 'Idol setup is not available until the database is updated.' }
  }
  try {
    await (db as typeof prisma).survivorIdolConfig.upsert({ where: { leagueId }, create: { leagueId, ...data }, update: data })
  } catch {
    return { ok: false, status: 503, code: 'not_migrated', error: 'Idol setup is not available until the database is updated.' }
  }
  // Legacy readers (seeding fallback, FAQ, host copy) read the league column.
  await db.league.update({ where: { id: leagueId }, data: { survivorIdolCount: value.count } })
  return { ok: true, config: value }
}

export type LockedSurvivorIdolDraw = { typeIds: string[]; types: SurvivorIdolTypeDef[]; drawnNow: boolean }

/**
 * The real draw, made once at draft lock with a secure RNG and sealed on the config row.
 * Idempotent: a league that already has a draw keeps it. Returns null when the league opts out of
 * the catalog system (no setup row and a commissioner-saved legacy power pool) or when the tables
 * are not migrated, so callers fall back to the legacy seeding path.
 */
export async function lockSurvivorIdolDraw(leagueId: string, db: Db = prisma, rng: SurvivorRandomInt = secureRandomInt): Promise<LockedSurvivorIdolDraw | null> {
  try {
    if (!(await survivorIdolTablesReady(db))) return null
    const types = await loadSurvivorIdolTypes(db)
    let row = await readConfigRow(leagueId, db)
    if (!row) {
      const legacy = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { idolPowerPool: true } })
      if (Array.isArray(legacy?.idolPowerPool) && legacy.idolPowerPool.length > 0) return null
      const league = await db.league.findUnique({ where: { id: leagueId }, select: { survivorIdolCount: true } })
      const count = clampCount(league?.survivorIdolCount ?? null)
      await (db as typeof prisma).survivorIdolConfig.upsert({
        where: { leagueId },
        create: { leagueId, ...SURVIVOR_IDOL_CONFIG_DEFAULTS, count },
        update: {},
      })
      row = await readConfigRow(leagueId, db)
      if (!row) return null
    }
    const byId = new Map(types.map(type => [type.id, type]))
    const allPlayable = (ids: string[]) => ids.every(id => { const type = byId.get(id); return Boolean(type && isSurvivorIdolTypePlayable(type)) })
    // A sealed draw is kept only while every type in it is playable; idols are never seeded
    // with a type that has no play engine.
    if (row.resolvedTypeIds.length && allPlayable(row.resolvedTypeIds)) {
      return { typeIds: row.resolvedTypeIds, types: row.resolvedTypeIds.flatMap(id => byId.get(id) ?? []), drawnNow: false }
    }
    const stale = row.resolvedTypeIds
    // Saved picks that are no longer valid fall back to the balanced draw: the draw never fails.
    let draw = resolveSurvivorIdolTypeIds(types, row, rng)
    if (!draw.ok && row.mode === 'pick') draw = resolveSurvivorIdolTypeIds(types, { ...row, mode: 'random' }, rng)
    if (!draw.ok) return null
    // Only the first lock writes; a concurrent lock re-reads the winner's draw.
    const written = await (db as typeof prisma).survivorIdolConfig.updateMany({
      where: stale.length ? { leagueId, resolvedTypeIds: { equals: stale } } : { leagueId, resolvedTypeIds: { isEmpty: true } },
      data: { resolvedTypeIds: draw.typeIds, resolvedAt: new Date() },
    })
    const typeIds = written.count > 0 ? draw.typeIds : (await readConfigRow(leagueId, db))?.resolvedTypeIds ?? draw.typeIds
    return { typeIds, types: typeIds.flatMap(id => byId.get(id) ?? []), drawnNow: written.count > 0 }
  } catch {
    return null
  }
}
