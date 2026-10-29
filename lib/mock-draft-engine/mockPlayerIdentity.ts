import { canonicalName } from '@/lib/draft-room/player-canonical-identity'

/** NBA feeds disagree about primary position (C/PF, PG/SG, etc.). A position
 * label must never turn one athlete into two draftable players. Keep suffixes
 * so similarly named relatives remain distinct. Other sports retain their
 * position-scoped identity until their provider contracts are reconciled. */
export function mockPlayerKey(sport: string, name: string, position: string): string {
  return sport.toUpperCase() === 'NBA' ? canonicalName(name)
    : `${name.trim().toLowerCase()}|${position.trim().toUpperCase()}`
}
