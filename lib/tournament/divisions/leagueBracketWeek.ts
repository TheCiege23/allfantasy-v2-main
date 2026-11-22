/**
 * What a conference league's matchup screen shows about the TOURNAMENT in a bracket week: the round,
 * and for each manager of this league still in the bracket, their bracket opponent and the game's
 * state. The league's own round-robin matchup is untouched — this is a read-only side panel.
 *
 * Built from the same `HubView` the tournament hub renders (./hubView, fed from Postgres by
 * ./divisionsStore), so the two can never disagree. Pure — no I/O.
 */
import type { HubEntrant, HubGame, HubView } from './hubView'

export type LeagueBracketEntry = {
  teamId: string
  name: string
  seedLine: number
  region: string
  isMe: boolean
  opponent: { name: string; seedLine: number; region: string } | null
  score: number | null
  opponentScore: number | null
  result: 'won' | 'lost' | 'pending'
}

export type LeagueBracketWeek = {
  tournamentId: string
  tournamentName: string
  week: number
  round: number
  label: string
  kind: 'division' | 'championship'
  /** True while seeding is not committed: the pairings are a projection, not the bracket. */
  projected: boolean
  entries: LeagueBracketEntry[]
  /** Managers of this league placed in the tournament. */
  leagueTeams: number
  /**
   * The viewer's own standing this week, when they are an entrant in this league: in a game this
   * round, knocked out (lost a game, or never made the bracket), or still alive with the pairing not
   * set yet because an earlier round is undecided.
   */
  me: 'playing' | 'out' | 'waiting' | null
}

/** Division games of one round (or of every round with `all`). */
function divisionGames(view: HubView, round: number, all = false): Array<{ game: HubGame; projected: boolean }> {
  return view.divisions.flatMap(d => {
    const games = [...Object.values(d.regions).flatMap(rounds => (rounds ?? []).flat()), ...d.finals.flat()]
    return games.filter(g => all || g.round === round).map(game => ({ game, projected: !d.seedingCommitted }))
  })
}

function entryFor(side: HubEntrant, other: HubEntrant | null, game: HubGame, sideIsA: boolean): LeagueBracketEntry {
  return {
    teamId: side.id, name: side.name, seedLine: side.seedLine, region: side.region, isMe: side.isMe,
    opponent: other ? { name: other.name, seedLine: other.seedLine, region: other.region } : null,
    score: sideIsA ? game.scoreA : game.scoreB,
    opponentScore: sideIsA ? game.scoreB : game.scoreA,
    result: game.winnerId == null ? 'pending' : game.winnerId === side.id ? 'won' : 'lost',
  }
}

/**
 * The bracket week for one conference league, or null when `week` is not a bracket week or the
 * bracket has not been drawn. `leagueTeamIds` are the tournament team ids whose league is this one.
 */
export function leagueBracketWeek(view: HubView, leagueTeamIds: ReadonlySet<string>, week: number): LeagueBracketWeek | null {
  const index = view.calendar.weeks.findIndex(w => w.week === week)
  if (index < 0) return null
  const slot = view.calendar.weeks[index]!
  const round = index + 1
  const games = slot.kind === 'championship'
    ? (view.championship ? [{ game: view.championship, projected: !(view.divisions[0].seedingCommitted && view.divisions[1].seedingCommitted) }] : [])
    : divisionGames(view, round)
  if (!view.divisions.some(d => d.seeded)) return null

  const entries: LeagueBracketEntry[] = []
  const projected = games.length ? games.every(g => g.projected) : !view.divisions.every(d => d.seedingCommitted)
  for (const { game } of games) {
    if (game.a && leagueTeamIds.has(game.a.id)) entries.push(entryFor(game.a, game.b, game, true))
    if (game.b && leagueTeamIds.has(game.b.id)) entries.push(entryFor(game.b, game.a, game, false))
  }
  entries.sort((x, y) => Number(y.isMe) - Number(x.isMe) || x.seedLine - y.seedLine || x.name.localeCompare(y.name))
  const meId = view.me && leagueTeamIds.has(view.me.teamId) ? view.me.teamId : null
  return {
    tournamentId: view.tournament.id, tournamentName: view.tournament.name,
    week, round, label: slot.label, kind: slot.kind === 'championship' ? 'championship' : 'division', projected, entries,
    leagueTeams: leagueTeamIds.size,
    me: meId ? myStatus(view, meId, entries) : null,
  }
}

function myStatus(view: HubView, meId: string, entries: LeagueBracketEntry[]): 'playing' | 'out' | 'waiting' {
  if (entries.some(e => e.teamId === meId)) return 'playing'
  const every = [...divisionGames(view, 0, true), ...(view.championship ? [{ game: view.championship, projected: false }] : [])].map(g => g.game)
  const mine = every.filter(g => g.a?.id === meId || g.b?.id === meId)
  if (!mine.length) return 'out'
  if (mine.some(g => g.winnerId != null && g.winnerId !== meId)) return 'out'
  return 'waiting'
}
