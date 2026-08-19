export type AcquisitionGuardResult = { allowed: true } | { allowed: false; code: 'PLAYER_RECENTLY_ADDED' | 'ACQUISITION_TIME_UNAVAILABLE'; message: string }

export function evaluateRecentAcquisition(input: {
  acquiredAt: Date | null
  acquisitionType: string | null
  restrictionHours: number | null
  evaluatedAt: Date
}): AcquisitionGuardResult {
  if (!input.restrictionHours || input.restrictionHours <= 0) return { allowed: true }
  const kind = String(input.acquisitionType ?? '').toLowerCase()
  if (kind === 'import' || kind === 'imported' || kind === 'draft' || kind === 'drafted') return { allowed: true }
  if (!input.acquiredAt) return { allowed: false, code: 'ACQUISITION_TIME_UNAVAILABLE', message: 'Authoritative acquisition time is unavailable.' }
  const ageMs = input.evaluatedAt.getTime() - input.acquiredAt.getTime()
  if (ageMs < input.restrictionHours * 3_600_000) return { allowed: false, code: 'PLAYER_RECENTLY_ADDED', message: `Player was acquired inside the persisted ${input.restrictionHours}-hour trade restriction.` }
  return { allowed: true }
}
