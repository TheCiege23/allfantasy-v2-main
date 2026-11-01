import { keyPositionForSport } from './constants'
import { allowedPositionsForSlot, normalizeToken } from '@/lib/redraft/lineupValidation'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { readSurvivorSideGameSettings } from './survivorSideGameSettings'
import { exileSlotCapacities } from './survivorSideGameRules'

export type ExileRosterPlayer = { id: string; name: string; position: string; team: string; slot: string }
export type ExileWeeklyRoster = {
  version: 1; anchorId: string | null; team: string | null; players: ExileRosterPlayer[];
  closedAt: string | null; lockedAt: string | null
  /** Bid mode: the team this manager WON in the sealed bidding (reserved before any player is claimed). */
  awardedTeam?: string | null
}
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
  const code = keyPositionForSport(sport).code
  // An MLB anchor is any pitcher, however the feed labels the role.
  const codes = sport.toUpperCase() === 'MLB' ? [code, 'SP', 'RP'] : [code]
  return position.toUpperCase().split(/[\s,;/|-]+/).some(pos => codes.includes(pos))
}

/**
 * The Exile starting slots and bench: the commissioner's own list when set
 * (`League.settings.survivorSideGames.exileLineupSlots`, e.g. QB RB WR TE W/R/T), otherwise the main
 * league's roster config — today's behaviour.
 */
export function exileSlotConfig(sport: string, settings: unknown): { starterCapacities: Map<string, number>; benchSlots: number } {
  const own = readSurvivorSideGameSettings(settings)
  if (own.exileLineupSlots.length) return { starterCapacities: exileSlotCapacities(own.exileLineupSlots), benchSlots: own.exileBenchSlots }
  const config = resolveRedraftRosterConfig(sport, settings)
  return { starterCapacities: new Map(config.starterCapacities), benchSlots: config.benchSlots }
}

/** Shared pure rules, applied while the league transaction lock is held. */
export function addExilePlayer(roster: ExileWeeklyRoster, player: Omit<ExileRosterPlayer, 'slot'>,
  sport: string, settings: unknown, takenTeams: string[], requestedSlot?: string): ExileWeeklyRoster {
  if (roster.closedAt) throw new Error('This Exile period has ended.')
  if (roster.players.some(p => p.id === player.id)) throw new Error('That player is already on your Exile roster.')
  const anchor = isExileAnchor(sport, player.position)
  if (!roster.anchorId && !anchor) throw new Error(`Claim a ${keyPositionForSport(sport).label} first to reserve a team.`)
  if (roster.anchorId && roster.team !== player.team) throw new Error('Drop your anchor and release its roster before choosing a different team.')
  if (!roster.anchorId && roster.awardedTeam && roster.awardedTeam !== player.team) throw new Error(`You won ${roster.awardedTeam} in the bidding; claim players from that team.`)
  if (takenTeams.includes(player.team)) throw new Error('Another Exile manager has reserved this team.')
  const config = exileSlotConfig(sport, settings)
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
  // Team rights cannot outlive the anchor. All teammates must be released before switching —
  // except a team WON in the bidding, which stays reserved for its winner for the period.
  if (roster.anchorId !== playerId) return { ...roster, players: roster.players.filter(p => p.id !== playerId) }
  return roster.awardedTeam ? { ...emptyExileRoster(), team: roster.awardedTeam, awardedTeam: roster.awardedTeam } : emptyExileRoster()
}
