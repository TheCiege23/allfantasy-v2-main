/**
 * SURVIVOR IDOL POOL PLACEMENT — pure, deterministic. Owner's call (2026-10-20): idols hide on
 * random players in the DRAFT POOL at draft lock, so a pick can carry one without anybody
 * knowing; after the draft, two immunity idols are seeded on undrafted players so the waiver
 * wire can carry one too. Persistence lives in survivorIdolProvisioning.
 */

/** `SurvivorIdol.rosterId` while the idol sits on an undrafted pool player before the draft. */
export const SURVIVOR_POOL_IDOL_ROSTER_ID = '__survivor_pool__'
/** `SurvivorIdol.rosterId` while the idol sits on a free agent (waiver wire). */
export const SURVIVOR_WAIVER_IDOL_ROSTER_ID = '__survivor_waivers__'
/** Immunity idols seeded on undrafted players once the draft completes. */
export const SURVIVOR_WAIVER_IMMUNITY_IDOLS = 2
export const SURVIVOR_WAIVER_IMMUNITY_POWER = 'vote_shield'

export type PoolIdolCandidate = { playerId: string; playerName?: string | null; adp?: number | null }
export type PoolIdolPlacement = { playerId: string; playerName: string | null; powerType: string }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(values: readonly T[], rand: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Distinct candidates, best ADP first (unknown ADP last), so "the top of the pool" is well defined. */
export function orderPoolCandidates(candidates: readonly PoolIdolCandidate[]): PoolIdolCandidate[] {
  const seen = new Set<string>()
  return candidates
    .filter(candidate => {
      const id = String(candidate.playerId ?? '').trim()
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    .sort((a, b) => (a.adp ?? Number.POSITIVE_INFINITY) - (b.adp ?? Number.POSITIVE_INFINITY))
}

/**
 * One idol per sealed type, each on a different player chosen uniformly from the top `windowSize`
 * of the pool by ADP — the players a draft of that size is expected to take. Deterministic for a
 * seed, so the placement can be audited.
 */
export function computeSurvivorIdolPoolPlacement(input: {
  candidates: readonly PoolIdolCandidate[]
  powerTypes: readonly string[]
  windowSize: number
  seed: number
}): { ok: true; placements: PoolIdolPlacement[]; seed: number } | { ok: false; code: 'no_types' | 'pool_too_small'; error: string } {
  const types = input.powerTypes.filter(Boolean)
  if (types.length === 0) return { ok: false, code: 'no_types', error: 'No idol types are sealed for this league.' }
  const ordered = orderPoolCandidates(input.candidates)
  const window = ordered.slice(0, Math.max(types.length, Math.floor(input.windowSize)))
  if (window.length < types.length) {
    return { ok: false, code: 'pool_too_small', error: `The draft pool has ${window.length} players for ${types.length} idols.` }
  }
  const rand = mulberry32(input.seed)
  const players = shuffled(window, rand).slice(0, types.length)
  const powers = shuffled(types, rand)
  return {
    ok: true,
    seed: input.seed,
    placements: players.map((player, index) => ({ playerId: player.playerId, playerName: player.playerName ?? null, powerType: powers[index] })),
  }
}

/**
 * The undrafted players that get an immunity idol after the draft: `count` of them, uniformly
 * from the best `windowSize` undrafted by ADP (so the idol is on someone worth claiming), never a
 * player who already carries an idol.
 */
export function chooseWaiverImmunityPlayers(input: {
  undrafted: readonly PoolIdolCandidate[]
  excludePlayerIds: ReadonlySet<string>
  count: number
  windowSize: number
  seed: number
}): PoolIdolCandidate[] {
  const pool = orderPoolCandidates(input.undrafted).filter(candidate => !input.excludePlayerIds.has(candidate.playerId)).slice(0, Math.max(1, Math.floor(input.windowSize)))
  return shuffled(pool, mulberry32(input.seed)).slice(0, Math.max(0, Math.floor(input.count)))
}
