/** Settings-panel overrides precede the saved league choice, then the sport default. */
export function resolveConfiguredPlayoffSeedingRule(league: { settings?: unknown; playoffSeedingRule?: string | null }, fallback = 'standard_standings'): string {
  const settings = asRecord(league.settings)
  const structure = asRecord(settings.playoff_structure)
  for (const value of [structure.seeding_rules, settings.seeding_rules, league.playoffSeedingRule]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

export function isPointsOnlySeeding(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().replace(/[-\s]+/g, '_') === 'points_only'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
