import { buildSeasonLeagueLayout } from './seasonLeagueLayout'
import { buildSeasonBlueprint } from './seasonBlueprint'

export type OpeningEntrant = { id: string; userId: string; displayName: string; avatarUrl: string | null }
/** Fisher–Yates with an exclusive-upper-bound cryptographic draw supplied by the server. */
export function buildOpeningField(input: unknown, entrants: OpeningEntrant[], draw: (upper: number) => number) {
  const { config } = buildSeasonBlueprint(input)
  if (entrants.length !== config.participants) throw new Error('Exactly the published capacity must be registered before freezing.')
  if (new Set(entrants.map(e => e.id)).size !== entrants.length || new Set(entrants.map(e => e.userId)).size !== entrants.length) throw new Error('Duplicate tournament entries cannot be frozen.')
  const shuffled = [...entrants].sort((a, b) => a.id.localeCompare(b.id))
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = draw(i + 1)
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('Invalid shuffle draw.')
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  let offset = 0
  const leagues = buildSeasonLeagueLayout(config)[0]!.leagues.map(league => {
    const members = shuffled.slice(offset, offset + league.slots).map((entrant, index) => ({ ...entrant, draftSlot: index + 1, waiverPriority: league.slots - index }))
    offset += league.slots
    return { key: league.key, name: league.name, division: league.division, slots: league.slots, members }
  })
  return { version: 1 as const, algorithm: 'crypto_fisher_yates_v1' as const, leagues }
}
