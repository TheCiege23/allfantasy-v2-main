/**
 * Best ball depth check — the best-ball half of "Starters in doubt" (2026-10-08).
 *
 * ⚠ A BEST BALL LEAGUE HAS NO STARTERS TO BE IN DOUBT. The platform picks the highest-scoring lineup
 * after the games, so Sleeper's `starters` array there is the auto lineup, not a decision anybody
 * made — and listing those players as "starters in doubt" asked the manager to act on something they
 * cannot change. What a best-ball manager CAN act on is depth: a position where enough of the room is
 * hurt that the auto lineup may have nobody healthy left to pick.
 *
 * The rule, per position (founder's example: 3 QBs, 1 healthy, 1 out, 1 questionable → flag it):
 *
 *   - count the active players at the position (IR and taxi are not in the lineup pool);
 *   - flag the position when at least HALF of them carry an injury designation, questionable
 *     included, AND the healthy ones no longer exceed the slots the position must fill.
 *
 * So one hurt WR in a room of six is quiet, while one of two TEs in a one-TE league is worth a glance.
 * The tone is `bad` when even counting questionable players the slots cannot be filled, `warn`
 * otherwise. Pure and client-safe: no prisma, no clock.
 */

export type DepthPlayer = {
  name: string
  position: string | null
  /** The injury designation, or null when we hold none for him. Never "healthy" by default. */
  status: string | null
  /** Ruled out (Out, IR, PUP, suspension …) as opposed to merely limited. */
  unavailable: boolean
  /** On IR or taxi — not part of the lineup pool at all. */
  inactive: boolean
}

export type DepthAlert = {
  position: string
  rostered: number
  healthy: number
  out: number
  questionable: number
  /** Dedicated lineup slots for this position; flex slots are not counted. */
  needed: number
  tone: 'bad' | 'warn'
  flagged: Array<{ name: string; status: string }>
}

const POSITION_ALIASES: Record<string, string> = { DST: 'DEF', 'D/ST': 'DEF', D: 'DEF', PK: 'K' }

function canonical(pos: string | null | undefined): string | null {
  const p = String(pos ?? '').trim().toUpperCase()
  if (!p) return null
  return POSITION_ALIASES[p] ?? p
}

/** Dedicated slots per position from the league's starting template; flex and bench are ignored. */
export function neededByPosition(slots: string[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const raw of slots ?? []) {
    const slot = canonical(raw)
    if (!slot || slot.includes('FLEX') || ['BN', 'BENCH', 'IR', 'TAXI', 'RES'].includes(slot)) continue
    out.set(slot, (out.get(slot) ?? 0) + 1)
  }
  return out
}

export function bestBallDepthAlerts(slots: string[] | null | undefined, players: DepthPlayer[]): DepthAlert[] {
  const needed = neededByPosition(slots)
  const byPosition = new Map<string, DepthPlayer[]>()
  for (const p of players) {
    if (p.inactive) continue
    const pos = canonical(p.position)
    if (!pos) continue
    const list = byPosition.get(pos) ?? []
    list.push(p)
    byPosition.set(pos, list)
  }

  const alerts: DepthAlert[] = []
  for (const [position, room] of byPosition) {
    /*
     * A position the template never asks for (a stray K in a no-kicker league) cannot cost points.
     * Unknown slots fall back to one, which is the floor for any position a lineup uses.
     */
    const need = needed.size > 0 ? needed.get(position) ?? 0 : 1
    if (need === 0) continue
    const flagged = room.filter((p) => p.status != null)
    if (flagged.length === 0) continue
    const out = flagged.filter((p) => p.unavailable).length
    const healthy = room.length - flagged.length
    if (flagged.length * 2 < room.length || healthy > need) continue
    alerts.push({
      position,
      rostered: room.length,
      healthy,
      out,
      questionable: flagged.length - out,
      needed: need,
      tone: room.length - out < need ? 'bad' : 'warn',
      flagged: flagged.map((p) => ({ name: p.name, status: p.status as string })),
    })
  }
  return alerts.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'bad' ? -1 : 1
    return b.out + b.questionable - b.healthy - (a.out + a.questionable - a.healthy)
  })
}
