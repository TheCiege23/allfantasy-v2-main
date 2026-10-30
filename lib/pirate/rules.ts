export type PirateRules = {
  protectionLimit: number
  claimHours: number
  selectionHours: number
  overflowGraceHours: number
  playoffClaims: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback
}

export function isPirateLeague(league: { leagueType?: string | null; leagueVariant?: string | null }): boolean {
  return league.leagueType?.toLowerCase() === 'pirate' || league.leagueVariant?.toLowerCase() === 'pirate'
}

export function readPirateRules(settings: unknown): PirateRules {
  const root = record(settings)
  const rules = record(record(record(root.conceptRules).extensions).pirate)
  const setup = record(record(root.conceptSetup).pirate)
  const direct = record(root.pirate)
  const merged = { ...direct, ...setup, ...rules }
  return {
    protectionLimit: boundedInteger(merged.protectionLimit, 3, 1, 10),
    claimHours: boundedInteger(merged.claimHours, 24, 1, 72),
    selectionHours: boundedInteger(merged.selectionHours, 24, 1, 72),
    overflowGraceHours: boundedInteger(merged.overflowGraceHours, 24, 0, 72),
    playoffClaims: merged.playoffClaims === true,
  }
}

export function protectedIds(set: { status: string; playerIds: unknown } | null | undefined): string[] {
  if (!set || set.status !== 'active' || !Array.isArray(set.playerIds)) return []
  return set.playerIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export function isProtectionLocked(lockAt: Date | null, now = new Date()): boolean {
  // Missing schedule evidence never means the manager may edit indefinitely.
  return !lockAt || now.getTime() >= lockAt.getTime()
}
