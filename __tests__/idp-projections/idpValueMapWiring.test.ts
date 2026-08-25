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
    expect(map.get('lb_stud')!.redraftValue).toBe(map.get('db_one')!.redraftValue)
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
