/**
 * When no bench player can come in for a ruled-out starter, the free agent who can (Guap,
 * 2026-10-09). The first live digest said "Jacksonville Pro H2H Points PPR League: no bench player can
 * come in for him" — true, and a dead end: the manager still had to go and find someone. This picks
 * the one to add.
 *
 * Pure. The candidates come from the Player Command Center's replacement engine
 * (shared-services/league-hub/replacementOptions.ts `freeAgentOptions`: unrostered in THAT league,
 * same position, projection-desc), which does not look at injuries or kickoffs — so this does:
 *
 *   - 🛑 NOT INJURED. A free agent listed Out / Doubtful / IR / Suspended is not a fix; suggesting one
 *     is the same mistake as the alert it is answering.
 *   - 🛑 STILL ABLE TO PLAY THIS WEEK. His club must have a kickoff on file that has not started. A
 *     club with no game this week is on bye — an add that scores nothing — and a game that has
 *     started cannot be entered into a lineup, whatever the waiver screen allows.
 *
 * The first survivor wins (the engine's order is projection-desc). None → null, and the alert falls
 * back to "check free agents" with the league's claim screen.
 */

const OUT_OF_PLAY = new Set(['out', 'doubtful', 'ir', 'injured reserve', 'suspended', 'pup'])

export type FreeAgentCandidate = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  projectedPoints: number
}

export type FreeAgentPick = { playerId: string; name: string; position: string | null; projectedPoints: number }

export function pickFreeAgent(
  candidates: readonly FreeAgentCandidate[],
  ctx: {
    /** Club abbreviation → this week's kickoff ISO (playerGame.weekKickoffs). */
    kickoffs: Readonly<Record<string, string>>
    /** Club abbreviation normaliser (lib/team-abbrev), injected so this stays pure and testable. */
    club: (team: string | null) => string | null
    /** Lower-cased designation by player id, for the candidates that have one. */
    statusById: ReadonlyMap<string, string>
    now: Date
  },
): FreeAgentPick | null {
  for (const c of candidates) {
    const status = ctx.statusById.get(c.playerId)
    if (status && OUT_OF_PLAY.has(status.trim().toLowerCase())) continue
    const club = ctx.club(c.team)
    const kickoff = club ? ctx.kickoffs[club] : undefined
    if (!kickoff) continue
    if (Date.parse(kickoff) <= ctx.now.getTime()) continue
    return { playerId: c.playerId, name: c.name, position: c.position, projectedPoints: c.projectedPoints }
  }
  return null
}
