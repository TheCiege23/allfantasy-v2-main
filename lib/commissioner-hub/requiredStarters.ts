/**
 * How many starting slots a league's rules require.
 *
 * Moved out of `commissionerHubHealth.ts` unchanged, so the three places that count lineups share
 * ONE rule without importing that module's whole graph (Decision OS, NFL coverage) into the
 * recipe sender's cron:
 *   - `countMissedLineups` in `commissionerHubHealth.ts` (the headline health score);
 *   - the per-league cockpit's missing-lineups flag (`lib/core-app/commissionerHub.ts`);
 *   - the lineup-reminder recipe (`runCommissionerRecipesJob.ts`).
 *
 * 🛑 A STORED LINEUP HAS NO EMPTY-SLOT MARKER. Sleeper sends `"0"` for an empty starting slot, but
 * every importer drops it before storing (`SleeperRosterMapper` `starter_ids`), so an empty slot
 * survives only as a starters list SHORTER than this number. Measured on production 2026-09-17:
 * 0 of 4,027 stored rosters contain a `"0"`; 241 in-season Sleeper rosters are short.
 *
 * Pure: no Prisma.
 */

const RESERVE_SLOT_KEYS = new Set([
  'BN',
  'BE',
  'BENCH',
  'IR',
  'IR+',
  'IL',
  'IL+',
  'TAXI',
  'DEVY',
  'NA',
  'RESERVE',
  'MINORS',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function positiveInt(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

function normalizeSlotKey(key: string): string {
  return key.trim().replace(/\s+/g, '_').replace(/-/g, '_').toUpperCase()
}

function sumStarterSlots(raw: unknown): number {
  if (Array.isArray(raw)) {
    return raw.filter((slot) => {
      const key = normalizeSlotKey(String(slot))
      return key && !RESERVE_SLOT_KEYS.has(key)
    }).length
  }

  const obj = asRecord(raw)
  let total = 0
  for (const [key, value] of Object.entries(obj)) {
    const normalized = normalizeSlotKey(key)
    if (!normalized || RESERVE_SLOT_KEYS.has(normalized)) continue
    total += positiveInt(value)
  }
  return total
}

/** Starting slots the league's rules require; 0 when the rules can't be read. */
export function readRequiredStarterCount(league: { starters?: unknown; settings?: unknown }): number {
  const settings = asRecord(league.settings)
  const rosterTemplate = asRecord(settings.rosterTemplate)

  const candidates = [
    league.starters,
    settings.starters,
    settings.rosterPositions,
    settings.roster_positions,
    rosterTemplate.starters,
    rosterTemplate.positions,
    rosterTemplate.slots,
  ]

  for (const candidate of candidates) {
    const count = sumStarterSlots(candidate)
    if (count > 0) return count
  }

  return 0
}
