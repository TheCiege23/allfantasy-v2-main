/**
 * The /core Standings + Commissioner season-race mappings (batch B6 of the redraft visual upgrade).
 * Pure; each returns `null` when the data does not prove the claim, and the screen then draws nothing
 * extra. Design notes: docs/design/redraft-core-standings.md.
 *
 * ⚠ /core'S CLINCH IS ALREADY A PROOF, WHICH IS WHY THIS IS NOT #3101's `playoffRaceStatus`. The native
 * `/league/[id]` Standings (#3101) reads the playoff runtime, whose pre-bracket seeds are "if the season
 * ended today" — so it claims nothing until the bracket is generated. /core's board computes its own
 * `clinched` and `eliminated` in `standingsModel.computeZones`: every remaining result is enumerated
 * (or bounded so it can only UNDER-claim), so a team carries them only when no remaining result can
 * change the answer. That proof is what this tag passes through — and nothing else: the positional
 * zones (bye spot, playoff spot, bubble, out) say where a team stands today and are never a tag.
 *
 * ⚠ NO "CHAMPION" HERE. /core holds no playoff bracket for a league (the board is the regular season),
 * so a champion is never knowable on this surface and the tag does not exist rather than being guessed.
 */
import type { Zone } from './standingsModel'

export type RedraftRaceTag = 'clinched-bye' | 'clinched' | 'eliminated'

export const REDRAFT_RACE_LABEL: Record<RedraftRaceTag, string> = {
  'clinched-bye': 'Clinched bye',
  clinched: 'Clinched',
  eliminated: 'Eliminated',
}

/**
 * The proven race tag for a team on the /core board, or null. `elimination` is set for a guillotine /
 * survivor league, whose "eliminated" is a weekly chop, not the playoff race — those never get a tag.
 */
export function redraftRaceTag(
  team: { clinched: 'bye' | 'playoff' | null; zone: Zone },
  elimination: boolean = false,
): RedraftRaceTag | null {
  if (elimination) return null
  if (team.clinched === 'bye') return 'clinched-bye'
  if (team.clinched === 'playoff') return 'clinched'
  if (team.zone === 'eliminated') return 'eliminated'
  return null
}

/**
 * The Commissioner health ring's fill, 0–100, from the canonical engine score — or null when the score
 * is not available (the ring is then not drawn; the panel keeps its own "—" and reason).
 */
export function healthRingPct(
  score: { available: true; data: { score: number } } | { available: false } | null | undefined,
): number | null {
  if (!score || !score.available) return null
  const v = Number(score.data.score)
  if (!Number.isFinite(v)) return null
  return Math.round(Math.max(0, Math.min(100, v)))
}
