/**
 * A player's REAL age, read from the database rather than from a hand-maintained list.
 *
 * ── 🛑 WHY THIS EXISTS: THE TIER LIST'S AGES ARE A 2024 SNAPSHOT ────────────────────────────
 * `lib/dynasty-tiers.ts` carries `age` inline on every tiered player, and those numbers feed
 * `getAgeCurveWithCliffs`, `getExpectedWindow` and `getLiquidityModifier` — the whole dynasty
 * adjustment. Measured against `SportsPlayer` on 2026-09-07:
 *
 *     entries checked        64
 *     ages that were right    0
 *     median error           +2 years   (Puka Nacua 23→25, Jefferson 25→27, Josh Allen 28→30)
 *
 * Not one was correct. The module has no season stamp, so nothing announced that it had rotted,
 * and the error runs in the direction that makes every ageing player look younger than he is.
 *
 * ⚠ `calculateDynastyScore` REACHES ~40 ENTRY POINTS through `ai-gm-intelligence` and
 * `comprehensive-trade-learning` — AI chat, trade eval, waiver, mock draft, the draft war room.
 * A wrong age is not one bad number; it is the same bad number in forty places.
 *
 * ── WHY THE FIX IS HERE AND NOT IN `dynasty-tiers.ts` ───────────────────────────────────────
 * That module is PURE — zero prisma, zero fetch — and ~45 modules import it, several from client
 * paths. Teaching it to read a database would make every one of them server-only. Age is already
 * a PARAMETER its scoring functions accept, so the honest fix is to hand them a real one.
 *
 * 🛑 AND IT RETURNS ABSENCE, NOT A DEFAULT. A missing age is `undefined`, which every consuming
 * function already handles as "no age opinion". Substituting an average would be inventing the
 * input that decides the answer — the same refusal `scoringFit` makes about scoring settings.
 */

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { REFERENCE_NFL_BUCKETS } from '@/lib/sports-data-gateway/canonical/canonicalPosition'

/**
 * In-process cache. Ages do not change inside a request, and these lookups sit on AI paths that
 * enrich the same rosters repeatedly.
 *
 * ⚠ Deliberately NOT a durable cache: a birthday is the one fact that goes stale on a schedule,
 * and a process-lifetime map cannot outlive a deploy. That is the correct amount of caching for
 * something whose whole defect was being cached in source for two years.
 */
const cache = new Map<string, number | null>()

/** Reset between tests. Not exported for production use. */
export function __clearPlayerAgeCacheForTest(): void {
  cache.clear()
}

/**
 * One player to resolve. A bare string is a name with no verifying context.
 *
 * 🛑 A NAME IS NOT AN IDENTITY (2026-10-11). Measured on `SportsPlayer` that day: "Justin
 * Jefferson" carries age 27 (WR, MIN) and 23 (LB, CLE); 5,278 NFL names carry ages that differ by
 * two years or more across rows. The old lookup took whichever row came back LAST, so the
 * linebacker's 23 could price the receiver as a rising asset. Pass `sleeperId` when the caller
 * holds it, and `position` otherwise — a name alone binds only when every row agrees.
 */
export interface AgeLookup {
  name: string
  position?: string | null
  sleeperId?: string | null
}

/** A `SportsPlayer` row as the age resolver needs it. */
export interface AgeRow {
  name: string
  age: number | null
  position?: string | null
  sleeperId?: string | null
}

/*
 * Position GROUPS, not labels: feeds disagree on sub-positions for the same athlete (Byron Young
 * is "LB" in Sleeper and "OLB" in TheSportsDB; the Eagles' Byron Young is "DL" and "DT"). A label
 * outside these groups is compared as itself, which keeps other sports exact.
 *
 * The defensive groups come from the governed canonical buckets (`REFERENCE_NFL_BUCKETS`), not a
 * local collapse map — `canonicalPosition.ts` is the one place that decides DE/DT belong to DL.
 */
const OFFENSE_ALIASES: Record<string, string> = {
  HB: 'RB', FB: 'RB',
  PK: 'K',
  OT: 'OL', OG: 'OL', T: 'OL', G: 'OL', C: 'OL', IOL: 'OL',
  SAF: 'DB',
}

const DEFENSE_GROUPS = ['DL', 'LB', 'DB'] as const

const NO_POSITION = new Set(['', 'UNK', 'UNKNOWN', 'NA', 'N/A'])

function positionGroup(position: string | null | undefined): string | null {
  const p = String(position ?? '').trim().toUpperCase()
  if (NO_POSITION.has(p)) return null
  for (const group of DEFENSE_GROUPS) {
    if ((REFERENCE_NFL_BUCKETS.buckets[group] ?? []).includes(p)) return group
  }
  return OFFENSE_ALIASES[p] ?? p
}

function toLookup(input: string | AgeLookup): AgeLookup {
  return typeof input === 'string' ? { name: input } : input
}

/** The key a resolved age is stored under. `ageOf` builds the same key from the same lookup. */
export function ageLookupKey(input: string | AgeLookup): string {
  const l = toLookup(input)
  const name = normalizePlayerName(l.name)
  if (!name) return ''
  const sid = String(l.sleeperId ?? '').trim()
  return `${name}|${positionGroup(l.position) ?? ''}|${sid}`
}

/*
 * ⚠ WHY A ONE-YEAR SPREAD IS TOLERATED AND TWO IS NOT. The SAME athlete routinely carries ages one
 * apart across sources — a stored age goes stale on his birthday until that source re-syncs
 * (Lamar Jackson CB: 28 in Rolling Insights, 27 in Sleeper, one DOB). Refusing that would blank
 * most of the league. Two years apart is not staleness, it is two people (or a broken row), and
 * that is refused. Inside one year the HIGHER value wins, because a stale age only ever lags.
 */
const MAX_AGREEING_SPREAD = 1

function agreedAge(rows: readonly AgeRow[]): number | null {
  const ages = rows.map((r) => r.age).filter((a): a is number => typeof a === 'number' && a > 0)
  if (ages.length === 0) return null
  const lo = Math.min(...ages)
  const hi = Math.max(...ages)
  return hi - lo > MAX_AGREEING_SPREAD ? null : hi
}

/**
 * The age the given rows agree on for ONE player, or null when they do not identify one.
 *
 * Rules, in order:
 *  1. `sleeperId` given and some row carries it → only those rows speak (an id IS an identity).
 *  2. Otherwise rows whose normalised name matches, narrowed to the lookup's position GROUP when it
 *     states one. A row with no position cannot be verified and is dropped once a position is asked.
 *  3. Whatever survives must agree (see `MAX_AGREEING_SPREAD`) — rows that disagree are two
 *     people, and two people's ages averaged or "first wins" is a fabricated input. Refuse.
 *
 * Pure: `trajectory.ts` `loadExperience` is the model (disagreement → say nothing).
 */
export function pickAgreedAge(rows: readonly AgeRow[], lookup: string | AgeLookup): number | null {
  const l = toLookup(lookup)
  const sid = String(l.sleeperId ?? '').trim()
  if (sid) {
    const byId = rows.filter((r) => String(r.sleeperId ?? '').trim() === sid)
    if (byId.length > 0) return agreedAge(byId)
  }
  const name = normalizePlayerName(l.name)
  if (!name) return null
  let candidates = rows.filter((r) => normalizePlayerName(r.name) === name)
  const group = positionGroup(l.position)
  if (group) candidates = candidates.filter((r) => positionGroup(r.position) === group)
  return agreedAge(candidates)
}

/**
 * Real ages for the given players, keyed by `ageLookupKey` — read them back with `ageOf`, passing
 * the SAME name/position/sleeperId you resolved with.
 *
 * ⚠ THE NAME IS NORMALISED BECAUSE THE CALLER'S SPELLING IS NOT THE DATABASE'S. The tier
 * list alone carries "Marvin Harrison Jr.", "Marvin Harrison Jr" and "MHJ" for one player.
 *
 * 🛑 A NAMESAKE IS REFUSED, NOT GUESSED. A bare name whose rows disagree (Justin Jefferson WR 27 /
 * LB 23) resolves to nothing; pass `position` or `sleeperId` to bind it. See `pickAgreedAge`.
 *
 * Never throws: an unreachable database yields an empty map, and every consumer treats a missing
 * age as "no opinion" rather than as an error.
 */
export async function resolveNflAges(
  players: ReadonlyArray<string | AgeLookup>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const wanted: AgeLookup[] = []
  const seen = new Set<string>()

  for (const raw of players) {
    const lookup = toLookup(raw)
    const key = ageLookupKey(lookup)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (cache.has(key)) {
      const hit = cache.get(key)
      if (typeof hit === 'number') out.set(key, hit)
      continue
    }
    wanted.push(lookup)
  }
  if (wanted.length === 0) return out

  const names = [...new Set(wanted.map((l) => l.name))]
  const sleeperIds = [
    ...new Set(wanted.map((l) => String(l.sleeperId ?? '').trim()).filter(Boolean)),
  ]
  const rows = await prisma.sportsPlayer
    .findMany({
      where: {
        sport: 'NFL',
        age: { not: null },
        ...(sleeperIds.length > 0
          ? { OR: [{ name: { in: names } }, { sleeperId: { in: sleeperIds } }] }
          : { name: { in: names } }),
      },
      select: { name: true, age: true, position: true, sleeperId: true },
    })
    .catch(() => [] as AgeRow[])

  for (const lookup of wanted) {
    const key = ageLookupKey(lookup)
    const age = pickAgreedAge(rows as AgeRow[], lookup)
    /*
     * ⚠ NEGATIVE RESULTS ARE CACHED TOO. Without this, a name the database does not carry is
     * re-queried on every enrichment for the life of the process — and roughly 7% of NFL rows
     * have no age at all, so the miss is common rather than exotic.
     */
    cache.set(key, age)
    if (age != null) out.set(key, age)
  }

  return out
}

/** One player's age from a resolved map, or undefined. Pass the same lookup you resolved with. */
export function ageOf(ages: Map<string, number>, player: string | AgeLookup): number | undefined {
  return ages.get(ageLookupKey(player))
}
