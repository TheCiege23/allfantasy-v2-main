// @vitest-environment node
/**
 * The season recap narrative's fact guard (lib/season-recap/seasonRecapFacts.ts): the deterministic
 * recap clears it in both languages, a faithful rewrite clears it, and every way of stepping outside
 * the facts is refused. Each refusal is paired with the passing text it was made from, so a guard that
 * refuses everything cannot pass this file.
 */
import { describe, expect, it } from 'vitest'
import { sampleRecap } from './season-recap-fixture'
import {
  buildSeasonRecapFacts,
  deterministicSeasonRecapText,
  seasonRecapFactsHash,
  stripNameMarks,
  validateSeasonRecapNarrative,
} from '@/lib/season-recap/seasonRecapFacts'
import { availableRecapCards, recapCardView } from '@/lib/season-recap/seasonRecapCards'

const recap = sampleRecap()
const facts = buildSeasonRecapFacts(recap)
const check = (text: string, lang: 'en' | 'es' = 'en') => validateSeasonRecapNarrative(text, facts, { lang, hasProfanity: (t) => /\bdamn\b/i.test(t) })

const GOOD =
  '[[Aces]] took the 2026 crown over [[Bears]]. [[Aces]] went 10-4 and piled up 1500.4 points, with a 150.2 outing in week 2. ' +
  'Pickup of the year: [[Joe Burrow]] gave [[Bears]] 150.4 points after week 3.'

describe('the facts', () => {
  it('carry the champion, the standings and the awards, rounded once', () => {
    const byKey = Object.fromEntries(facts.facts.map((f) => [f.key, f.value]))
    expect(byKey).toMatchObject({ season: 2026, champion: 'Aces', runnerUp: 'Bears', 'mostPointsFor.points': 1500.4, 'bestPickup.player': 'Joe Burrow' })
    expect(facts.names.sort()).toEqual(['Aces', 'Bears', 'Gridiron 99', 'Joe Burrow'])
  })

  it('hash differently per language and when the recap changes', () => {
    expect(seasonRecapFactsHash(facts, 'en')).not.toBe(seasonRecapFactsHash(facts, 'es'))
    const changed = buildSeasonRecapFacts(sampleRecap({ championRosterId: 'b', runnerUpRosterId: 'a' }))
    expect(seasonRecapFactsHash(changed, 'en')).not.toBe(seasonRecapFactsHash(facts, 'en'))
  })
})

describe('validateSeasonRecapNarrative', () => {
  it('passes the deterministic recap in English and Spanish', () => {
    for (const lang of ['en', 'es'] as const) {
      const text = deterministicSeasonRecapText(recap, lang)
      expect(check(text, lang)).toMatchObject({ passed: true, errors: [] })
    }
    expect(deterministicSeasonRecapText(recap, 'es')).toContain('reclamo')
    expect(deterministicSeasonRecapText(recap, 'es')).not.toMatch(/waiver/i)
  })

  it('passes a faithful rewrite', () => {
    expect(check(GOOD)).toMatchObject({ passed: true })
  })

  it('refuses a number that is not in the facts', () => {
    const r = check(GOOD.replace('1500.4', '1650'))
    expect(r.passed).toBe(false)
    expect(r.errors.join(' ')).toContain('1650')
  })

  it('refuses a marked name that is not in the facts', () => {
    const r = check(GOOD.replace('[[Joe Burrow]]', '[[Ja\'Marr Chase]]'))
    expect(r.passed).toBe(false)
    expect(r.errors.join(' ')).toContain("Ja'Marr Chase")
  })

  it('refuses an unmarked invented name mid-sentence, even after a colon', () => {
    expect(check(GOOD + ' The trade with Tom Brady sealed it.').passed).toBe(false)
    expect(check(GOOD.replace('[[Joe Burrow]]', 'Patrick')).passed).toBe(false)
  })

  it('refuses certain-outcome claims, personal attacks and profanity', () => {
    expect(check(GOOD + ' A guaranteed win next year.').passed).toBe(false)
    expect(check(GOOD + " You're an idiot, Bears.").passed).toBe(false)
    expect(check(GOOD + ' Damn.').passed).toBe(false)
  })

  it('refuses «waiver» in Spanish', () => {
    const es = deterministicSeasonRecapText(recap, 'es')
    expect(check(es, 'es').passed).toBe(true)
    expect(check(es.replace('alta por reclamo', 'alta por waiver'), 'es').passed).toBe(false)
  })

  it('refuses empty and malformed text', () => {
    expect(check('').passed).toBe(false)
    expect(check(GOOD.replace('[[Aces]] took', '[[Aces took')).passed).toBe(false)
  })

  it('strips name marks for display and copy', () => {
    expect(stripNameMarks('[[Aces]] beat [[Bears]].')).toBe('Aces beat Bears.')
  })
})

describe('share cards', () => {
  it('draw the champion and only the awards the recap has', () => {
    const kinds = availableRecapCards(recap)
    expect(kinds[0]).toBe('champion')
    expect(kinds).toContain('bestPickup')
    expect(kinds).not.toContain('bestTrade')
    expect(recapCardView(recap, 'bestTrade', 'en')).toBeNull()
  })

  it('say what the page says, in the viewer language', () => {
    expect(recapCardView(recap, 'champion', 'en')).toMatchObject({ label: 'Champion', value: 'Aces', detail: 'Beat Bears in the final', eyebrow: '2026 season recap' })
    expect(recapCardView(recap, 'champion', 'es')).toMatchObject({ label: 'Campeón', value: 'Aces', detail: 'Venció a Bears en la final' })
    expect(recapCardView(recap, 'bestPickup', 'es')?.label).toBe('Mejor alta por reclamo')
  })
})
