// @vitest-environment node
import {describe, expect, it, vi} from 'vitest'
vi.mock('@/lib/prisma',()=>({prisma:{}}))
vi.mock('@/lib/league-import/fantrax/fantraxApi',()=>({getFantraxLeagueInfo:vi.fn()}))
import {fantraxActualDownloadUrl} from '../lib/import-os/collector/fantraxBrowserContext'
const input={sourceLeagueId:'v2kzedypmm8jp61b',sourceTeamId:'qoat4t4imm8jp61g',season:2026,period:4,endDate:'2026-10-07'}
describe('verified actual-week download contract',()=>{
 it('reproduces the captured actual-week parameters',()=>{
  const url=new URL(fantraxActualDownloadUrl(input));expect(url.origin+url.pathname).toBe('https://www.fantrax.com/fxpa/downloadTeamRosterStats')
  expect(Object.fromEntries(url.searchParams)).toEqual({leagueId:input.sourceLeagueId,teamId:input.sourceTeamId,period:'4',seasonOrProjection:'SEASON_50t_BY_PERIOD',timeframeTypeCode:'BY_PERIOD',scoringCategoryType:'5',statsType:'1',view:'STATS',adminMode:'false',startDate:'2026-09-01',endDate:input.endDate,lineupChangeSystem:'EASY_CLICK',daily:'false',origDaily:'false'})
 })
 it('refuses guessed season codes and malformed IDs or periods',()=>{
  expect(()=>fantraxActualDownloadUrl({...input,season:2027})).toThrow()
  expect(()=>fantraxActualDownloadUrl({...input,sourceTeamId:'team&adminMode=true'})).toThrow()
  expect(()=>fantraxActualDownloadUrl({...input,period:0})).toThrow()
  expect(()=>fantraxActualDownloadUrl({...input,endDate:'2026-09-31'})).toThrow()
 })
})
