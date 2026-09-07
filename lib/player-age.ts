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
 * Real ages for the given player names, keyed by NORMALISED name.
 *
 * ⚠ KEYED ON THE NORMALISED NAME BECAUSE THE CALLER'S SPELLING IS NOT THE DATABASE'S. The tier
 * list alone carries "Marvin Harrison Jr.", "Marvin Harrison Jr" and "MHJ" for one player. Look
 * up with `normalizePlayerName` too, or use `ageOf`.
 *
 * Never throws: an unreachable database yields an empty map, and every consumer treats a missing
 * age as "no opinion" rather than as an error.
 */
export async function resolveNflAges(names: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const wanted: string[] = []

  for (const raw of names) {
    const key = normalizePlayerName(raw)
    if (!key) continue
    if (cache.has(key)) {
      const hit = cache.get(key)
      if (typeof hit === 'number') out.set(key, hit)
      continue
    }
    wanted.push(raw)
  }
  if (wanted.length === 0) return out

  const rows = await prisma.sportsPlayer
    .findMany({
      where: { sport: 'NFL', name: { in: wanted }, age: { not: null } },
      select: { name: true, age: true },
    })
    .catch(() => [] as Array<{ name: string; age: number | null }>)

  for (const r of rows) {
    const key = normalizePlayerName(r.name)
    if (!key || typeof r.age !== 'number') continue
    cache.set(key, r.age)
    out.set(key, r.age)
  }

  /*
   * ⚠ NEGATIVE RESULTS ARE CACHED TOO. Without this, a name the database does not carry is
   * re-queried on every enrichment for the life of the process — and roughly 7% of NFL rows have
   * no age at all, so the miss is common rather than exotic.
   */
  for (const raw of wanted) {
    const key = normalizePlayerName(raw)
    if (key && !out.has(key)) cache.set(key, null)
  }

  return out
}

/** One player's age from a resolved map, or undefined. Handles the caller's raw spelling. */
export function ageOf(ages: Map<string, number>, name: string): number | undefined {
  return ages.get(normalizePlayerName(name))
}
