import { createHash } from 'node:crypto'
import { dispatchNotification, type DispatchNotificationParams } from './NotificationDispatcher'

/** Group only matching recipient/preference scopes; never expose another league's players. */
export function createTeamInjuryNewsBatch() {
 const items: Array<{requests: DispatchNotificationParams[]; complete: (users: Set<string>, failed: boolean) => Promise<void>}> = []
 return {
  add(requests: DispatchNotificationParams[], complete: (users: Set<string>, failed: boolean) => Promise<void>) { items.push({requests,complete}) },
  async flush() {
   const outcomes=items.map(()=>({users:new Set<string>(),failed:false}))
   const groups=new Map<string,Array<{index:number; request:DispatchNotificationParams; user:string}>>()
   items.forEach((item,index)=>item.requests.forEach(request=>request.userIds.forEach(user=>{
    const team=String(request.meta?.team ?? '').trim()
    if(!team){outcomes[index].failed=true;return}
    const key=JSON.stringify([user,request.category,request.leagueId??null,request.meta?.sport,team.toUpperCase()])
    const entries=groups.get(key)??[];entries.push({index,request,user});groups.set(key,entries)
   })))
   for(const entries of groups.values()) {
    const first=entries[0]
    const members=[...new Map(entries.map(e=>[e.request.dedupePrefix??e.request.body,e.request])).values()]
    const digest=createHash('sha256').update(JSON.stringify([first.request.category,first.request.leagueId,first.request.meta?.team,members.map(m=>m.dedupePrefix??m.body).sort()])).digest('hex')
    try {
     const result=await dispatchNotification({...first.request,userIds:[first.user],
      title:String(first.request.meta?.team)+': injury update',
      body:members.map(m=>m.body??m.title).join('\n'),
      dedupePrefix:'team-injury-news:'+digest,skipChannels:{sms:true},
      meta:{...first.request.meta,playerName:undefined,playerCount:members.length,pushTag:'team-injury-news:'+digest},
     })
     for(const entry of entries) { if(result.failed) outcomes[entry.index].failed=true; else outcomes[entry.index].users.add(entry.user) }
    } catch { for(const entry of entries)outcomes[entry.index].failed=true }
   }
   for(let index=0;index<items.length;index++)await items[index].complete(outcomes[index].users,outcomes[index].failed)
  },
 }
}
