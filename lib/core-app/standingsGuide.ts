/**
 * The headline of a league's Standings page in plain words (2026-11-13). The owner's ask: users should
 * know what the page is for. The question people open it with is "where do I stand, and am I making
 * the playoffs?" — the board already knows (BoardTeam.zone / clinched / seed) and Season Outlook's odds
 * say how likely; this puts them in one sentence.
 *
 * Pure, so the rule is testable and the screen stays a renderer.
 */
import type { BoardTeam } from '@/lib/core-app/standingsModel'

export type StandingsHeadline =
  /** We cannot tell which team is yours. */
  | { kind: 'unknown' }
  /** An elimination league: place only — there is no playoff line to be above. */
  | { kind: 'place'; seed: number; of: number }
  | { kind: 'clinched'; seed: number; of: number; bye: boolean }
  | { kind: 'eliminated'; seed: number; of: number }
  /** In a playoff (or bye) spot right now, not yet clinched; `bubble` when it could slip away. */
  | { kind: 'in'; seed: number; of: number; odds: number | null; bubble: boolean }
  /** Outside the spots; `bubble` when right behind the line. */
  | { kind: 'out'; seed: number; of: number; gamesBack: number | null; odds: number | null; bubble: boolean }

export function standingsHeadline(input: {
  me: Pick<BoardTeam, 'seed' | 'zone' | 'clinched' | 'gamesBack'> | null
  teamCount: number
  /** How many teams make the playoffs (StandingsRules.playoffTeams). */
  playoffTeams: number
  elimination: boolean
  /** Your playoff odds, 0–100, from Season Outlook; null when not simulated. */
  oddsPct: number | null
}): StandingsHeadline {
  const { me, teamCount: of } = input
  if (!me) return { kind: 'unknown' }
  if (input.elimination) return { kind: 'place', seed: me.seed, of }
  if (me.clinched) return { kind: 'clinched', seed: me.seed, of, bye: me.clinched === 'bye' }
  if (me.zone === 'eliminated') return { kind: 'eliminated', seed: me.seed, of }
  /*
   * ⚠ IN OR OUT IS DECIDED BY SEED AGAINST THE PLAYOFF SPOTS, NOT BY ZONE. 'bubble' is assigned on BOTH
   * sides of the line (standingsModel: the last spots in AND the first spots out), so reading it as "out"
   * called the 3rd seed of a 3-team playoff "outside the playoff spots" (caught on the harness).
   */
  const bubble = me.zone === 'bubble'
  if (me.seed <= input.playoffTeams) return { kind: 'in', seed: me.seed, of, odds: input.oddsPct, bubble }
  return { kind: 'out', seed: me.seed, of, gamesBack: me.gamesBack, odds: input.oddsPct, bubble }
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinalEn(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}
