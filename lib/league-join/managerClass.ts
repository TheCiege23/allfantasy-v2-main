/**
 * Manager class — the ±2 level band that keeps managers playing people at their
 * own experience level.
 *
 * A manager at Level N may join a league whose class is centred anywhere from
 * N-2 to N+2. The only way outside that band is a commissioner exception for
 * ONE named manager: granted directly, or by approving that manager's request.
 *
 * ⚠ ONE BAND, EVERYWHERE. Before 2026-10-01 there were three: joining used the
 * creator's level ±3, discovery and the League finder used ±1, and the shared
 * invite-code bypass let anyone holding the code skip the check entirely. Every
 * caller now reads `MANAGER_CLASS_BAND` from here.
 *
 * Pure: no prisma, no `server-only`, so the rules are unit-tested directly.
 * Exceptions and requests live in `League.settings` (JSON) rather than a new
 * table — a table is a migration, and a migration is the user's call.
 */

import { RANK_LEVELS } from '@/lib/rank/levels'

export const MANAGER_CLASS_BAND = 2
export const MAX_CLASS_LEVEL = RANK_LEVELS.length

/** `League.settings` keys. */
export const CLASS_EXCEPTIONS_KEY = 'managerClassExceptions'
export const CLASS_REQUESTS_KEY = 'managerClassJoinRequests'

/** Bounds the JSON so a flood of requests cannot grow `League.settings` without limit. */
export const MAX_CLASS_REQUESTS = 50
export const MAX_CLASS_EXCEPTIONS = 100

export type ClassRange = { center: number; min: number; max: number }

export type ClassException = {
  userId: string
  grantedBy: string
  grantedAt: string
  /** `direct` — the commissioner named the manager; `request` — approved a request. */
  via: 'direct' | 'request'
  /** The manager's level when the exception was granted, for the commissioner's record. */
  levelAtGrant: number | null
}

export type ClassJoinRequest = {
  userId: string
  requestedAt: string
  levelAtRequest: number | null
}

export function clampLevel(value: unknown, fallback = 1): number {
  const n = Number(value)
  const v = Number.isFinite(n) ? Math.floor(n) : Math.floor(fallback)
  return Math.max(1, Math.min(MAX_CLASS_LEVEL, v))
}

/** The band centred on `level`, clipped to the ladder. */
export function classRangeFor(level: number): ClassRange {
  const center = clampLevel(level)
  return {
    center,
    min: Math.max(1, center - MANAGER_CLASS_BAND),
    max: Math.min(MAX_CLASS_LEVEL, center + MANAGER_CLASS_BAND),
  }
}

export function isWithinClass(userLevel: number, range: Pick<ClassRange, 'min' | 'max'>): boolean {
  const lvl = clampLevel(userLevel)
  return lvl >= range.min && lvl <= range.max
}

/**
 * A league's class range from its listing row.
 *
 * The CENTRE wins over the stored min/max: listings written before 2026-10-01
 * stored the creator's level ±3, and recomputing from the centre is what moves
 * those leagues to ±2 without a data migration. A row with no centre but a
 * stored range keeps that range; a row with neither has no class.
 */
export function resolveLeagueClassRange(listing: {
  creatorRankLevel?: number | null
  minRankLevel?: number | null
  maxRankLevel?: number | null
} | null): ClassRange | null {
  if (!listing) return null
  if (listing.creatorRankLevel != null && Number.isFinite(Number(listing.creatorRankLevel))) {
    return classRangeFor(listing.creatorRankLevel)
  }
  if (listing.minRankLevel == null || listing.maxRankLevel == null) return null
  const min = clampLevel(listing.minRankLevel)
  const max = clampLevel(listing.maxRankLevel)
  if (min > max) return null
  return { center: Math.round((min + max) / 2), min, max }
}

/* ───────────────────────── League.settings helpers ───────────────────────── */

type Settings = Record<string, unknown>

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function levelOrNull(v: unknown): number | null {
  return v == null || !Number.isFinite(Number(v)) ? null : clampLevel(v)
}

/** Exceptions stored on a league, malformed entries dropped, one per user. */
export function readClassExceptions(settings: unknown): ClassException[] {
  const raw = isRecord(settings) ? settings[CLASS_EXCEPTIONS_KEY] : null
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ClassException[] = []
  for (const e of raw) {
    if (!isRecord(e)) continue
    const userId = str(e.userId)
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    out.push({
      userId,
      grantedBy: str(e.grantedBy) ?? 'unknown',
      grantedAt: str(e.grantedAt) ?? new Date(0).toISOString(),
      via: e.via === 'request' ? 'request' : 'direct',
      levelAtGrant: levelOrNull(e.levelAtGrant),
    })
  }
  return out
}

/** Pending requests stored on a league, malformed entries dropped, one per user. */
export function readClassJoinRequests(settings: unknown): ClassJoinRequest[] {
  const raw = isRecord(settings) ? settings[CLASS_REQUESTS_KEY] : null
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ClassJoinRequest[] = []
  for (const r of raw) {
    if (!isRecord(r)) continue
    const userId = str(r.userId)
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    out.push({
      userId,
      requestedAt: str(r.requestedAt) ?? new Date(0).toISOString(),
      levelAtRequest: levelOrNull(r.levelAtRequest),
    })
  }
  return out
}

export function hasClassException(settings: unknown, userId: string): boolean {
  return readClassExceptions(settings).some((e) => e.userId === userId)
}

/**
 * Settings with `userId` granted an exception. Any pending request from the
 * same manager is cleared, since it has now been answered.
 */
export function withClassException(
  settings: unknown,
  input: { userId: string; grantedBy: string; via: ClassException['via']; levelAtGrant: number | null; now?: Date },
): Settings {
  const base: Settings = isRecord(settings) ? { ...settings } : {}
  const exceptions = readClassExceptions(base).filter((e) => e.userId !== input.userId)
  exceptions.push({
    userId: input.userId,
    grantedBy: input.grantedBy,
    grantedAt: (input.now ?? new Date()).toISOString(),
    via: input.via,
    levelAtGrant: input.levelAtGrant,
  })
  base[CLASS_EXCEPTIONS_KEY] = exceptions.slice(-MAX_CLASS_EXCEPTIONS)
  base[CLASS_REQUESTS_KEY] = readClassJoinRequests(base).filter((r) => r.userId !== input.userId)
  return base
}

export function withoutClassException(settings: unknown, userId: string): Settings {
  const base: Settings = isRecord(settings) ? { ...settings } : {}
  base[CLASS_EXCEPTIONS_KEY] = readClassExceptions(base).filter((e) => e.userId !== userId)
  return base
}

/**
 * Settings with a pending request from `userId`. Idempotent: a repeat request
 * keeps the original timestamp, so asking twice does not jump the queue.
 */
export function withClassJoinRequest(
  settings: unknown,
  input: { userId: string; levelAtRequest: number | null; now?: Date },
): Settings {
  const base: Settings = isRecord(settings) ? { ...settings } : {}
  const requests = readClassJoinRequests(base)
  if (!requests.some((r) => r.userId === input.userId)) {
    requests.push({
      userId: input.userId,
      requestedAt: (input.now ?? new Date()).toISOString(),
      levelAtRequest: input.levelAtRequest,
    })
  }
  base[CLASS_REQUESTS_KEY] = requests.slice(-MAX_CLASS_REQUESTS)
  return base
}

export function withoutClassJoinRequest(settings: unknown, userId: string): Settings {
  const base: Settings = isRecord(settings) ? { ...settings } : {}
  base[CLASS_REQUESTS_KEY] = readClassJoinRequests(base).filter((r) => r.userId !== userId)
  return base
}

/** The message a blocked manager sees, in one place so every join path says the same thing. */
export function classBlockedMessage(range: Pick<ClassRange, 'min' | 'max'>, userLevel: number): string {
  return `This league is for managers at Level ${range.min}–${range.max}, and you are Level ${clampLevel(userLevel)}. You can ask the commissioner to let you in.`
}
