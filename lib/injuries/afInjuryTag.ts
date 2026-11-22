/**
 * AF's short injury tag — "Q", "D", "DTD", "OUT", "IR" — and the tone it is drawn in.
 *
 * ONE implementation for /core's Matchup (components/core-app/screens/Matchup.tsx re-exports
 * `injuryTag` from here) and the league page's matchup and roster rows, so the two surfaces cannot
 * label the same player differently.
 */

/**
 * The injury feed's word for a status, shortened the way every fantasy app prints it. Anything
 * unrecognised keeps its first word rather than being dropped ("Suspended indefinitely" → "SUSP").
 */
export function injuryTag(status: string): string {
  const s = status.trim().toLowerCase()
  if (s.startsWith('quest')) return 'Q'
  if (s.startsWith('doubt')) return 'D'
  if (s.startsWith('prob')) return 'P'
  if (s.replace(/[^a-z]/g, '') === 'daytoday' || s === 'dtd') return 'DTD'
  if (s.startsWith('injured reserve')) return 'IR'
  return status.trim().split(/\s+/)[0].slice(0, 4).toUpperCase()
}

/**
 * `ok` = likely to play (P) · `warn` = a coin flip (Q, DTD) · `risk` = unlikely (D) · `out` = will not
 * play (OUT, IR, SUSP, PUP, NFI, …). An uncertainty is never drawn in the red of OUT.
 */
export type InjuryTone = 'ok' | 'warn' | 'risk' | 'out'

export function injuryTone(tag: string): InjuryTone {
  if (tag === 'P') return 'ok'
  if (tag === 'Q' || tag === 'DTD') return 'warn'
  if (tag === 'D') return 'risk'
  return 'out'
}
