import { bestLineup, type ScenarioInjury, type ScenarioModel, type ScenarioPlayer } from './outlookScenario'
import type { OutlookLeague } from './seasonOutlook'
import type { WarPosture } from './warRoomFront'

/**
 * Playoff readiness — War Room phase 7, for the league on screen: is the lineup that got you here
 * going to be on the field when the title is decided?
 *
 * Three facts about YOUR roster, all read off Season Outlook's roster model:
 *   1. Which of your starters are on bye during your fantasy playoff weeks.
 *   2. Which are carrying an injury designation now.
 *   3. For each starter, the next man up at his position on your roster, and how many points you
 *      lose if you have to start him — so the spots where one injury hurts most stand out.
 * With your title odds beside them, since for a team that is in, the title is the number that matters.
 *
 * ⚠ YOUR FULL-STRENGTH LINEUP, NOT THIS WEEK'S. `bestLineup` drops a player ruled out, so a starter
 * who is hurt today would vanish from the list exactly when he matters most. The lineup here is chosen
 * with injury designations set aside, and each starter's designation is then shown against him.
 *
 * ⚠ RESERVE AND TAXI PLAYERS ARE NOT IN IT. A player on IR is not on the field and cannot be a backup;
 * a taxi-squad player cannot start on most platforms. (The shared `bestLineup` excludes reserve but
 * not taxi, so taxi is removed here before it is called.)
 *
 * ⚠ THE PLAYOFF WEEKS FOLLOW THE SEASON TIMELINE'S RULE (seasonTimeline.ts `buildSeasonTimeline`): the
 * league's playoff start week, then one week per round, ceil(log2(playoff teams)) rounds. A league that
 * plays two-week rounds is not modelled there either; the agreement test pins the two together.
 *
 * ⚠ ONE PROJECTION WEEK. Points are the model's basis week, as everywhere in the War Room, not a
 * playoff-week projection; byes come from the NFL schedule the model carries.
 *
 * Pure and client-safe.
 */

/** Postures for which the title is in play. A long shot gets the road ahead instead. */
const IN_PLAY: ReadonlySet<WarPosture> = new Set(['contender', 'clinched', 'bubble'])

/** How many starters are named as "where one injury hurts most". */
export const MAX_THIN = 3
/** A drop-off smaller than this is not called out — depth there is fine. */
export const MIN_DROP = 2

export type ReadyPlayer = { id: string; name: string; position: string; team: string | null; points: number }

export type ReadyStarter = {
  player: ReadyPlayer
  /** Your playoff weeks in which this player's NFL team is on bye. */
  byeWeeks: number[]
  injury: ScenarioInjury | null
  /** The best player at his position on your roster outside the lineup. Null when there is none. */
  backup: ReadyPlayer | null
  /** Points lost by starting the backup instead (or the starter's whole projection when there is none). */
  dropOff: number
}

export type PlayoffReady =
  | {
      kind: 'ready'
      /** Your fantasy playoff weeks, ascending. */
      weeks: number[]
      odds: { playoff: number; bye: number | null; title: number }
      /** Every starter, in the order the lineup was filled. */
      starters: ReadyStarter[]
      /** Starters with a bye in the playoff weeks. */
      onBye: ReadyStarter[]
      /** Starters with an injury designation now. */
      injured: ReadyStarter[]
      /** Biggest drop-off first, at most MAX_THIN, each at least MIN_DROP. */
      thinnest: ReadyStarter[]
      basisWeek: { season: string; week: number } | null
    }
  | { kind: 'none'; why: 'out_of_it' | 'no_dates' | 'not_priced' }

/** The timeline's rule: one week per round from the start week. Empty when the start week is unknown. */
export function playoffWeeks(start: number | null, playoffTeams: number | null): number[] {
  if (start == null || start <= 0) return []
  const rounds = playoffTeams != null && playoffTeams > 0 ? Math.ceil(Math.log2(playoffTeams)) : 1
  return Array.from({ length: Math.max(1, rounds) }, (_, i) => start + i)
}

const round1 = (n: number) => Math.round(n * 10) / 10

function asReady(p: ScenarioPlayer): ReadyPlayer {
  return { id: p.id, name: p.name, position: (p.position ?? '').toUpperCase(), team: p.team, points: p.points as number }
}

export function buildPlayoffReady(args: {
  model: ScenarioModel | null
  row: Pick<OutlookLeague, 'you' | 'byeTeams'> | null
  posture: WarPosture
  playoffStartWeek: number | null
  playoffTeams: number | null
}): PlayoffReady {
  if (!IN_PLAY.has(args.posture) || !args.row?.you) return { kind: 'none', why: 'out_of_it' }
  const weeks = playoffWeeks(args.playoffStartWeek, args.playoffTeams)
  if (weeks.length === 0) return { kind: 'none', why: 'no_dates' }
  const model = args.model
  const mine = model?.teams.find((t) => t.rosterId === model.youRosterId) ?? null
  if (!model || model.refusal || model.slots.length === 0 || !mine) return { kind: 'none', why: 'not_priced' }

  // Full strength: designations set aside to choose the lineup; reserve and taxi never in the pool.
  const pool = mine.players.filter((p) => p.slot !== 'I' && p.slot !== 'T' && p.position && p.points != null)
  const lineup = bestLineup(
    pool.map((p) => ({ ...p, injury: null })),
    model.slots,
  )
  if (lineup.unknown.length > 0 || lineup.starterIds.length === 0) return { kind: 'none', why: 'not_priced' }

  const byId = new Map(pool.map((p) => [p.id, p]))
  const starting = new Set(lineup.starterIds)
  // The next man up must be able to play: not ruled out now.
  const depth = pool
    .filter((p) => !starting.has(p.id) && p.injury?.kind !== 'out')
    .sort((a, b) => (b.points as number) - (a.points as number) || a.id.localeCompare(b.id))

  const starters: ReadyStarter[] = lineup.starterIds.flatMap((id) => {
    const p = byId.get(id)
    if (!p) return []
    const position = (p.position ?? '').toUpperCase()
    const backup = depth.find((d) => (d.position ?? '').toUpperCase() === position) ?? null
    return [
      {
        player: asReady(p),
        byeWeeks: p.byeWeek != null && weeks.includes(p.byeWeek) ? [p.byeWeek] : [],
        injury: p.injury,
        backup: backup ? asReady(backup) : null,
        dropOff: round1((p.points as number) - (backup?.points ?? 0)),
      },
    ]
  })

  const you = args.row.you
  return {
    kind: 'ready',
    weeks,
    odds: { playoff: you.playoffPct, bye: args.row.byeTeams > 0 ? you.byePct : null, title: you.titlePct },
    starters,
    onBye: starters.filter((s) => s.byeWeeks.length > 0),
    injured: starters.filter((s) => s.injury != null),
    thinnest: [...starters]
      .filter((s) => s.dropOff >= MIN_DROP)
      .sort((a, b) => b.dropOff - a.dropOff || a.player.name.localeCompare(b.player.name))
      .slice(0, MAX_THIN),
    basisWeek: model.basisWeek,
  }
}
