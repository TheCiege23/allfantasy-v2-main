import { describe, expect, it } from 'vitest'
import { planWinstonWatkinsRepair as plan, WINSTON_WATKINS_PROOF as p } from '@/lib/player-identity/winstonWatkinsRepair'
const source = [{ fantraxId: p.fantraxId, name: 'Watkins, Winston', primaryPosition: 'WR', team: 'LSU' }]
const row = { id: 'source-owned', canonicalName: p.name, fantraxId: p.fantraxId, position: 'WR', currentTeam: 'LOUISIANA STATE UNIVERSITY', cfbdId: p.knownWrongCfbdId }
const provider = [{ id: p.cfbdId, fullName: p.name, position: 'WR', team: 'LSU' }, { id: p.knownWrongCfbdId, fullName: 'Winston Watkins', position: 'QB', team: 'William & Mary' }]
describe('reviewed Winston Watkins namesake repair', () => {
  it('repairs only the proven source-owned wrong ID and handles CSV name order', () => {
    expect(plan(source, [row], provider)).toMatchObject({ changed: true, cfbdId: p.cfbdId })
  })
  it('is idempotent after repair', () => {
    expect(plan(source, [{ ...row, cfbdId: p.cfbdId }], provider).changed).toBe(false)
  })
  it.each([
    ['school', { ...row, currentTeam: 'William & Mary' }],
    ['position', { ...row, position: 'QB' }],
    ['name', { ...row, canonicalName: 'Another Watkins' }],
    ['unreviewed link', { ...row, cfbdId: 'unexpected' }],
  ])('rejects contradictory %s evidence', (_, bad) => expect(() => plan(source, [bad], provider)).toThrow())
  it('rejects a wrong provider role/school even when names match', () => {
    expect(() => plan(source, [row], [{ ...provider[0]!, position: 'QB' }])).toThrow(/provider proof/)
    expect(() => plan(source, [row], [{ ...provider[0]!, team: 'William & Mary' }])).toThrow(/provider proof/)
  })
  it('rejects duplicate source claims and reverse provider ownership', () => {
    expect(() => plan([...source, ...source], [row], provider)).toThrow(/source roster/)
    expect(() => plan(source, [row, { ...row, id: 'duplicate' }], provider)).toThrow(/one owner/)
    expect(() => plan(source, [row, { ...row, id: 'other', fantraxId: 'another', cfbdId: p.cfbdId }], provider)).toThrow(/reverse/)
  })
  it('rejects source role or school mismatches', () => {
    expect(() => plan([{ ...source[0]!, primaryPosition: 'QB' }], [row], provider)).toThrow(/source roster/)
    expect(() => plan([{ ...source[0]!, team: 'William & Mary' }], [row], provider)).toThrow(/source roster/)
  })
})
