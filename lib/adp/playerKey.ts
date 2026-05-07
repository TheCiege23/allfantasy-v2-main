/**
 * Single source of truth for AllFantasyAdpSnapshot.playerKey.
 *
 * The same helper MUST be used by:
 *   - the writer (lib/adp/computeAllFantasyAdp.buildPlayerKey)
 *   - the resolver (lib/draft-room/getResolvedDraftPoolForLeague — AI ADP overlay lookup)
 *   - the audit route (app/api/admin/player-pool-audit/route.ts)
 *
 * Production bug history:
 *   - The writer originally used a naive `name.trim().toLowerCase()`.
 *   - The resolver used `canonicalName` (strips dots/apostrophes/initials).
 *   - 100% of resolver lookups silently missed despite valid context-matched snapshots.
 *
 * Canonicalization rules:
 *   - Lowercase, trim, collapse whitespace.
 *   - Strip apostrophes (straight + curly), commas, and dots — so "T.J. Hockenson"
 *     and "TJ Hockenson" produce the same key, ditto "Ja'Marr"/"JaMarr".
 *   - Map full-form positions ("Wide Receiver") → short codes ("wr") so the join
 *     survives ingestion-source drift (thesportsdb writes full forms; sleeper/RI
 *     write short codes).
 */

export function normalizeAdpPlayerName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[''’`]/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const POSITION_MAP: Record<string, string> = {
  quarterback: 'qb',
  'running back': 'rb',
  'wide receiver': 'wr',
  'tight end': 'te',
  fullback: 'fb',
  kicker: 'k',
  punter: 'p',
  defense: 'dst',
  'defense/special teams': 'dst',
  'defensive back': 'db',
  'defensive end': 'de',
  'defensive tackle': 'dt',
  'defensive lineman': 'dl',
  linebacker: 'lb',
  cornerback: 'cb',
  safety: 's',
  'offensive tackle': 'ot',
  'offensive guard': 'og',
  center: 'c',
  'point guard': 'pg',
  'shooting guard': 'sg',
  'small forward': 'sf',
  'power forward': 'pf',
  forward: 'f',
  guard: 'g',
  goalkeeper: 'gk',
  defender: 'd',
  midfielder: 'mid',
  goalie: 'g',
  'left wing': 'lw',
  'right wing': 'rw',
}

export function normalizeAdpPosition(position: string | null | undefined): string {
  const raw = String(position ?? '').toLowerCase().trim()
  return POSITION_MAP[raw] ?? raw
}

/**
 * Object-arg form (user-facing).
 */
export function buildAllFantasyAdpPlayerKey(input: {
  name: string | null | undefined
  position: string | null | undefined
}): string {
  return `${normalizeAdpPlayerName(input.name)}|${normalizeAdpPosition(input.position)}`
}

/**
 * Positional form preserved for back-compat with the existing
 * `buildPlayerKey(name, position)` callers in the resolver and recompute writer.
 */
export function buildAllFantasyAdpPlayerKeyPositional(
  name: string | null | undefined,
  position: string | null | undefined,
): string {
  return buildAllFantasyAdpPlayerKey({ name, position })
}
