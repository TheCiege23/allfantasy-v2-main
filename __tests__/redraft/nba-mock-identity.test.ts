import { describe, expect, it } from 'vitest'
import { mockPlayerKey } from '@/lib/mock-draft-engine/mockPlayerIdentity'
describe('NBA mock player identity', () => {
  it.each([['Asa Newell','C','PF'], ['Bobby Portis','C','PF'], ['Amen Thompson','PG','G'], ['Austin Reaves','PG','SG']])(
    'does not draft %s again when another provider changes %s to %s', (name, a, b) => {
      expect(mockPlayerKey('NBA',name,a)).toBe(mockPlayerKey('NBA',name,b))
    })
  it('normalizes punctuation while keeping family suffixes distinct', () => {
    expect(mockPlayerKey('NBA','P.J. Washington','PF')).toBe(mockPlayerKey('NBA','PJ Washington','SF'))
    expect(mockPlayerKey('NBA','Gary Payton II','PG')).not.toBe(mockPlayerKey('NBA','Gary Payton','PG'))
  })
  it('preserves distinct football players with the same name at different positions', () => {
    expect(mockPlayerKey('NFL','Josh Allen','QB')).not.toBe(mockPlayerKey('NFL','Josh Allen','LB'))
  })
})
