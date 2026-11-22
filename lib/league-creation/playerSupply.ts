/**
 * Does a new league's draft fit the sport's players?
 *
 * The create form offers Redraft and Dynasty up to 250 teams in every sport. A college league that
 * size is real (the owner's run 140 and 180 teams). A pro league that size is not: a 250-team NFL
 * redraft league drafts 3,750 players and the NFL has 32 teams of them, so the draft runs dry long
 * before it ends. Found walking a 250-team NFL league, 2026-11-22; nothing refused it.
 *
 * THE CHECK. Teams x roster spots (the template league bootstrap installs, without IR, taxi or devy
 * slots) must not exceed the players the sport has to draft.
 *
 * THE SUPPLY is a static estimate per sport, never a provider call or a DB read, and is deliberately
 * generous so that a refusal is never a false one:
 *
 *   NFL   32 teams x (53 active + 16 practice squad) is about 2,200. Roughly half play offense or
 *         kick: 1,100. The defensive half counts only when the roster has IDP seats.
 *   NBA   30 teams x 18 (15 + three two-way contracts): 540.
 *   NHL   32 teams x 23, plus the regular call-ups: about 900.
 *   MLB   30 teams x the 40-man roster: 1,200.
 *
 * A DYNASTY roster also holds rookies, prospects and minor leaguers the active rosters do not, so its
 * supply is doubled. Best Ball's own estimate (`BEST_BALL_POSITION_POOL`) is not used here: it counts
 * who can START in a given week, which is right for filling lineups and far too small for a 25-man
 * dynasty roster (it refused a 32-team NFL dynasty league, a size the real league has).
 *
 * The result: a pro league tops out around 40 to 90 teams depending on sport and roster, instead of
 * 250. The owner's own pro leagues run 34 and 36 teams and pass.
 *
 * PRO SPORTS ONLY (NFL, NBA, NHL, MLB). College pools are many times larger (the owner's college
 * leagues run 140 and 180 teams), so college leagues are not checked.
 *
 * Pure: no DB, no clock. Safe in the wizard and in the server validator, so the two cannot disagree.
 */
import { newLeagueRosterSlots } from '@/lib/bestball/poolCapacity'

/** Draftable players per pro sport. `idp` is added only when the roster has defensive-player seats. */
export const PRO_PLAYER_SUPPLY: Readonly<Record<string, { base: number; idp?: number }>> = {
  NFL: { base: 1100, idp: 1100 },
  NBA: { base: 540 },
  NHL: { base: 900 },
  MLB: { base: 1200 },
}
/** A dynasty roster reaches into rookies, prospects and the minors. */
const DYNASTY_SUPPLY_FACTOR = 2
/** Slots that hold players a draft does not fill. */
const NOT_DRAFTED_SLOT = /^(IR|IL|INJ|NA|TAXI|DEVY|COLLEGE)/i
/** Exact tokens: an unanchored `DE` also matched the team-defense seat `DEF`, and `S` the superflex seat. */
const IDP_SLOT = /^(DL|LB|DB|DE|DT|CB|S|SS|FS|IDP|IDP_FLEX|IDPFLEX)$/i

const SPORT_WORDS: Record<string, string> = { NFL: 'the NFL', NBA: 'the NBA', NHL: 'the NHL', MLB: 'MLB' }

export type PlayerSupplyCheck = {
  /** False when nothing could be checked (a college sport, no template, no pool): nothing is refused. */
  verified: boolean
  ok: boolean
  rosterSpots: number
  needed: number
  pool: number
  /** The largest league this roster fits. */
  maxTeams: number
  message: string | null
}

const UNVERIFIED: PlayerSupplyCheck = { verified: false, ok: true, rosterSpots: 0, needed: 0, pool: 0, maxTeams: 0, message: null }

export function checkNewLeaguePlayerSupply(input: { sport: string; leagueType: string; teamCount: number }): PlayerSupplyCheck {
  const sport = String(input.sport ?? '').trim().toUpperCase()
  const supply = PRO_PLAYER_SUPPLY[sport]
  if (!supply || !(input.teamCount > 0)) return UNVERIFIED
  const slots = newLeagueRosterSlots(sport, input.leagueType)
  if (!slots) return UNVERIFIED
  let rosterSpots = 0
  let hasIdp = false
  for (const [slot, count] of Object.entries(slots)) {
    const seats = Number(count)
    if (!(seats > 0) || NOT_DRAFTED_SLOT.test(slot)) continue
    rosterSpots += seats
    if (sport === 'NFL' && IDP_SLOT.test(slot)) hasIdp = true
  }
  const pool = (supply.base + (hasIdp ? supply.idp ?? 0 : 0)) * (String(input.leagueType).toLowerCase() === 'dynasty' ? DYNASTY_SUPPLY_FACTOR : 1)
  if (rosterSpots === 0 || pool === 0) return UNVERIFIED
  const needed = input.teamCount * rosterSpots
  const maxTeams = Math.floor(pool / rosterSpots)
  const ok = needed <= pool
  return {
    verified: true,
    ok,
    rosterSpots,
    needed,
    pool,
    maxTeams,
    message: ok
      ? null
      : `A ${input.teamCount}-team league drafts ${needed.toLocaleString('en-US')} players, and ${SPORT_WORDS[sport]} has about ${pool.toLocaleString('en-US')} to draft. The largest league this roster fits is ${maxTeams} teams.`,
  }
}
