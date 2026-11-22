import type { BestBallSportTemplate } from '@prisma/client'

type RosterPlayerLite = {
  position: string
  playerId?: string
}

type ValidationSeverity = 'warning' | 'info'

type ValidationWarning = {
  position: string
  issue: string
  severity: ValidationSeverity
}

type CriticalError = {
  position: string
  issue: string
}

type BestBallRosterValidationResult = {
  isValid: boolean
  warnings: ValidationWarning[]
  criticalErrors: CriticalError[]
}

/**
 * Depth / structure validation for best ball rosters (draft completion + roster changes).
 */
export function validateBestBallRoster(players: RosterPlayerLite[], template: BestBallSportTemplate): BestBallRosterValidationResult {
  const depth = template.depthRequirements as Record<string, number>
  const warnings: ValidationWarning[] = []
  const criticalErrors: CriticalError[] = []

  for (const pos of Object.keys(depth)) {
    const required = depth[pos] ?? 0
    if (required <= 0) continue
    const countAtPosition = players.filter((p) => p.position === pos || p.position.split('/').includes(pos)).length
    if (countAtPosition === 0) {
      criticalErrors.push({
        position: pos,
        issue: `No ${pos} on roster — cannot field valid lineup`,
      })
    } else if (countAtPosition < required) {
      warnings.push({
        position: pos,
        issue: `Only ${countAtPosition} ${pos}s — fragile if injuries`,
        severity: 'warning',
      })
    } else if (countAtPosition > required * 2) {
      warnings.push({
        position: pos,
        issue: `Overbuilt at ${pos} — ${countAtPosition} players`,
        severity: 'info',
      })
    }
  }

  const isValid = criticalErrors.length === 0
  return {
    isValid,
    warnings,
    criticalErrors,
  }
}
