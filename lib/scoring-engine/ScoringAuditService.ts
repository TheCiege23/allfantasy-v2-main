/**
 * lib/scoring-engine/ScoringAuditService.ts
 * Audit trail, versioning, and config diff for the scoring engine.
 *
 * Audit entries are stored as a JSON array inside
 *   league.settings.[sport]_scoring_config.auditLog
 *
 * The audit log is append-only and capped at MAX_AUDIT_ENTRIES to
 * prevent unbounded JSONB growth.
 */

import { prisma } from '../prisma'
import { toPrismaJsonInput } from '../prisma-json'
import type { ScoringAuditEntry, ScoringConfigDiff, SupportedSport } from './ScoringEngineTypes'

const MAX_AUDIT_ENTRIES = 50
const SPORT_CONFIG_KEY: Record<SupportedSport, string> = {
  NFL:    'nfl_scoring_config',
  NCAAF:  'ncaaf_scoring_config',
  NBA:    'nba_scoring_config',
  NCAAB:  'ncaab_scoring_config',
  MLB:    'mlb_scoring_config',
  NHL:    'nhl_scoring_config',
  SOCCER: 'soccer_scoring_config',
}

// ---------------------------------------------------------------------------
// Read audit log
// ---------------------------------------------------------------------------

export async function getScoringAuditLog(
  leagueId: string,
  sport: SupportedSport,
): Promise<ScoringAuditEntry[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league?.settings) return []
  const settings = league.settings as Record<string, unknown>
  const config = settings[SPORT_CONFIG_KEY[sport]] as
    | Record<string, unknown>
    | undefined
  if (!config?.auditLog) return []
  return Array.isArray(config.auditLog)
    ? (config.auditLog as ScoringAuditEntry[])
    : []
}

// ---------------------------------------------------------------------------
// Append audit entry
// ---------------------------------------------------------------------------

export async function appendScoringAuditEntry(
  leagueId: string,
  sport: SupportedSport,
  entry: ScoringAuditEntry,
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  const key = SPORT_CONFIG_KEY[sport]
  const config = (settings[key] as Record<string, unknown>) ?? {}
  const existing: ScoringAuditEntry[] = Array.isArray(config.auditLog)
    ? (config.auditLog as ScoringAuditEntry[])
    : []
  const updated = [...existing, entry].slice(-MAX_AUDIT_ENTRIES)
  const version = typeof config.version === 'number' ? config.version + 1 : 1

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: toPrismaJsonInput({
        ...settings,
        [key]: { ...config, auditLog: updated, version },
      }),
    },
  })
}

// ---------------------------------------------------------------------------
// Config diff helper
// ---------------------------------------------------------------------------

/**
 * Compare two scoring configs and return which keys changed and by how much.
 * Used before saving to decide whether to bump version / write audit entry.
 */
export function diffScoringConfigs(
  sport: SupportedSport,
  previousRules: Record<string, number>,
  newRules: Record<string, number>,
  previousPreset?: string,
  newPreset?: string,
): ScoringConfigDiff {
  const allKeys = new Set([
    ...Object.keys(previousRules),
    ...Object.keys(newRules),
  ])
  const changes: Record<string, { from: number; to: number }> = {}

  for (const key of allKeys) {
    const from = previousRules[key] ?? 0
    const to   = newRules[key]      ?? 0
    if (Math.abs(from - to) > 0.0001) {
      changes[key] = { from, to }
    }
  }

  return {
    sport,
    changedKeys: Object.keys(changes),
    changes,
    presetChanged: previousPreset !== newPreset,
    previousPreset,
    newPreset,
  }
}

/**
 * Compare current league config against a named preset.
 * Returns true if the config exactly matches the preset.
 */
export function configMatchesPreset(
  currentRules: Record<string, number>,
  presetRules: Record<string, number>,
): boolean {
  const keys = new Set([
    ...Object.keys(currentRules),
    ...Object.keys(presetRules),
  ])
  for (const key of keys) {
    const current = currentRules[key] ?? 0
    const preset  = presetRules[key]  ?? 0
    if (Math.abs(current - preset) > 0.0001) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

export async function getScoringConfigVersion(
  leagueId: string,
  sport: SupportedSport,
): Promise<number> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league?.settings) return 0
  const settings = league.settings as Record<string, unknown>
  const config = settings[SPORT_CONFIG_KEY[sport]] as
    | Record<string, unknown>
    | undefined
  return typeof config?.version === 'number' ? config.version : 0
}
