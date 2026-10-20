/** Free-text tribe names (owner's call, 2026-10-20): what a commissioner may rename a tribe to. */

export const SURVIVOR_TRIBE_NAME_MIN = 2
export const SURVIVOR_TRIBE_NAME_MAX = 32

export type SurvivorTribeNameResult = { ok: true; name: string } | { ok: false; error: string }

/** Trim, collapse inner whitespace, drop control characters, and bound the length. */
export function normalizeSurvivorTribeName(raw: unknown): SurvivorTribeNameResult {
  if (typeof raw !== 'string') return { ok: false, error: 'Give the tribe a name.' }
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (name.length < SURVIVOR_TRIBE_NAME_MIN) return { ok: false, error: `Tribe names need at least ${SURVIVOR_TRIBE_NAME_MIN} characters.` }
  if (name.length > SURVIVOR_TRIBE_NAME_MAX) return { ok: false, error: `Tribe names are at most ${SURVIVOR_TRIBE_NAME_MAX} characters.` }
  return { ok: true, name }
}
