/** Conditional and protected picks — the pure rules (lib/league-trade-engine/pickTerms.ts). */
import { describe, expect, it } from 'vitest'
import {
  describeOutcome,
  describePickTerms,
  parseFuturePickRef,
  parsePickTerms,
  parsePickTermsRule,
  readPickTermsEnabled,
  readPickTermsRecords,
  resolvePickTerms,
  type PickTerms,
} from '@/lib/league-trade-engine/pickTerms'

const ctx = { teamCount: 12, rounds: 4, rosterIds: new Set(['rA', 'rB', 'rC']), pickRound: 2 }
const names: Record<string, string> = { rA: 'Alpha', rB: 'Bravo', rC: 'Charlie' }
const name = (id: string) => names[id] ?? '?'

describe('the rule and the records', () => {
  it('is off unless stored on, and only in the shape it knows', () => {
    expect(readPickTermsEnabled({})).toBe(false)
    expect(readPickTermsEnabled({ pick_terms_rule: { enabled: 'yes' } })).toBe(false)
    expect(readPickTermsEnabled({ pick_terms_rule: { enabled: true } })).toBe(true)
    expect(parsePickTermsRule({ enabled: true })).toEqual({ ok: true, value: { enabled: true } })
    expect(parsePickTermsRule('on').ok).toBe(false)
  })

  it('reads records with valid terms only', () => {
    const settings = {
      pick_terms: {
        'fdp:2027:1:rA': { terms: { kind: 'protected', top: 3, ifProtected: 'stays' }, tradeId: 't1', setAt: 'x' },
        'fdp:2027:2:rA': { terms: { kind: 'protected', top: 'three' } },
        junk: 'x',
      },
    }
    expect(Object.keys(readPickTermsRecords(settings))).toEqual(['fdp:2027:1:rA'])
  })

  it('parses a pick reference the same way the server does', () => {
    expect(parseFuturePickRef('fdp:2027:2:rA')).toEqual({ season: 2027, round: 2, originalRosterId: 'rA' })
    expect(parseFuturePickRef('fdp:2027:0:rA')).toBeNull()
    expect(parseFuturePickRef('player-1')).toBeNull()
  })
})

describe('an offer’s terms', () => {
  it('accepts protection up to one less than the team count, and keeps only known fields', () => {
    expect(parsePickTerms({ kind: 'protected', top: 3, ifProtected: 'rolls_over', extra: 1 }, ctx)).toEqual({ ok: true, value: { kind: 'protected', top: 3, ifProtected: 'rolls_over' } })
    expect(parsePickTerms({ kind: 'protected', top: 12, ifProtected: 'stays' }, ctx).ok).toBe(false)
    expect(parsePickTerms({ kind: 'protected', top: 0, ifProtected: 'stays' }, ctx).ok).toBe(false)
  })

  it('accepts a condition on a team in the league that becomes another round in the draft, or does not convey', () => {
    expect(parsePickTerms({ kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 }, ctx).ok).toBe(true)
    expect(parsePickTerms({ kind: 'conditional', teamRosterId: 'rB', event: 'makes_playoffs', effect: 'does_not_convey' }, ctx).ok).toBe(true)
    expect(parsePickTerms({ kind: 'conditional', teamRosterId: 'rZ', event: 'makes_playoffs', effect: 'does_not_convey' }, ctx).ok).toBe(false)
    expect(parsePickTerms({ kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 2 }, ctx).ok).toBe(false)
    expect(parsePickTerms({ kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 5 }, ctx).ok).toBe(false)
    expect(parsePickTerms({ kind: 'swap' }, ctx).ok).toBe(false)
  })
})

describe('settling', () => {
  const top3: PickTerms = { kind: 'protected', top: 3, ifProtected: 'stays' }
  const cond: PickTerms = { kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 }

  it('a protected pick stays when it lands inside the protection, and conveys outside it', () => {
    expect(resolvePickTerms({ terms: top3, slot: 3, playoffTeams: null })).toEqual({ outcome: 'protected', rollsOver: false })
    expect(resolvePickTerms({ terms: { ...top3, ifProtected: 'rolls_over' }, slot: 1, playoffTeams: null })).toEqual({ outcome: 'protected', rollsOver: true })
    expect(resolvePickTerms({ terms: top3, slot: 4, playoffTeams: null })).toEqual({ outcome: 'conveyed' })
    expect(resolvePickTerms({ terms: top3, slot: null, playoffTeams: null }).outcome).toBe('conveyed_unjudged')
  })

  it('a condition is judged on last season’s playoff field', () => {
    expect(resolvePickTerms({ terms: cond, slot: 5, playoffTeams: new Set(['rA']) })).toEqual({ outcome: 'became_round', round: 1 })
    expect(resolvePickTerms({ terms: cond, slot: 5, playoffTeams: new Set(['rB']) })).toEqual({ outcome: 'condition_not_met' })
    expect(resolvePickTerms({ terms: { ...cond, event: 'makes_playoffs', effect: 'does_not_convey' }, slot: 5, playoffTeams: new Set(['rB']) })).toEqual({ outcome: 'did_not_convey' })
    expect(resolvePickTerms({ terms: cond, slot: 5, playoffTeams: null }).outcome).toBe('conveyed_unjudged')
  })
})

describe('words', () => {
  it('describes each kind in both languages, without gendered pronouns', () => {
    const lines = [
      describePickTerms({ kind: 'protected', top: 3, ifProtected: 'stays' }, name, 'en', 'Alpha'),
      describePickTerms({ kind: 'protected', top: 5, ifProtected: 'rolls_over' }, name, 'en', 'Alpha'),
      describePickTerms({ kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 }, name, 'en', 'Alpha'),
      describePickTerms({ kind: 'conditional', teamRosterId: 'rB', event: 'makes_playoffs', effect: 'does_not_convey' }, name, 'en', 'Alpha'),
    ]
    expect(lines).toEqual([
      'top-3 protected (if it lands 1–3, it stays with Alpha)',
      "top-5 protected (if it lands 1–5, Alpha's same-round pick the next year conveys instead)",
      'becomes a 1st if Bravo misses the playoffs',
      'does not convey if Bravo makes the playoffs',
    ])
    expect(describePickTerms({ kind: 'conditional', teamRosterId: 'rB', event: 'misses_playoffs', effect: 'becomes_round', round: 1 }, name, 'es', 'Alpha')).toBe('pasa a ser de ronda 1 si Bravo no llega a playoffs')
    for (const l of lines) expect(l).not.toMatch(/\b(he|she|his|her)\b/i)
  })

  it('describes an outcome once settled, nothing before', () => {
    const rec = { terms: { kind: 'protected' as const, top: 3, ifProtected: 'stays' as const }, tradeId: 't', setAt: 'x' }
    expect(describeOutcome(rec, 'en')).toBeNull()
    expect(describeOutcome({ ...rec, result: { outcome: 'became_round', at: 'x', round: 1 } }, 'en')).toBe('became the round 1 pick')
    expect(describeOutcome({ ...rec, result: { outcome: 'protected', at: 'x' } }, 'es')).toBe('protegida: se quedó con el equipo original')
  })
})
