import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import aliases from './reviewedNba2025Aliases.json'

type ReviewedAlias = {
  canonicalRiId: string
  canonicalName: string
  sourceNames: string[]
  /** Present when only one game corroborated the identity. */
  gameId?: string
}

const reviewed: Record<string, ReviewedAlias> = aliases
// NBA game 0022300232 records Miller's 1:56, three rebounds and one foul.
const miller: ReviewedAlias = {
  canonicalRiId: '1557',
  canonicalName: 'Leonard Miller',
  sourceNames: ['Leonard-DUP Miller-DUP'],
  gameId: '20231122-17-1',
}

/** IDs are scoped to the 2025–26 RI live box feed. Each name was corroborated by
 * an official NBA line in the same matchup and by the current canonical registry. */
export function reviewedNbaBoxAlias(
  season: number,
  sourceId: string | null,
  sourceName: unknown,
  gameId: string | null,
): ReviewedAlias | undefined {
  if (!sourceId || typeof sourceName !== 'string' || !gameId) return
  const alias = season === 2023 && sourceId === '1592' ? miller
    : season === 2025 && Object.hasOwn(reviewed, sourceId) ? reviewed[sourceId] : undefined
  if (!alias?.sourceNames.includes(sourceName)) return
  if (alias.gameId && alias.gameId !== gameId) return
  return alias
}

export function reviewedNbaSourceIds(riId: string | null, name: string, season?: number): string[] {
  const candidates = [
    ...(!season || season === 2025 ? Object.entries(reviewed) : []),
    ...(!season || season === 2023 ? [['1592', miller] as const] : []),
  ]
  return candidates.filter(([, alias]) =>
    alias.canonicalRiId === riId && canonicalName(alias.canonicalName) === canonicalName(name)
  ).map(([id]) => id)
}
