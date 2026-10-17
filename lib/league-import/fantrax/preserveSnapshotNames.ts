import type { FantraxPlayerRef } from './fantraxApi'

/** A current directory can omit old owned reserve IDs. Preserve their previously
 * imported names only; live rosters still decide membership, slots and status.
 * Do not infer a current school or a scoring identity from archived metadata.
 */
export function preserveSnapshotNames(directory: Record<string, FantraxPlayerRef>, roster: unknown): Record<string, FantraxPlayerRef> {
  const result = { ...directory }
  if (!Array.isArray(roster)) return result
  const candidates = new Map<string, FantraxPlayerRef>()
  const conflicts = new Set<string>()
  for (const value of roster) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    const id = typeof row.fantraxId === 'string' ? row.fantraxId : ''
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!id || result[id] || !name || name === id) continue
    const position = typeof row.primaryPosition === 'string' ? row.primaryPosition : ''
    const previous = candidates.get(id)
    if (previous && (previous.name !== name || previous.position !== position)) conflicts.add(id)
    candidates.set(id, { fantraxId: id, name, position, team: '' })
  }
  for (const [id, ref] of candidates) if (!conflicts.has(id)) result[id] = ref
  return result
}
