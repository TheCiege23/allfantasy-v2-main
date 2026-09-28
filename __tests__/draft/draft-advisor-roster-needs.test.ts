import { describe,expect,it } from 'vitest'
import { draftAdvisorRosterNeeds } from '@/lib/sports-reporting/draftAdvisorRosterNeeds'
describe('seven-sport advisor starter requirements', () => {
  it.each([['NFL','QB'],['NBA','PG'],['NHL','LW'],['MLB','SP'],['NCAAF','QB'],['NCAAB','G'],['SOCCER','FWD']])('uses %s starters', (sport,position) => {
    const needs = draftAdvisorRosterNeeds(sport)
    expect(needs).toContain(position)
    if (!['NFL','NCAAF'].includes(sport)) expect(needs).not.toContain('QB')
  })
  it('uses commissioner overrides instead of sport defaults', () => expect(draftAdvisorRosterNeeds('NBA',[],[{slotName:'C',starterCount:2,allowedPositions:['C']}])).toEqual(['C']))
  it('assigns multi-position players without falsely claiming a deficit', () => expect(draftAdvisorRosterNeeds('NBA',[{position:'PG/SG'},{position:'PG'}],[{slotName:'PG',starterCount:1,allowedPositions:['PG']},{slotName:'SG',starterCount:1,allowedPositions:['SG']}])).toEqual([]))
  it('does not infer football for an unknown sport', () => expect(draftAdvisorRosterNeeds('UNKNOWN')).toEqual([]))
})
