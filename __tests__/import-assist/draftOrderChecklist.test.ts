import { describe, expect, it } from 'vitest'
import { buildDraftOrderChecklist, platformLabel } from '@/lib/import-assist/draftOrderChecklist'

const slots = [
  { slot: 2, name: 'Bee', reason: '1,388.0 max PF, 2nd lowest', status: 'locked' as const },
  { slot: 1, name: 'Ace', reason: '1,301.2 max PF, lowest', status: 'locked' as const },
  { slot: 3, name: 'Cee', reason: 'Champion picks last', status: 'locked' as const },
]

describe('buildDraftOrderChecklist', () => {
  it('a final order: platform steps, then every slot in pick order', () => {
    const c = buildDraftOrderChecklist({ platform: 'sleeper', draftSeason: 2027, phase: 'final', slots })
    expect(c.final).toBe(true)
    expect(c.platform).toBe('Sleeper')
    expect(c.steps[0]).toMatch(/2027 draft exists on Sleeper/)
    expect(c.steps[1]).toMatch(/Sleeper app.*Menu names can change/)
    expect(c.steps.slice(2, 5)).toEqual(['Put Ace at pick 1.', 'Put Bee at pick 2.', 'Put Cee at pick 3.'])
    expect(c.shareText.split('\n').slice(0, 5)).toEqual([
      '2027 rookie draft order (final)',
      '',
      '1. Ace — 1,301.2 max PF, lowest',
      '2. Bee — 1,388.0 max PF, 2nd lowest',
      '3. Cee — Champion picks last',
    ])
  })
  it('says plainly when the order is not final, and marks pending slots', () => {
    const c = buildDraftOrderChecklist({ platform: 'espn', draftSeason: 2027, phase: 'playoffs', slots: [{ ...slots[0], status: 'provisional' }] })
    expect(c.final).toBe(false)
    expect(c.steps[0]).toMatch(/not final yet/)
    expect(c.shareText).toMatch(/not final/)
    expect(c.shareText).toMatch(/Bee \(pending\)/)
  })
  it('is not final with no slots, even when the phase says final', () => {
    expect(buildDraftOrderChecklist({ platform: 'yahoo', draftSeason: 2027, phase: 'final', slots: [] }).final).toBe(false)
  })
  it('an unknown platform still gets usable steps', () => {
    const c = buildDraftOrderChecklist({ platform: 'fantrax', draftSeason: 2027, phase: 'final', slots })
    expect(c.platform).toBe('your league’s platform')
    expect(c.steps.join(' ')).toMatch(/find the draft order setting/)
  })
  it('Spanish', () => {
    const c = buildDraftOrderChecklist({ platform: 'mfl', draftSeason: 2027, phase: 'final', slots, lang: 'es' })
    expect(c.steps).toContain('Pon a Ace en la selección 1.')
    expect(c.shareText.split('\n')[0]).toBe('Orden del draft de novatos 2027 (final)')
  })
  it('labels every supported platform', () => {
    expect(['sleeper', 'espn', 'yahoo', 'fleaflicker', 'mfl'].map(platformLabel)).toEqual(['Sleeper', 'ESPN', 'Yahoo', 'Fleaflicker', 'MyFantasyLeague'])
  })
})
