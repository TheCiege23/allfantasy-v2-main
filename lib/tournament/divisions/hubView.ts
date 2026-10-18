/**
 * Everything the divisions screens show, computed once on the server.
 *
 * The screens (standings, wildcard, bracket, championship, phone) render this and
 * never sort or seed on their own. Both the DB loader (`divisionsStore.ts`) and the
 * dev preview feed it the same shape, so the preview exercises the real path.
 */
import {
  championshipGame, computeDivision, divisionsCalendar, regionGames, REGIONS,
  type BidStatus, type BracketGame, type DivisionTeamInput, type FormatSettings, type GameScores, type Region, type TieReason,
} from './engine'
import { crestFor, leagueDisplayName, type CrestArt, type DivisionIdentity } from './identity'

export type HubTeamInput = DivisionTeamInput & {
  divisionIndex: 0 | 1
  conferenceIndex: number
  userId?: string | null
  /** The app League this team plays in, when created. */
  leagueId?: string | null
}

export type HubRow = {
  id: string
  name: string
  conferenceIndex: number
  wins: number
  losses: number
  ties: number
  points: number
  rank: number
  tiebreak: TieReason | null
  status: BidStatus
  isMe: boolean
}

export type HubPoolRow = HubRow & { poolRank: number; divisionRank: number; via: 'bubble' | 'top_scorer'; in: boolean; toLine: number; poolTiebreak: TieReason | null }

export type HubGame = {
  round: number
  index: number
  a: HubEntrant | null
  b: HubEntrant | null
  scoreA: number | null
  scoreB: number | null
  winnerId: string | null
  decidedBy: BracketGame['decidedBy']
}
export type HubEntrant = { id: string; name: string; seedLine: number; region: Region; conferenceIndex: number; isMe: boolean }

export type HubDivision = {
  index: 0 | 1
  name: string
  sideId: string
  emblem: string
  teamCount: number
  rows: HubRow[]
  pool: { rows: HubPoolRow[]; lineToBeat: number | null; spots: number }
  conferences: Array<{ conferenceIndex: number; leagueName: string; crest: CrestArt; points: number; teams: number; inBracket: number }>
  seeded: boolean
  /** Region → rounds of games (only when the field is full enough to seed). */
  regions: Partial<Record<Region, HubGame[][]>>
  /** Final four semis and the division final. */
  finals: HubGame[][]
  champion: HubEntrant | null
  reviewTies: string[]
}

export type HubView = {
  tournament: { id: string; name: string; sport: 'NFL' | 'NBA'; status: string; season: number | null }
  settings: FormatSettings
  calendar: ReturnType<typeof divisionsCalendar>
  identity: DivisionIdentity
  weeksPlayed: number
  divisions: [HubDivision, HubDivision]
  championship: HubGame | null
  me: { divisionIndex: 0 | 1; teamId: string; conferenceIndex: number; leagueId: string | null } | null
  /** True when the data is the invented preview field. */
  sample: boolean
}

const toEntrant = (meId: string | null, conferenceIndexById: Map<string, number>) => (e: BracketGame['a']): HubEntrant | null =>
  e ? { id: e.id, name: e.name, seedLine: e.seedLine, region: e.region, conferenceIndex: conferenceIndexById.get(e.id) ?? 0, isMe: e.id === meId } : null

export function buildHubView(input: {
  tournament: HubView['tournament']
  settings: FormatSettings
  identity: DivisionIdentity
  teams: HubTeamInput[]
  meUserId?: string | null
  /** Explicit "you" for the preview, which has no user ids. */
  meTeamId?: string | null
  scores?: [GameScores, GameScores]
  championshipScore?: { a: number; b: number }
  sample?: boolean
}): HubView {
  const { identity, settings } = input
  const meTeam = input.teams.find(t => (input.meTeamId && t.id === input.meTeamId) || (input.meUserId && t.userId === input.meUserId)) ?? null
  const meId = meTeam?.id ?? null
  const conferenceIndexById = new Map(input.teams.map(t => [t.id, t.conferenceIndex]))
  const entrant = toEntrant(meId, conferenceIndexById)
  const mapGame = (g: BracketGame): HubGame => ({ round: g.round, index: g.index, a: entrant(g.a), b: entrant(g.b), scoreA: g.scoreA, scoreB: g.scoreB, winnerId: g.winner?.id ?? null, decidedBy: g.decidedBy })
  const championsRaw: Array<BracketGame['winner']> = []

  const divisions = ([0, 1] as const).map((index): HubDivision => {
    const def = identity.divisions[index]
    const teams = input.teams.filter(t => t.divisionIndex === index)
    const result = computeDivision(teams, settings, input.scores?.[index] ?? {})
    const byId = new Map(teams.map(t => [t.id, t]))
    const row = (t: { id: string; name: string; wins: number; losses: number; ties?: number; points: number; rank: number; tiebreak: TieReason | null }): HubRow => ({
      id: t.id, name: t.name, conferenceIndex: byId.get(t.id)!.conferenceIndex, wins: t.wins, losses: t.losses, ties: t.ties ?? 0,
      points: t.points, rank: t.rank, tiebreak: t.tiebreak, status: result.status[t.id]!, isMe: t.id === meId,
    })
    const totals = new Map(result.conferences.map(c => [c.conferenceId, c]))
    const conferenceIdByIndex = new Map(teams.map(t => [t.conferenceIndex, t.conferenceId]))
    const rounds = result.bracket
    const regionRounds = rounds ? Object.fromEntries(REGIONS.map(r => [r, regionGames(rounds, r).map(gs => gs.map(mapGame))])) : {}
    const regionCount = rounds ? Math.log2(rounds[0]!.length * 2) - 2 : 0
    const finals = rounds ? rounds.slice(regionCount).map(gs => gs.map(mapGame)) : []
    const finalGame = rounds?.at(-1)?.[0]
    championsRaw.push(finalGame?.winner ?? null)
    return {
      index, name: def.name, sideId: def.sideId, emblem: def.emblem, teamCount: teams.length,
      rows: result.ranked.map(row),
      pool: {
        rows: result.pool.entries.map(e => ({ ...row(e), poolRank: e.poolRank, divisionRank: e.divisionRank, via: e.via, in: e.in, toLine: e.toLine, poolTiebreak: e.poolTiebreak })).sort((a, b) => a.poolRank - b.poolRank),
        lineToBeat: result.pool.lineToBeat, spots: result.pool.spots,
      },
      conferences: identity.conferences.map((conf, ci) => {
        const t = totals.get(conferenceIdByIndex.get(ci) ?? '')
        return { conferenceIndex: ci, leagueName: leagueDisplayName(conf.name, def.name), crest: crestFor(def, conf), points: t?.points ?? 0, teams: t?.teams ?? 0, inBracket: t?.inBracket ?? 0 }
      }),
      seeded: Boolean(result.seeded),
      regions: regionRounds,
      finals,
      champion: entrant(finalGame?.winner ?? null),
      reviewTies: result.reviewTies,
    }
  }) as [HubDivision, HubDivision]

  const [ca, cb] = championsRaw
  const champ = divisions[0].seeded && divisions[1].seeded ? mapGame(championshipGame(ca ?? null, cb ?? null, input.championshipScore)) : null
  return {
    tournament: input.tournament, settings, calendar: divisionsCalendar(settings), identity,
    weeksPlayed: Math.max(0, ...input.teams.map(t => t.wins + t.losses + (t.ties ?? 0))),
    divisions, championship: champ,
    me: meTeam ? { divisionIndex: meTeam.divisionIndex, teamId: meTeam.id, conferenceIndex: meTeam.conferenceIndex, leagueId: meTeam.leagueId ?? null } : null,
    sample: Boolean(input.sample),
  }
}
