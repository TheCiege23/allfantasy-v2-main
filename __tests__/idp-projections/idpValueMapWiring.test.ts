import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The seam where a league's own projections replace Sleeper's popularity ranking.
 *
 * These assert BACKWARD COMPATIBILITY as hard as the new behaviour: `buildIdpKickerValueMap`
 * has three live callers, and a signature that silently changed their numbers would move
 * trade grades in surfaces that never opted in.
 */

const players: Record<string, unknown> = {}

/*
 * A realistic pool. Three named linebackers sit at the top, middle and bottom of it, and
 * their `search_rank` is deliberately the INVERSE of their projected quality so the two
 * ranking paths cannot accidentally agree and let a broken wiring pass.
 *
 * The size matters: the ladder's top tier covers ranks 1-3 at a single value, so a
 * three-player fixture puts everyone in it and every comparison ties.
 */
const FILLER = 40
for (let i = 0; i < FILLER; i++) {
  players[`lb_fill_${i}`] = {
    full_name: `Filler ${i}`,
    position: 'LB',
    team: 'CLE',
    age: 25,
    search_rank: 100 + i,
  }
}
players.lb_stud = { full_name: 'Stud Backer', position: 'LB', team: 'CLE', age: 25, search_rank: 9000 }
players.lb_mid = { full_name: 'Mid Backer', position: 'LB', team: 'CLE', age: 25, search_rank: 8000 }
players.lb_scrub = { full_name: 'Scrub Backer', position: 'LB', team: 'CLE', age: 25, search_rank: 1 }
players.db_one = { full_name: 'One Safety', position: 'S', team: 'CLE', age: 25, search_rank: 300 }

/*
 * Three kickers whose `search_rank` spans the whole of the deleted ladder: `k_famous` would
 * have landed on the 1200 rung, `k_mid` on 500 and `k_obscure` on the 100 floor. Their ages
 * differ too, because age was the other per-player input on the record. If any of that ever
 * separates them again, the ladder has come back in some form.
 */
players.k_famous = { full_name: 'Famous Boot', position: 'K', team: 'CLE', age: 24, search_rank: 1 }
players.k_mid = { full_name: 'Middling Boot', position: 'K', team: 'BUF', age: 29, search_rank: 12 }
players.k_obscure = { full_name: 'Obscure Boot', position: 'K', team: 'NYJ', age: 38, search_rank: 900 }

/** VORP that ranks the three named linebackers top / middle / bottom of the pool. */
const NAMED_VORP = new Map<string, number | null>([
  ['lb_stud', 12.0],
  ['lb_mid', 4.0],
  ['lb_scrub', 0.1],
])
/** Filler VORP spread between them so the named three land at rank 1, ~21 and ~42. */
for (let i = 0; i < FILLER; i++) NAMED_VORP.set(`lb_fill_${i}`, 11 - i * 0.25)

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => players })),
  )
})

async function load() {
  return await import('@/lib/idp-kicker-values')
}

describe('buildIdpKickerValueMap — without league context, nothing changes', () => {
  it('still ranks by search_rank when no context is supplied', async () => {
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['lb_stud', 'lb_mid', 'lb_scrub'], false)

    /*
     * `search_rank` puts the scrub first and the stud last, and the popularity path values
     * them in exactly that (wrong) order. Preserved on purpose — callers that pass no context
     * must see no change at all.
     */
    const scrub = map.get('lb_scrub')!.redraftValue
    const mid = map.get('lb_mid')!.redraftValue
    const stud = map.get('lb_stud')!.redraftValue
    expect(scrub).toBeGreaterThan(stud)
    expect(scrub).toBeGreaterThan(mid)

    /*
     * ⚠ AND THE MIDDLE TWO TIE, WHICH IS THE OTHER DEFECT. The ladder is a step function, so
     * ranks 42 and 43 land on the same rung and price identically while ranks 3 and 4 differ
     * by 24%. That plateau is what the interpolated read fixes on the projection path.
     */
    expect(mid).toBe(stud)
  })
})

describe('buildIdpKickerValueMap — with league context, projections drive the ranking', () => {
  it('reverses a ranking that popularity got backwards', async () => {
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['lb_stud', 'lb_mid', 'lb_scrub'], false, {
      vorpBySleeperId: NAMED_VORP,
    })

    const stud = map.get('lb_stud')!.redraftValue
    const mid = map.get('lb_mid')!.redraftValue
    const scrub = map.get('lb_scrub')!.redraftValue
    expect(stud).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(scrub)
  })

  it('separates adjacent players instead of dropping them on the same rung', async () => {
    /*
     * The legacy ladder is a step function: two players a single rank apart price identically
     * inside a tier and 24% apart across a boundary. Reading the same anchors continuously
     * keeps the ceiling and floor untouched while spacing neighbours by the distance actually
     * between them.
     */
    const { buildIdpKickerValueMap } = await load()
    const ids = ['lb_fill_5', 'lb_fill_6', 'lb_fill_7']
    const map = await buildIdpKickerValueMap(ids, false, { vorpBySleeperId: NAMED_VORP })
    const vals = ids.map((i) => map.get(i)!.redraftValue)
    expect(new Set(vals).size).toBe(3)
    expect(vals[0]).toBeGreaterThan(vals[1])
    expect(vals[1]).toBeGreaterThan(vals[2])
  })

  it('falls back to popularity for a player the league could not price', async () => {
    /*
     * A null VORP means replacement level could not be established for him. Ranking that at
     * the bottom would price a data gap as the worst defender on the board, so he keeps the
     * old basis rather than being punished for it.
     */
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['lb_stud', 'lb_mid'], false, {
      vorpBySleeperId: new Map([
        ['lb_stud', 9.4],
        ['lb_mid', null],
      ]),
    })
    expect(map.get('lb_mid')).toBeDefined()
    expect(map.get('lb_stud')!.redraftValue).toBeGreaterThan(0)
  })

  it('does not double-count position scarcity', async () => {
    /*
     * The hardcoded LB 1.15 / DB 0.95 multiplier exists to say linebackers out-score defensive
     * backs. Replacement level already measures that from the league's own slots, so on the
     * projection path the multiplier must not also apply. Equal VORP and equal rank => equal
     * value, whatever the position.
     */
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['lb_stud', 'db_one'], false, {
      vorpBySleeperId: new Map([
        ['lb_stud', 7.0],
        ['db_one', 7.0],
      ]),
    })
    const lb = map.get('lb_stud')!.redraftValue
    const db = map.get('db_one')!.redraftValue

    /*
     * They sit on ONE combined board, so equal VORP puts them at adjacent ranks and the values
     * differ by a single step of the curve (~5%), not by the 21% the old LB 1.15 / DB 0.95
     * multiplier would have imposed. Adjacent, not identical, is the honest expectation.
     */
    const ratio = Math.min(lb, db) / Math.max(lb, db)
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThanOrEqual(1)
  })

  it('keeps the age factor, which is trajectory rather than scarcity', async () => {
    const { buildIdpKickerValueMap } = await load()
    const young = await buildIdpKickerValueMap(['lb_stud'], true, {
      vorpBySleeperId: new Map([['lb_stud', 9.4]]),
    })
    players.lb_stud = { ...(players.lb_stud as object), age: 33 }
    vi.resetModules()
    const { buildIdpKickerValueMap: rebuilt } = await load()
    const old = await rebuilt(['lb_stud'], true, {
      vorpBySleeperId: new Map([['lb_stud', 9.4]]),
    })
    expect(young.get('lb_stud')!.value).toBeGreaterThan(old.get('lb_stud')!.value)
    players.lb_stud = { ...(players.lb_stud as object), age: 25 }
  })

  it('stays inside the currency the ladder already defines', async () => {
    /*
     * The ceiling is a product decision about what a defender is worth against an offensive
     * player. Changing the ranking must not change that band, or every IDP-for-offence trade
     * grade moves on a number nobody measured.
     */
    const { buildIdpKickerValueMap, idpTierValueCeiling } = await load()
    const map = await buildIdpKickerValueMap(['lb_stud', 'lb_mid', 'lb_scrub'], false, {
      vorpBySleeperId: NAMED_VORP,
    })
    for (const v of map.values()) {
      expect(v.redraftValue).toBeLessThanOrEqual(idpTierValueCeiling(false))
      expect(v.redraftValue).toBeGreaterThan(0)
    }
  })
})

describe('the value curve is shaped like a market, not like a staircase', () => {
  it('separates the top three instead of pricing them identically', async () => {
    /*
     * THE FLAT TOP. The hand-built ladder put ranks 1, 2 and 3 all at the ceiling, which says
     * the best linebacker in the league is worth exactly what the third-best is. The real RB
     * board on the day this was measured ran 10,729 / 10,167 / 8,897 — a 17% drop by the third
     * name — and the IDP curve now carries that shape.
     */
    const { buildIdpKickerValueMap } = await load()
    const ids = ['lb_stud', 'lb_fill_0', 'lb_fill_1']
    const map = await buildIdpKickerValueMap(ids, true, { vorpBySleeperId: NAMED_VORP })
    const [v1, v2, v3] = ids.map((i) => map.get(i)!.value)

    expect(v1).toBeGreaterThan(v2)
    expect(v2).toBeGreaterThan(v3)
    // Roughly the measured decay: r2 ~0.883 and r3 ~0.714 of the top.
    expect(v2 / v1).toBeGreaterThan(0.80)
    expect(v2 / v1).toBeLessThan(0.95)
    expect(v3 / v1).toBeLessThan(0.80)
  })

  it('stops over-pricing depth', async () => {
    /*
     * The old rungs valued rank 40 at 32.7% of the top where the market pays 12.4%, and rank
     * 130 at 9.1% against a measured 1.6%. Depth defenders were the most over-valued assets
     * on the board and the error grew the further down you looked.
     */
    const { buildIdpKickerValueMap, idpTierValueCeiling } = await load()
    const ceiling = idpTierValueCeiling(true)
    const map = await buildIdpKickerValueMap(['lb_fill_38'], true, {
      vorpBySleeperId: NAMED_VORP,
    })
    const deep = map.get('lb_fill_38')!.value
    // lb_fill_38 sits around rank 40 on the VORP board.
    expect(deep / ceiling).toBeLessThan(0.20)
    expect(deep / ceiling).toBeGreaterThan(0.05)
  })

  it('leaves the ceiling exactly where the product put it', async () => {
    /*
     * What a top defender is worth against a top receiver is a product decision, not a measured
     * quantity. Reshaping the curve beneath it must not quietly move it.
     *
     * Redraft moved from 3500 to 5300 on 2026-08-27, deliberately. 3500 valued defenders LESS
     * generously in redraft than dynasty, which is backwards — dynasty offensive values carry a
     * multi-year premium redraft ones do not. 5300 holds the dynasty stance as a share of the
     * top offensive asset: 5500 is 49% of the dynasty #1, and 49% of the redraft #1 is ~5300.
     */
    const { idpTierValueCeiling } = await load()
    expect(idpTierValueCeiling(true)).toBe(5500)
    expect(idpTierValueCeiling(false)).toBe(5300)
  })
})

/**
 * The kicker half, which is built on the OPPOSITE principle to the defender half above.
 *
 * Defenders are ranked because ranking them was validated. Kickers are not ranked because
 * ranking them was measured and failed: year-over-year Spearman is NEGATIVE in all six
 * measured season pairs (mean -0.455), within-season is ~0, and the whole startable
 * population spans 1.55x. `lib/kicker-values/leagueKickerValue.ts` carries the numbers.
 *
 * These tests exist to stop the ladder being rebuilt by accident — from `search_rank`, from
 * age, or from a well-meaning default.
 */
describe('buildIdpKickerValueMap — kickers are priced, never ranked', () => {
  it('gives every kicker in the league the same value, whatever their search_rank', async () => {
    const { buildIdpKickerValueMap } = await load()
    const ids = ['k_famous', 'k_mid', 'k_obscure']
    const map = await buildIdpKickerValueMap(ids, true, { kickerValue: 221 })

    for (const id of ids) expect(map.get(id)!.value).toBe(221)
    /*
     * The point of the fixture: on the deleted ladder these three were 1200 / 500 / 100.
     * `search_rank` is a popularity poll and orders nothing that persists.
     */
    expect(new Set(ids.map((i) => map.get(i)!.value)).size).toBe(1)
  })

  it('withholds age, so nothing downstream can rebuild an ordering out of it', async () => {
    /*
     * `league-rankings-v2`'s `computeAgeAdjustedMarketValue` multiplies any non-null age into
     * a 0.88-1.12 band. With the ladder gone, age would be the only field left that differs
     * between two kickers — and no measurement supports a kicker age curve.
     */
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['k_famous', 'k_obscure'], true, { kickerValue: 221 })
    expect(map.get('k_famous')!.age).toBeNull()
    expect(map.get('k_obscure')!.age).toBeNull()
    // The defender half still reports age: it is the trajectory layer there, and priced.
    const idp = await buildIdpKickerValueMap(['lb_stud'], true, { vorpBySleeperId: NAMED_VORP })
    expect(idp.get('lb_stud')!.age).toBe(25)
  })

  it('omits kickers entirely when the caller supplies no kicker value', async () => {
    /*
     * There is deliberately nothing to fall back to. A default here would be a new hand-drawn
     * ladder with the same defect, one import away from any surface — so a caller that does
     * not price kickers gets no kicker rows rather than invented ones. This is also what the
     * two IDP-only consumers see: `waiver-intelligence` and `idpChimmy` both filter their id
     * lists through `isIdpPosition` and never pass a kicker at all.
     */
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['k_famous', 'lb_stud'], true)
    expect(map.has('k_famous')).toBe(false)
    expect(map.has('lb_stud')).toBe(true)
  })

  it('keeps kickers out of the two IDP-only consumers by construction', async () => {
    /*
     * Both of those consumers gate on this one predicate — `waiver-intelligence` filters its
     * candidates with it, `idpChimmy`'s `buildIdpWaiverPool` filters its pool with it. It is
     * the reason removing the kicker ladder changed neither surface, so it is asserted rather
     * than left as a comment.
     */
    const { isIdpPosition, isKickerPosition } = await load()
    expect(isIdpPosition('K')).toBe(false)
    expect(isKickerPosition('K')).toBe(true)
  })

  it('prices the redraft side on the same flat number', async () => {
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['k_famous', 'k_obscure'], false, { kickerValue: 287 })
    expect(map.get('k_famous')!.redraftValue).toBe(287)
    expect(map.get('k_obscure')!.redraftValue).toBe(287)
    expect(map.get('k_famous')!.value).toBe(0)
  })

  it('prices kickers with no IDP context at all, for a kicker league that scores no IDP', async () => {
    /*
     * `league-rankings-v2` reaches this branch whenever `detectKickerLeague` is true, which is
     * most leagues. Before this seam the two halves of the context were entangled: a league
     * with no IDP passed `null` and would now get no kicker price either.
     */
    const { buildIdpKickerValueMap } = await load()
    const map = await buildIdpKickerValueMap(['k_mid'], true, { kickerValue: 221 })
    expect(map.get('k_mid')!.value).toBe(221)
  })
})
