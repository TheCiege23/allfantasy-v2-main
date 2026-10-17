import { keyPositionForSport } from './constants'
import { allowedPositionsForSlot, normalizeToken } from '@/lib/redraft/lineupValidation'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

export type ExileRosterPlayer = { id: string; name: string; position: string; team: string; slot: string }
export type ExileWeeklyRoster = {
  version: 1; anchorId: string | null; team: string | null; players: ExileRosterPlayer[];
  closedAt: string | null; lockedAt: string | null
}
/** Chimmy's team in the weekly Exile contest; see exileBoss.ts. */
export const EXILE_BOSS_USER_ID = 'survivor-exile-boss'

export const emptyExileRoster = (): ExileWeeklyRoster => ({ version: 1, anchorId: null, team: null, players: [], closedAt: null, lockedAt: null })

/** Only the server writes this envelope; legacy free-form submissions are never scored as rosters. */
export function readExileRoster(value: unknown): ExileWeeklyRoster | null {
  if (!value || typeof value !== 'object') return null
  const row = value as ExileWeeklyRoster
  if (row.version !== 1 || !Array.isArray(row.players)) return null
  if (!row.players.every(p => p && ['id', 'name', 'position', 'team', 'slot'].every(k => typeof p[k as keyof ExileRosterPlayer] === 'string'))) return null
  return row
}

export function isExileAnchor(sport: string, position: string): boolean {
  return position.toUpperCase().split(/[\s,;/|-]+/).includes(keyPositionForSport(sport).code)
}

/** Shared pure rules, applied while the league transaction lock is held. */
export function addExilePlayer(roster: ExileWeeklyRoster, player: Omit<ExileRosterPlayer, 'slot'>,
  sport: string, settings: unknown, takenTeams: string[], requestedSlot?: string): ExileWeeklyRoster {
  if (roster.closedAt) throw new Error('This Exile period has ended.')
  if (roster.players.some(p => p.id === player.id)) throw new Error('That player is already on your Exile roster.')
  const anchor = isExileAnchor(sport, player.position)
  if (!roster.anchorId && !anchor) throw new Error(`Claim a ${keyPositionForSport(sport).label} first to reserve a team.`)
  if (roster.anchorId && roster.team !== player.team) throw new Error('Drop your anchor and release its roster before choosing a different team.')
  if (takenTeams.includes(player.team)) throw new Error('Another Exile manager has reserved this team.')
  const config = resolveRedraftRosterConfig(sport, settings)
  const capacities = new Map(config.starterCapacities)
  if (config.benchSlots) capacities.set('BENCH', config.benchSlots)
  const fits = (slot: string) => slot === 'BENCH' || player.position.toUpperCase().split(/[\s,;/|-]+/).some(pos => allowedPositionsForSlot(sport, slot).includes(pos))
  const available = (slot: string) => (capacities.get(slot) ?? 0) > roster.players.filter(p => p.slot === slot).length && fits(slot)
  const slot = requestedSlot ? normalizeToken(requestedSlot) : [...capacities.keys()].find(available)
  if (!slot || !available(slot)) throw new Error('Choose an eligible roster slot with space available.')
  return { ...roster, anchorId: roster.anchorId ?? player.id, team: player.team, players: [...roster.players, { ...player, slot }] }
}

export function dropExilePlayer(roster: ExileWeeklyRoster, playerId: string): ExileWeeklyRoster {
  if (roster.closedAt) throw new Error('This Exile period has ended.')
  if (!roster.players.some(p => p.id === playerId)) throw new Error('Player is not on your Exile roster.')
  // Team rights cannot outlive the anchor. All teammates must be released before switching.
  return roster.anchorId === playerId ? emptyExileRoster() : { ...roster, players: roster.players.filter(p => p.id !== playerId) }
}
