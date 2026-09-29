import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadLeagueValueMap } from './playerDepth'
import {
  callerTradeSeat,
  readLeagueTradeRows,
  readTradePlayerRows,
  rosterSlotsOf,
  teamForTradeRoster,
  tradeRosterPlayerIds,
} from './playerTradeVisual'
import { normalizePosition } from './positionNormalization'
import { rosterIdSpaceOf } from './rosterIdSpace'
import {
  PRICED_SHARE_MIN,
  SELL_LEAGUE_CAP,
  SKILL_POSITIONS,
  pricedShare,
  rankWhoStartsHim,
  type SellLeague,
  type SellRoster,
  type WhoStartsHim,
} from './whoStartsHim'

/**
 * Loader for "Who'd start him" (whoStartsHim.ts has the rule). AF Pro (`player_depth`): it is a
 * trade move, the same footing as the FAAB bid — a locked viewer gets the lock and nothing is read.
 *
 * DB-first, and the SAME reads every trade surface starts from (playerTradeVisual.ts): the league's
 * rosters and teams, names and positions by Sleeper id, and the finder's own per-league market value.
 *
 * 🛑 ONLY SLEEPER-ID-SPACE LEAGUES ARE READ. `readLeagueTradeRows` strips foreign rosters to nothing
 * and passes ESPN rosters through UNTRANSLATED — ESPN ids, looked up as Sleeper ids. Either way the
 * other teams would read as empty, and an empty team "starts" anyone. Such a league is named as
 * unread instead.
 */

type YourLeague = { leagueId: string; leagueName: string; platform: string | null }

export async function loadWhoStartsHim(args: {
  userId: string
  sleeperId: string | null
  position: string | null
  /** Leagues where he is on YOUR roster, from the card's own league read. */
  yourLeagues: readonly YourLeague[]
  /** False for a viewer without AF Pro: nothing is computed. */
  include: boolean
}): Promise<WhoStartsHim | null> {
  const position = normalizePosition(args.position)
  if (!args.sleeperId || !(SKILL_POSITIONS as readonly string[]).includes(position) || args.yourLeagues.length === 0) return null
  if (!args.include) return { leagues: [], locked: true }

  const ordered = [...args.yourLeagues].sort((a, b) => a.leagueName.localeCompare(b.leagueName)).slice(0, SELL_LEAGUE_CAP)
  const leagues = await Promise.all(ordered.map((l) => oneLeague(l, args.userId, args.sleeperId!, position).catch(() => unmeasured(l, 'this league could not be read just now'))))
  return { leagues, locked: false }
}

function unread(l: YourLeague, note: string): SellLeague {
  return { leagueId: l.leagueId, leagueName: l.leagueName, state: 'unread', note, teams: [], otherTeams: 0 }
}
function unmeasured(l: YourLeague, note: string, otherTeams = 0): SellLeague {
  return { leagueId: l.leagueId, leagueName: l.leagueName, state: 'unmeasured', note, teams: [], otherTeams }
}

async function oneLeague(l: YourLeague, userId: string, sleeperId: string, position: string): Promise<SellLeague> {
  if (rosterIdSpaceOf(l.platform) !== 'sleeper') return unread(l, 'other teams’ rosters in this league use the platform’s own player ids, so we can’t read them yet')

  const [rows, league] = await Promise.all([
    readLeagueTradeRows(l.leagueId),
    prisma.league.findUnique({ where: { id: l.leagueId }, select: { settings: true } }).catch(() => null),
  ])
  const { myRoster } = callerTradeSeat(rows, userId)
  if (!myRoster) return unread(l, 'we couldn’t find your team in this league')
  const others = rows.rosters.filter((r) => r !== myRoster && r.platformUserId !== myRoster.platformUserId)
  if (others.length === 0) return unmeasured(l, 'no other teams are on file')

  const slots = rosterSlotsOf(league?.settings)
  if (!slots || slots.length === 0) return unmeasured(l, 'this league’s lineup is not on file', others.length)

  const ids = [...new Set([sleeperId, ...others.flatMap((r) => tradeRosterPlayerIds(r))])]
  const [byId, values] = await Promise.all([readTradePlayerRows(ids), loadLeagueValueMap(ids, [l.leagueId])])
  const priced = values.get(l.leagueId) ?? new Map()
  const himValue = priced.get(sleeperId)?.value ?? null
  if (himValue == null) return unmeasured(l, 'he has no market value in this league’s format', others.length)

  const sellRosters: SellRoster[] = others.map((r, i) => ({
    key: r.platformUserId || `roster-${i}`,
    teamName: teamForTradeRoster(rows.teams, r)?.teamName ?? 'Another team',
    players: tradeRosterPlayerIds(r).flatMap((id) => {
      const row = byId.get(id)
      if (!row) return []
      return [{ id, name: row.name, position: normalizePosition(row.position), value: priced.get(id)?.value ?? null }]
    }),
  }))

  if (pricedShare(sellRosters) < PRICED_SHARE_MIN) return unmeasured(l, 'too few players on the other rosters have a market value to compare', others.length)

  const { teams, unknownSlots } = rankWhoStartsHim({ him: { id: sleeperId, position, value: himValue }, others: sellRosters, slots })
  if (unknownSlots.length > 0) return unmeasured(l, `lineup slot${unknownSlots.length === 1 ? '' : 's'} ${unknownSlots.join(', ')} ${unknownSlots.length === 1 ? 'isn’t' : 'aren’t'} modelled`, others.length)
  return { leagueId: l.leagueId, leagueName: l.leagueName, state: 'ranked', note: null, teams, otherTeams: others.length }
}
