/**
 * Commissioner exceptions to the division gate, and the requests that lead to them — pure helpers
 * over `League.settings` (ADR F2.10a rule 6: "a commissioner may invite or accept a player outside
 * the band; that join is allowed and flagged, not blocked").
 *
 * Ported from PR #1753's `managerClass.ts` (owner ruling, 2026-10-01). The storage shape is #1753's;
 * what changed is what is RECORDED beside each entry — the manager's Class division at the time, not
 * their XP level, because the division is what the gate measured.
 *
 * ⚠ AN EXCEPTION NAMES ONE MANAGER. #1753 retired `bypassRankGate`, which sat on the league's SHARED
 * join code and so opened the door to everyone holding it; the same retirement stands here.
 */

/** `League.settings` keys. */
export const CLASS_EXCEPTIONS_KEY = 'classExceptions'
export const CLASS_REQUESTS_KEY = 'classJoinRequests'

/** Bounds the JSON so a flood of requests cannot grow `League.settings` without limit. */
export const MAX_CLASS_REQUESTS = 50
export const MAX_CLASS_EXCEPTIONS = 100

export type ClassException = {
  userId: string
  grantedBy: string
  grantedAt: string
  /** `direct` — the commissioner named the manager; `request` — approved their request. */
  via: 'direct' | 'request'
  /** The manager's Class division when it was granted, for the record; null when unrated. */
  divisionAtGrant: number | null
}

export type ClassJoinRequest = {
  userId: string
  requestedAt: string
  /** The manager's Class division when they asked; null when unrated. */
  divisionAtRequest: number | null
}

type Settings = Record<string, unknown>

const isRecord = (v: unknown): v is Settings => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const divisionOrNull = (v: unknown): number | null => {
  const n = Number(v)
  return v == null || !Number.isInteger(n) || n < 1 || n > 5 ? null : n
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
      divisionAtGrant: divisionOrNull(e.divisionAtGrant),
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
      divisionAtRequest: divisionOrNull(r.divisionAtRequest),
    })
  }
  return out
}

export function hasClassException(settings: unknown, userId: string): boolean {
  return readClassExceptions(settings).some((e) => e.userId === userId)
}

/** Settings with `userId` granted an exception. A pending request from them is cleared — it is answered. */
export function withClassException(
  settings: unknown,
  input: { userId: string; grantedBy: string; via: ClassException['via']; divisionAtGrant: number | null; now?: Date },
): Settings {
  const base: Settings = isRecord(settings) ? { ...settings } : {}
  const exceptions = readClassExceptions(base).filter((e) => e.userId !== input.userId)
  exceptions.push({
    userId: input.userId,
    grantedBy: input.grantedBy,
    grantedAt: (input.now ?? new Date()).toISOString(),
    via: input.via,
    divisionAtGrant: input.divisionAtGrant,
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

/** Settings with a pending request from `userId`. Idempotent: asking twice keeps the first timestamp. */
export function withClassJoinRequest(
  settings: unknown,
  input: { userId: string; divisionAtRequest: number | null; now?: Date },
): Settings {
  const base: Settings = isRecord(settings) ? { ...settings } : {}
  const requests = readClassJoinRequests(base)
  if (!requests.some((r) => r.userId === input.userId)) {
    requests.push({
      userId: input.userId,
      requestedAt: (input.now ?? new Date()).toISOString(),
      divisionAtRequest: input.divisionAtRequest,
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
