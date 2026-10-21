import {beforeEach,expect,it,vi} from 'vitest'
const send=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/notifications/NotificationDispatcher',()=>({dispatchNotification:send}))
import {createTeamInjuryNewsBatch} from '@/lib/notifications/teamInjuryNewsBatch'
beforeEach(()=>{send.mockReset();send.mockResolvedValue({failed:0,delivered:1})})
const request=(id:string,team='ARI',leagueId='L')=>({userIds:['u'],category:'injury_alerts' as const,type:'player_injury_update',title:id,body:id+': Out',dedupePrefix:id,leagueId,meta:{team,sport:'NFL'}})
it('groups two players per team and records each story only after delivery',async()=>{
 const batch=createTeamInjuryNewsBatch(),one=vi.fn(),two=vi.fn(),three=vi.fn()
 batch.add([request('one')],one);batch.add([request('two')],two);batch.add([request('three','BUF')],three)
 expect(one).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
 await batch.flush()
 expect(send).toHaveBeenCalledTimes(2)
 expect(send.mock.calls[0][0]).toMatchObject({title:'ARI: injury update',body:'one: Out\ntwo: Out',userIds:['u']})
 expect(one).toHaveBeenCalledWith(new Set(['u']),false);expect(two).toHaveBeenCalledWith(new Set(['u']),false)
})
it('does not mix league preference scopes or recipients',async()=>{
 const batch=createTeamInjuryNewsBatch()
 batch.add([request('one')],vi.fn());batch.add([request('two','ARI','muted-league')],vi.fn())
 batch.add([{...request('three'),userIds:['other']}],vi.fn());await batch.flush()
 expect(send).toHaveBeenCalledTimes(3)
 expect(send.mock.calls[0][0].body).toBe('one: Out')
})
it('keeps failed stories retryable and successful audiences recorded',async()=>{
 const batch=createTeamInjuryNewsBatch(),done=vi.fn()
 send.mockResolvedValueOnce({failed:1}).mockResolvedValueOnce({failed:0})
 batch.add([{...request('one'),userIds:['u','other']}],done);await batch.flush()
 expect(done).toHaveBeenCalledWith(new Set(['other']),true)
})
it('does not send an unbound team',async()=>{
 const batch=createTeamInjuryNewsBatch(),done=vi.fn();batch.add([request('one','')],done);await batch.flush()
 expect(send).not.toHaveBeenCalled();expect(done).toHaveBeenCalledWith(new Set(),true)
})
