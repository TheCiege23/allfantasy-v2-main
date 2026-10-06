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

/**
 * The one fact a chip states, before it is put into words — so the English below and the Spanish in
 * finderSearchCopy.ts (`suggestionChipText`) read the same rule, never two copies of the order.
 */
export type SuggestionFact =
  | { kind: 'yours'; league: string }
  | { kind: 'yoursCount'; n: number }
  | { kind: 'ownedBy'; owner: string; league: string }
  | { kind: 'owned'; league: string }
  | { kind: 'ownedCount'; n: number }
  | { kind: 'free'; league: string }
  | { kind: 'freeCount'; n: number }

export function suggestionFact(p: SuggestionPresence | null | undefined): SuggestionFact | null {
  if (!p) return null
  if (p.yours.length === 1) return { kind: 'yours', league: p.yours[0] }
  if (p.yours.length > 1) return { kind: 'yoursCount', n: p.yours.length }
  if (p.owned.length === 1) {
    const o = p.owned[0]
    return o.ownerName ? { kind: 'ownedBy', owner: o.ownerName, league: o.leagueName } : { kind: 'owned', league: o.leagueName }
  }
  if (p.owned.length > 1) return { kind: 'ownedCount', n: p.owned.length }
  if (p.free.length === 1) return { kind: 'free', league: p.free[0] }
  if (p.free.length > 1) return { kind: 'freeCount', n: p.free.length }
  return null
}

export function suggestionTone(fact: SuggestionFact): SuggestionChip['tone'] {
  if (fact.kind === 'yours' || fact.kind === 'yoursCount') return 'accent'
  if (fact.kind === 'free' || fact.kind === 'freeCount') return 'good'
  return 'warn'
}

function englishText(f: SuggestionFact): string {
  switch (f.kind) {
    case 'yours':
      return `yours in ${f.league}`
    case 'yoursCount':
      return `yours in ${f.n} leagues`
    case 'ownedBy':
      return `@${f.owner} has him in ${f.league}`
    case 'owned':
      return `owned in ${f.league}`
    case 'ownedCount':
      return `owned in ${f.n} of your leagues`
    case 'free':
      return `free in ${f.league}`
    case 'freeCount':
      return `free in ${f.n} leagues`
  }
}

export function suggestionChip(p: SuggestionPresence | null | undefined): SuggestionChip | null {
  const fact = suggestionFact(p)
  return fact ? { text: englishText(fact), tone: suggestionTone(fact) } : null
}
