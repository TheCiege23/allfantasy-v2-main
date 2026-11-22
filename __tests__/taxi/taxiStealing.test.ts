/** Taxi stealing — the pure rules (lib/taxi/taxiStealing.ts). */
import { describe, expect, it } from 'vitest'
import {
  checkClaim,
  claimedNotice,
  claimsLeft,
  describeTaxiStealing,
  isDue,
  MAX_STORED_CLAIMS,
  outcomeNotice,
  parseTaxiStealingRule,
  promoteFromTaxi,
  readTaxiStealClaims,
  readTaxiStealingRule,
  taxiPlayerIds,
  trimClaims,
  type TaxiStealClaim,
} from '@/lib/taxi/taxiStealing'

const ON = { enabled: true, protectHours: 48, claimsPerSeason: 1 }

const claim = (over: Partial<TaxiStealClaim> = {}): TaxiStealClaim => ({
  id: 'c1',
  playerId: 'p1',
  playerName: 'Rookie',
  fromRosterId: 'rA',
  toRosterId: 'rB',
  claimedBy: 'userB',
  season: 2026,
  createdAt: '2026-10-27T00:00:00Z',
  deadline: '2026-10-29T00:00:00Z',
  status: 'open',
  ...over,
})

describe('the rule', () => {
  it('is off with defaults until a commissioner stores it, and never reads a bad value as on', () => {
    expect(readTaxiStealingRule({})).toEqual({ enabled: false, protectHours: 48, claimsPerSeason: 1 })
    expect(readTaxiStealingRule({ taxi_stealing: { enabled: 'yes', protectHours: 5, claimsPerSeason: 9 } })).toEqual({ enabled: false, protectHours: 48, claimsPerSeason: 1 })
    expect(readTaxiStealingRule({ taxi_stealing: { enabled: true, protectHours: 72, claimsPerSeason: 0 } })).toEqual({ enabled: true, protectHours: 72, claimsPerSeason: 0 })
  })

  it('parses a partial update onto the current rule and refuses what the reader would not keep', () => {
    expect(parseTaxiStealingRule({ enabled: true }, readTaxiStealingRule({}))).toEqual({ ok: true, value: { enabled: true, protectHours: 48, claimsPerSeason: 1 } })
    expect(parseTaxiStealingRule({ protectHours: 24 }, ON)).toEqual({ ok: true, value: { ...ON, protectHours: 24 } })
    for (const bad of [{ enabled: 'on' }, { protectHours: 36 }, { claimsPerSeason: 4 }, 'on', null]) expect(parseTaxiStealingRule(bad, ON).ok).toBe(false)
  })

  it('tells Chimmy the rule only while it is on', () => {
    expect(describeTaxiStealing({ ...ON, enabled: false })).toBeNull()
    expect(describeTaxiStealing(ON)).toContain('1 claim per team per season')
    expect(describeTaxiStealing({ ...ON, claimsPerSeason: 0, protectHours: 24 })).toContain('no limit on claims')
  })
})

describe('claims', () => {
  const check = (over: Partial<Parameters<typeof checkClaim>[0]> = {}) =>
    checkClaim({ rule: ON, claims: [], playerId: 'p1', fromRosterId: 'rA', toRosterId: 'rB', onTaxi: true, season: 2026, ...over })

  it('allows a claim on another team’s taxi player', () => {
    expect(check()).toEqual({ ok: true })
  })

  it('refuses each thing a claim could not honour', () => {
    expect(check({ rule: { ...ON, enabled: false } })).toEqual({ ok: false, issue: 'RULE_OFF' })
    expect(check({ toRosterId: 'rA' })).toEqual({ ok: false, issue: 'OWN_PLAYER' })
    expect(check({ onTaxi: false })).toEqual({ ok: false, issue: 'NOT_ON_TAXI' })
    expect(check({ claims: [claim({ toRosterId: 'rC' })] })).toEqual({ ok: false, issue: 'ALREADY_CLAIMED' })
  })

  it('counts a team’s claims when made — a protected one still counts, a withdrawn one does not, last season’s do not', () => {
    expect(check({ playerId: 'p2', claims: [claim({ status: 'protected' })] })).toEqual({ ok: false, issue: 'NO_CLAIMS_LEFT' })
    expect(check({ playerId: 'p2', claims: [claim({ status: 'withdrawn' })] })).toEqual({ ok: true })
    expect(check({ playerId: 'p2', claims: [claim({ status: 'stolen', season: 2025 })] })).toEqual({ ok: true })
    expect(check({ playerId: 'p2', rule: { ...ON, claimsPerSeason: 0 }, claims: [claim({ status: 'stolen' }), claim({ id: 'c2', playerId: 'p3', status: 'stolen' })] })).toEqual({ ok: true })
    expect(claimsLeft({ rule: { ...ON, claimsPerSeason: 2 }, claims: [claim({ status: 'protected' })], rosterId: 'rB', season: 2026 })).toBe(1)
    expect(claimsLeft({ rule: { ...ON, claimsPerSeason: 0 }, claims: [], rosterId: 'rB', season: 2026 })).toBeNull()
  })

  it('reads stored claims only in a shape it knows, and is due once its deadline passes', () => {
    expect(readTaxiStealClaims({ taxi_steal_claims: [claim(), { id: 'x' }, 'junk'] }).map((c) => c.id)).toEqual(['c1'])
    expect(isDue(claim(), new Date('2026-10-28T23:59:00Z'))).toBe(false)
    expect(isDue(claim(), new Date('2026-10-29T00:00:00Z'))).toBe(true)
    expect(isDue(claim({ status: 'protected' }), new Date('2026-11-01T00:00:00Z'))).toBe(false)
  })

  it('trims old resolved claims but never an open one', () => {
    const many = Array.from({ length: MAX_STORED_CLAIMS + 10 }, (_, i) => claim({ id: `c${i}`, status: i === 0 ? 'open' : 'stolen' }))
    const kept = trimClaims(many)
    expect(kept).toHaveLength(MAX_STORED_CLAIMS)
    expect(kept[0]!.id).toBe('c0')
    expect(kept.at(-1)!.id).toBe(`c${MAX_STORED_CLAIMS + 9}`)
  })
})

describe('the lineup', () => {
  const pd = { lineup_sections: { starters: [{ id: 's1' }], bench: [{ id: 'b1' }], ir: [], taxi: [{ id: 'p1', name: 'Rookie' }, { id: 'p2' }], devy: [] } }

  it('reads the taxi squad and promotes one player to the end of the bench, every other spot unchanged', () => {
    expect(taxiPlayerIds(pd)).toEqual(['p1', 'p2'])
    const next = promoteFromTaxi(pd, 'p1')
    expect(taxiPlayerIds(next)).toEqual(['p2'])
    const sections = (next as { lineup_sections: Record<string, Array<{ id: string }>> }).lineup_sections
    expect(sections.bench!.map((r) => r.id)).toEqual(['b1', 'p1'])
    expect(sections.starters!.map((r) => r.id)).toEqual(['s1'])
  })
})

describe('notices', () => {
  it('tells the owner what to do and by when, in both languages', () => {
    const n = claimedNotice({ player: 'Rookie', claimer: 'Bravo', deadline: '2026-10-29T16:00:00Z', leagueName: 'Dynasty One' })
    expect(n.title.en).toBe('Bravo claimed Rookie off your taxi squad')
    expect(n.body.en).toContain('Promote Rookie to your active roster in Dynasty One by')
    expect(n.body.es).toContain('Pasa a Rookie a tu plantilla activa')
  })

  it('tells both teams how it ended, without gendered pronouns', () => {
    const texts: string[] = []
    for (const outcome of ['protected', 'stolen'] as const)
      for (const forClaimer of [true, false]) {
        const n = outcomeNotice({ player: 'Rookie', owner: 'Alpha', claimer: 'Bravo', outcome, forClaimer, leagueName: 'Dynasty One' })
        texts.push(n.title.en, n.body.en)
        expect(n.body.es.length).toBeGreaterThan(20)
      }
    expect(texts).toContain('Rookie is yours')
    expect(texts).toContain('Alpha protected Rookie')
    for (const text of texts) expect(text).not.toMatch(/\b(he|she|his|her|him)\b/i)
  })
})
