/**
 * My Team's dynasty roster markers: on every row of a dynasty league's lineup, the player's age —
 * toned by where it sits on his position's career arc — and a ROOKIE badge.
 *
 * WHY. A dynasty manager reads a roster as a pipeline: who is still rising, who is in his prime, who
 * is past the age his position usually falls off, and who has not played a pro snap yet. Those facts
 * lived on the player card, one tap away per player, and nowhere on the list itself.
 *
 * ⚠ NOTHING IS ESTIMATED, AND A WRONG PLAYER IS WORSE THAN NO MARKER.
 *   - Age is `SportsPlayer.age`, experience `SportsPlayer.yearsExp` (0 = rookie) — the same columns
 *     the dynasty outlook and the taxi checks read.
 *   - A row is used only when its `sleeperId` matches AND its normalised name matches the lineup's
 *     name for that player. Roster ids are not one namespace (a Fantrax id that falls through to the
 *     name-only bridge can equal an unrelated player's Sleeper id), and the name check is what makes
 *     that collision harmless. Several vendor rows for one player must agree (`pickAgreedAge`'s
 *     one-year spread, `agreedAge`; experience exactly), or the marker is left off.
 *   - The tone is the dynasty outlook's own rule of thumb (`agingThreshold`, "the age a position's
 *     production usually starts to fall"); 24 and under is the outlook's "young core". It is a flag
 *     for the eye, not a verdict, and the screen's legend says so.
 */
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { agreedAge } from '@/lib/player-age-agreement'
import { agingThreshold } from './dynastyAging'

export type DynastyAgeTone = 'rising' | 'prime' | 'aging'

export type DynastyRosterMarker = {
  age: number | null
  tone: DynastyAgeTone | null
  /** The age this position is flagged from, when it has one — shown beside an `aging` tone. */
  agingFrom: number | null
  rookie: boolean
}

/** Same line as the outlook's young core (`summariseAges`): 24 and under is still rising. */
export const RISING_THROUGH = 24

export type MarkerRow = { sleeperId: string | null; name: string | null; position: string | null; age: number | null; yearsExp: number | null }
export type MarkerPlayer = { sleeperId: string; name: string; position: string | null }

export function ageTone(age: number, threshold: number | undefined): DynastyAgeTone {
  if (threshold != null && age >= threshold) return 'aging'
  return age <= RISING_THROUGH ? 'rising' : 'prime'
}

/** Pure: the markers for these players from rows already read. Exported for tests. */
export function buildDynastyRosterMarkers(
  players: readonly MarkerPlayer[],
  rows: readonly MarkerRow[],
  sport: string | null | undefined,
): Record<string, DynastyRosterMarker> {
  const out: Record<string, DynastyRosterMarker> = {}
  for (const p of players) {
    if (!p.sleeperId || out[p.sleeperId]) continue
    const name = normalizePlayerName(p.name)
    if (!name) continue
    const mine = rows.filter((r) => r.sleeperId === p.sleeperId && normalizePlayerName(r.name) === name)
    if (mine.length === 0) continue
    const age = agreedAge(mine)
    const exps = new Set(mine.map((r) => r.yearsExp).filter((v): v is number => typeof v === 'number'))
    const rookie = exps.size === 1 && [...exps][0] === 0
    if (age == null && !rookie) continue
    const threshold = agingThreshold(sport, String(p.position ?? '').toUpperCase())
    out[p.sleeperId] = {
      age,
      tone: age == null ? null : ageTone(age, threshold),
      agingFrom: threshold ?? null,
      rookie,
    }
  }
  return out
}
