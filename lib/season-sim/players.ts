/**
 * The simulated player universe and its weekly stat lines.
 *
 * Stats are SYNTHETIC and seeded: each player has a hidden weekly talent, injuries arrive at random and
 * last a few weeks, and every NFL team has one bye. Stat keys are the raw NFL keys the canonical scoring
 * runtime scores (the same ones the G43 simulation feeds it), so fantasy points are always computed by
 * the real scoring code, never here.
 *
 * Replaying a real past season is the natural next source; it needs a DB-first read of stored weekly
 * stats and is deliberately not wired here, so this module never touches a database or a provider.
 */
import type { SimRng } from './rng'

type SimPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'

export type SimPlayer = {
  playerId: string
  playerName: string
  position: SimPosition
  team: string
  byeWeek: number
  /** Hidden mean weekly output. Bots never read this; they see only scored results and ADP. */
  talent: number
  adp: number
}

const NFL_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
] as const

const POSITION_MIX: Array<{ position: SimPosition; share: number; top: number; floor: number }> = [
  { position: 'QB', share: 0.14, top: 24, floor: 9 },
  { position: 'RB', share: 0.3, top: 21, floor: 3 },
  { position: 'WR', share: 0.32, top: 20, floor: 3 },
  { position: 'TE', share: 0.12, top: 15, floor: 2 },
  { position: 'K', share: 0.06, top: 10, floor: 5 },
  { position: 'DEF', share: 0.06, top: 11, floor: 3 },
]

export function buildPlayerPool(input: { rng: SimRng; teamCount: number; rosterSize: number }): SimPlayer[] {
  const { rng } = input
  const byeByTeam = new Map<string, number>()
  for (const team of NFL_TEAMS) byeByTeam.set(team, rng.int(5, 14))

  const total = Math.ceil(input.teamCount * input.rosterSize * 1.7)
  const players: SimPlayer[] = []
  for (const mix of POSITION_MIX) {
    const count = Math.max(Math.ceil(total * mix.share), input.teamCount * 2 + 2)
    for (let i = 0; i < count; i += 1) {
      // Talent decays down the depth chart, with noise so ADP is an imperfect guide.
      const tierShare = i / count
      const talent = Math.max(mix.floor * 0.4, mix.top - (mix.top - mix.floor) * Math.sqrt(tierShare) + rng.normal(0, 1.5))
      const team = rng.pick(NFL_TEAMS)
      players.push({
        playerId: `sim-${mix.position.toLowerCase()}-${String(i + 1).padStart(3, '0')}`,
        playerName: `${mix.position} ${i + 1}`,
        position: mix.position,
        team,
        byeWeek: byeByTeam.get(team)!,
        talent: Math.round(talent * 100) / 100,
        adp: 0,
      })
    }
  }
  // ADP: talent with draft-room noise, then K/DEF pushed late the way real drafts push them.
  const ranked = players
    .map((player) => ({
      player,
      value: player.talent + rng.normal(0, 2.5) - (player.position === 'K' || player.position === 'DEF' ? 8 : 0),
    }))
    .sort((a, b) => b.value - a.value)
  ranked.forEach((row, index) => {
    row.player.adp = index + 1
  })
  return players.sort((a, b) => a.adp - b.adp)
}

/** Injury book: playerId → last week (inclusive) the player is out. */
export type InjuryBook = Map<string, number>

/** Rolls new injuries for `week`. Injuries are known before kickoff, so lineups can react to them. */
export function rollInjuries(input: { rng: SimRng; players: SimPlayer[]; week: number; book: InjuryBook; rate?: number }): string[] {
  const rate = input.rate ?? 0.03
  const fresh: string[] = []
  for (const player of input.players) {
    if (player.position === 'DEF') continue
    const outThrough = input.book.get(player.playerId)
    if (outThrough != null && outThrough >= input.week) continue
    if (input.rng.chance(rate)) {
      input.book.set(player.playerId, input.week + input.rng.int(0, 3))
      fresh.push(player.playerId)
    }
  }
  return fresh
}

export function isOut(book: InjuryBook, playerId: string, week: number): boolean {
  const through = book.get(playerId)
  return through != null && through >= week
}

/** Raw stat line for one player-week, or null when the player did not play (bye or injured). */
export function weeklyStatLine(input: {
  rng: SimRng
  player: SimPlayer
  week: number
  injuries: InjuryBook
}): Record<string, number> | null {
  const { rng, player, week } = input
  if (player.byeWeek === week || isOut(input.injuries, player.playerId, week)) return null
  const z = Math.max(0, rng.normal(player.talent, Math.max(2, player.talent * 0.45)))
  switch (player.position) {
    case 'QB':
      return {
        pass_yds: Math.round(z * 11),
        pass_td: Math.floor(z / 8),
        pass_int: rng.int(0, 2),
        rush_yds: Math.round(z * 0.8),
      }
    case 'RB':
      return {
        rush_yds: Math.round(z * 4),
        rush_td: Math.floor(z / 11),
        rec: Math.floor(z / 6),
        rec_yds: Math.round(z * 1.2),
      }
    case 'WR':
      return { rec: Math.round(z / 3), rec_yds: Math.round(z * 5), rec_td: Math.floor(z / 12) }
    case 'TE':
      return { rec: Math.round(z / 3.5), rec_yds: Math.round(z * 4.5), rec_td: Math.floor(z / 13) }
    case 'K':
      return { fg_0_39: Math.floor(z / 5), xp_made: rng.int(0, 4) }
    case 'DEF':
      return {
        def_sack: Math.floor(z / 4),
        def_int: rng.chance(0.35) ? 1 : 0,
        def_points_allowed: Math.max(0, Math.round(30 - z * 1.5)),
      }
  }
}
