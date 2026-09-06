import type { SuggestionPresence } from './playerSuggest'

/**
 * The chip on a suggestion row: where he is in YOUR leagues, in as few words
 * as the row has room for. Client-safe, pure.
 *
 * One fact per chip, in this order of usefulness: yours beats owned beats
 * free. A league whose rosters could not be read is not a "free" — it is left
 * out of the count, and when nothing else can be said the chip is absent
 * rather than "unchecked".
 */
export type SuggestionChip = { text: string; tone: 'accent' | 'warn' | 'good' }

export function suggestionChip(p: SuggestionPresence | null | undefined): SuggestionChip | null {
  if (!p) return null
  if (p.yours.length === 1) return { text: `yours in ${p.yours[0]}`, tone: 'accent' }
  if (p.yours.length > 1) return { text: `yours in ${p.yours.length} leagues`, tone: 'accent' }
  if (p.owned.length === 1) {
    const o = p.owned[0]
    return { text: o.ownerName ? `@${o.ownerName} has him in ${o.leagueName}` : `owned in ${o.leagueName}`, tone: 'warn' }
  }
  if (p.owned.length > 1) return { text: `owned in ${p.owned.length} of your leagues`, tone: 'warn' }
  if (p.free.length === 1) return { text: `free in ${p.free[0]}`, tone: 'good' }
  if (p.free.length > 1) return { text: `free in ${p.free.length} leagues`, tone: 'good' }
  return null
}
