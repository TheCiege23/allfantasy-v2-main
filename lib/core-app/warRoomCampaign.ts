import type { OutlookLeague, OutlookTeam } from './seasonOutlook'
import { pctOf, simulateSeason, type SimInput } from './outlookSim'

/**
 * The road ahead — War Room phase 5, for the league on screen.
 *
 * Every regular-season game you still play, with your playoff odds if you win it and if you lose it,
 * so the games that decide your season stand out from the ones that barely move it. Beside it, the
 * tiebreak picture: the teams within a win of you and how far ahead or behind you they are on points
 * for, which is how this model breaks a tie.
 *
 * ⚠ THE BRANCHES ARE SEASON OUTLOOK'S OWN. Its "the week that matters" card forces ONE game (the next
 * one) each way through `simulateSeason`; this forces each of your remaining games the same way, with
 * the same seed and iteration count, so the two can never disagree about next week.
 *
 * 🛑 A GAME UNDER WAY IS NOT RANKED. Season Outlook moved its swing card off a game with points on the
 * board after it asked "win week 3?" of a team 110 down (production 2026-09-28). The same rule holds
 * here: a game with a live score is named as in progress and left out of the ranking.
 *
 * ⚠ FACTS ABOUT RIVALS, NEVER LABELS (Scout's rule). An opponent carries its record and its own playoff
 * odds; nothing here calls anyone a threat, a pushover or a seller.
 *
 * ⚠ COST IS BOUNDED. Two seeded season runs per game, at most `MAX_GAMES` games — computed only for the
 * league on screen, never for the cross-league home.
 *
 * Pure: no I/O, deterministic for a given seed.
 */

/** Never more than this many of your games are priced — the nearest ones. */
export const MAX_GAMES = 8

/** Below this many points of playoff probability between the two results, a game barely moves you. */
export const MIN_SWING = 3

export type CampaignOpponent = {
  rosterId: string
  name: string | null
  wins: number
  losses: number
  ties: number
  /** Their own playoff odds from the outlook board. Null when they are not modelled. */
  playoffPct: number | null
}

export type CampaignGame = {
  week: number
  opponent: CampaignOpponent
  /** Your playoff % if you win this game. */
  ifWin: number
  /** Your playoff % if you lose it. */
  ifLose: number
  /** ifWin − ifLose, in points of playoff probability. */
  swing: number
  /** The largest swing among the games priced (and at least `MIN_SWING`). */
  biggest: boolean
  /** Less than `MIN_SWING` either way. */
  small: boolean
}

export type TiebreakRow = {
  rosterId: string
  name: string | null
  isYou: boolean
  seed: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  /** Their points for minus yours. 0 on your own row. */
  pointsGap: number
  /** Inside the playoff field as things stand. */
  inField: boolean
}

export type Tiebreak = {
  playoffTeams: number
  /** You and every team within one win of you, in seed order. */
  rows: TiebreakRow[]
}

export type WarCampaign =
  | {
      kind: 'games'
      /** Today's playoff odds, from the outlook board. */
      playoffPct: number
      /** Chronological. */
      games: CampaignGame[]
      /** A week of yours with points already on the board, if any — named, never ranked. */
      inProgressWeek: number | null
      /** Games beyond `MAX_GAMES` that were not priced. */
      unpricedGames: number
      /** The league also plays the week's median; forcing a result fixes only the head-to-head game. */
      medianGame: boolean
      tiebreak: Tiebreak | null
    }
  | {
      kind: 'none'
      why: 'unplaced' | 'clinched' | 'eliminated' | 'no_games'
      tiebreak: Tiebreak | null
    }

const winsEq = (t: { wins: number; ties?: number }) => t.wins + (t.ties ?? 0) / 2

/** You and every team within one win of you, in seed order. Null when you are not on the board. */
export function buildTiebreak(row: Pick<OutlookLeague, 'teams' | 'playoffTeams'>): Tiebreak | null {
  const you = row.teams.find((t) => t.isYou)
  if (!you) return null
  const mine = winsEq(you)
  const rows: TiebreakRow[] = row.teams
    .filter((t) => Math.abs(winsEq(t) - mine) <= 1)
    .sort((a, b) => a.seed - b.seed)
    .map((t) => ({
      rosterId: t.rosterId,
      name: t.name,
      isYou: t.isYou,
      seed: t.seed,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties ?? 0,
      pointsFor: t.pointsFor,
      pointsGap: t.isYou ? 0 : t.pointsFor - you.pointsFor,
      inField: t.seed <= row.playoffTeams,
    }))
  // Only you is not a picture.
  return rows.length > 1 ? { playoffTeams: row.playoffTeams, rows } : null
}

function opponentOf(teams: OutlookTeam[], rosterId: string): CampaignOpponent {
  const t = teams.find((x) => x.rosterId === rosterId)
  return {
    rosterId,
    name: t?.name ?? null,
    wins: t?.wins ?? 0,
    losses: t?.losses ?? 0,
    ties: t?.ties ?? 0,
    playoffPct: t && t.modelled ? t.playoffPct : null,
  }
}

export function buildWarCampaign(args: {
  /** The outlook board row for this league. */
  row: Pick<OutlookLeague, 'teams' | 'playoffTeams' | 'you'>
  /** The scenario model's simulation input and seed — the same Season Outlook prices moves against. */
  sim: SimInput
  seed: number
  iterations: number
}): WarCampaign {
  const { row, sim, seed, iterations } = args
  const tiebreak = buildTiebreak(row)
  const you = row.you
  if (!you || !you.modelled) return { kind: 'none', why: 'unplaced', tiebreak }
  if (you.status === 'clinched') return { kind: 'none', why: 'clinched', tiebreak }
  if (you.status === 'eliminated') return { kind: 'none', why: 'eliminated', tiebreak }

  const mine = sim.remaining
    .filter((g) => g.a === you.rosterId || g.b === you.rosterId)
    .sort((a, b) => a.week - b.week)
  const inProgress = mine.find((g) => g.live != null) ?? null
  const open = mine.filter((g) => g.live == null)
  if (open.length === 0) {
    return inProgress
      ? {
          kind: 'games',
          playoffPct: you.playoffPct,
          games: [],
          inProgressWeek: inProgress.week,
          unpricedGames: 0,
          medianGame: sim.medianGame === true,
          tiebreak,
        }
      : { kind: 'none', why: 'no_games', tiebreak }
  }

  const priced = open.slice(0, MAX_GAMES)
  const games: CampaignGame[] = priced.map((g) => {
    const opp = g.a === you.rosterId ? g.b : g.a
    const branch = (winner: string) =>
      pctOf(
        simulateSeason(sim, { iterations, seed, forced: [{ week: g.week, a: g.a, b: g.b, winner }] }).counts[you.rosterId]?.playoff ?? 0,
        iterations,
      )
    const ifWin = branch(you.rosterId)
    const ifLose = branch(opp)
    const swing = ifWin - ifLose
    return { week: g.week, opponent: opponentOf(row.teams, opp), ifWin, ifLose, swing, biggest: false, small: Math.abs(swing) < MIN_SWING }
  })

  let top: CampaignGame | null = null
  for (const g of games) if (!g.small && (!top || g.swing > top.swing)) top = g
  if (top) top.biggest = true

  return {
    kind: 'games',
    playoffPct: you.playoffPct,
    games,
    inProgressWeek: inProgress?.week ?? null,
    unpricedGames: open.length - priced.length,
    medianGame: sim.medianGame === true,
    tiebreak,
  }
}
