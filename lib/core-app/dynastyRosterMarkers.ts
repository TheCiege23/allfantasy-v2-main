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
import { collegePlayerIds } from '@/lib/c2c/campusLineup'
import { agingThreshold } from './dynastyAging'

type DynastyAgeTone = 'rising' | 'prime' | 'aging'

export type DynastyRosterMarker = {
  age: number | null
  tone: DynastyAgeTone | null
  /** The age this position is flagged from, when it has one — shown beside an `aging` tone. */
  agingFrom: number | null
  rookie: boolean
  /**
   * A college prospect on a devy / C2C roster (the violet PROSPECT tag). Present only when true, so a
   * pro player's marker is exactly the shape it was before prospects existed. A prospect is never also
   * a ROOKIE: he has no pro season because he has not turned pro, which is a different fact.
   */
  prospect?: true
}

/** Same line as the outlook's young core (`summariseAges`): 24 and under is still rising. */
export const RISING_THROUGH = 24

export type MarkerRow = { sleeperId: string | null; name: string | null; position: string | null; age: number | null; yearsExp: number | null }
export type MarkerPlayer = { sleeperId: string; name: string; position: string | null }

export function ageTone(age: number, threshold: number | undefined): DynastyAgeTone {
  if (threshold != null && age >= threshold) return 'aging'
  return age <= RISING_THROUGH ? 'rising' : 'prime'
}

/**
 * Pure: the markers for these players from rows already read. Exported for tests.
 *
 * `prospectIds` (devy / C2C leagues only) names the players who are college prospects: a roster's
 * devy section, or a college player shown inside a pro league (`isCollegeProspect`). A prospect is
 * tagged even when no stored row agrees on his age — the tag comes from where he sits, not from the
 * age read — and is never also tagged ROOKIE.
 */
export function buildDynastyRosterMarkers(
  players: readonly MarkerPlayer[],
  rows: readonly MarkerRow[],
  sport: string | null | undefined,
  opts: { prospectIds?: ReadonlySet<string> | null } = {},
): Record<string, DynastyRosterMarker> {
  const out: Record<string, DynastyRosterMarker> = {}
  for (const p of players) {
    if (!p.sleeperId || out[p.sleeperId]) continue
    const name = normalizePlayerName(p.name)
    if (!name) continue
    const prospect = opts.prospectIds?.has(p.sleeperId) === true
    const mine = rows.filter((r) => r.sleeperId === p.sleeperId && normalizePlayerName(r.name) === name)
    if (mine.length === 0 && !prospect) continue
    const age = agreedAge(mine)
    const exps = new Set(mine.map((r) => r.yearsExp).filter((v): v is number => typeof v === 'number'))
    const rookie = !prospect && exps.size === 1 && [...exps][0] === 0
    if (age == null && !rookie && !prospect) continue
    const threshold = agingThreshold(sport, String(p.position ?? '').toUpperCase())
    out[p.sleeperId] = {
      age,
      tone: age == null ? null : ageTone(age, threshold),
      agingFrom: threshold ?? null,
      rookie,
      ...(prospect ? { prospect: true as const } : {}),
    }
  }
  return out
}

/**
 * The key a marker is filed under: the Sleeper id when there is one (every roster screen), else the
 * sport-qualified catalog id — a college player found by search carries no Sleeper id, and an
 * `externalId` alone is not unique across sports.
 */
export function markerKeyFor(p: { sleeperId?: string | null; sport: string; externalId: string }): string {
  return p.sleeperId || `${String(p.sport).toUpperCase()}:${p.externalId}`
}

/* ── devy / C2C prospects ─────────────────────────────────────────────── */

const DEVY_VARIANTS = new Set(['devy', 'devy_dynasty', 'c2c', 'merged_devy_c2c'])
const DEVY_TYPES = new Set(['devy', 'c2c'])

/**
 * A devy or campus-to-canton league, from the league's own columns — the variant ids
 * `looksLikeDevyFormat` (lib/core-app/devy.ts, server-only) and `isC2CVariant` compare against.
 */
export function isDevyFormatLeague(league: { leagueVariant?: string | null; leagueType?: string | null } | null | undefined): boolean {
  if (!league) return false
  const variant = String(league.leagueVariant ?? '').trim().toLowerCase()
  const type = String(league.leagueType ?? '').trim().toLowerCase()
  return DEVY_VARIANTS.has(variant) || DEVY_TYPES.has(type)
}

/** The college sport whose players are a pro sport's prospects. */
const COLLEGE_SPORT_OF: Readonly<Record<string, string>> = { NFL: 'NCAAF', NBA: 'NCAAB' }

export function collegeSportFor(leagueSport: string | null | undefined): string | null {
  return COLLEGE_SPORT_OF[String(leagueSport ?? 'NFL').trim().toUpperCase() || 'NFL'] ?? null
}

/**
 * A player of the college sport shown inside a pro league is a prospect there (an NCAAF player in an
 * NFL devy league). A college-only league (sport NCAAF) has none: every player there is college, and a
 * tag on every row would say nothing.
 */
export function isCollegeProspect(playerSport: string | null | undefined, leagueSport: string | null | undefined): boolean {
  const college = collegeSportFor(leagueSport)
  return college != null && String(playerSport ?? '').trim().toUpperCase() === college
}

/**
 * A roster's college players: its top-level `devy` list (lib/roster/buildPersistedRosterDataFromRosterState.ts)
 * and `lineup_sections.devy` (`collegePlayerIds`, lib/c2c/campusLineup.ts) — the section the lineup
 * screens call `lineupSection === 'devy'`. Those players are also in `players`, so My Team draws them
 * as bench rows; this is what tells their rows apart.
 */
export function prospectIdsOf(playerData: unknown): Set<string> {
  const out = collegePlayerIds(playerData)
  const pd = playerData && typeof playerData === 'object' && !Array.isArray(playerData) ? (playerData as Record<string, unknown>) : {}
  if (Array.isArray(pd.devy)) {
    for (const e of pd.devy) {
      const rec = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
      const id = typeof e === 'string' || typeof e === 'number' ? String(e) : rec ? String(rec.id ?? rec.player_id ?? '') : ''
      if (id) out.add(id)
    }
  }
  return out
}
