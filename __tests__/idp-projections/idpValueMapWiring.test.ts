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
     * What a top defender is worth against a top receiver is an unvalidated product decision.
     * Reshaping the curve beneath it must not quietly move it.
     */
    const { idpTierValueCeiling } = await load()
    expect(idpTierValueCeiling(true)).toBe(5500)
    expect(idpTierValueCeiling(false)).toBe(3500)
  })
})
