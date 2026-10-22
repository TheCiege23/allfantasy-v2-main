import { createHash } from 'node:crypto'
import { dispatchNotification, type DispatchNotificationParams } from './NotificationDispatcher'

/** Group only matching recipient/preference scopes; never expose another league's players. */
export function createTeamInjuryNewsBatch(budget?: { exhausted(): boolean }) {
 const items: Array<{requests: DispatchNotificationParams[]; complete: (users: Set<string>, failed: boolean) => Promise<void>}> = []
 return {
  add(requests: DispatchNotificationParams[], complete: (users: Set<string>, failed: boolean) => Promise<void>) { items.push({requests,complete}) },
  async flush() {
   let repeatsSuppressed=0
   const outcomes=items.map(()=>({users:new Set<string>(),failed:false}))
   const groups=new Map<string,Array<{index:number; request:DispatchNotificationParams; user:string}>>()
   const headlineGroups=new Map<string,string>()
   const ranked=items.flatMap((item,index)=>item.requests.map(request=>({index,request}))).sort((a,b)=>
    (a.request.category==='injury_alerts'?0:a.request.category==='followed_players'?1:2)-
    (b.request.category==='injury_alerts'?0:b.request.category==='followed_players'?1:2))
   ranked.forEach(({index,request})=>request.userIds.forEach(user=>{
    const team=String(request.meta?.team ?? '').trim()
    if(!team){outcomes[index].failed=true;return}
    const headline=request.meta?.injuryHeadline
    const storyKey=headline?JSON.stringify([user,request.meta?.sport,team.toUpperCase(),headline,(request.meta?.playerNews as {delivery?:string}|undefined)?.delivery??null]):undefined
    // Push-now and digest-only halves of the player-news gate never share one message.
    const delivery=JSON.stringify([(request.meta?.playerNews as {delivery?:string}|undefined)?.delivery??null,request.skipChannels??null])
    const key=(storyKey&&headlineGroups.get(storyKey))||JSON.stringify([user,request.category,request.leagueId??null,request.meta?.sport,team.toUpperCase(),delivery])
    if(storyKey)headlineGroups.set(storyKey,key)
    const entries=groups.get(key)??[];entries.push({index,request,user});groups.set(key,entries)
   }))
   for(const entries of groups.values()) {
    if(budget?.exhausted()){for(const entry of entries)outcomes[entry.index].failed=true;continue}
    const first=entries[0]
    const members=[...new Map(entries.map(e=>[e.request.meta?.injuryHeadline??e.request.dedupePrefix??e.request.body,e.request])).values()]
    repeatsSuppressed+=entries.length-members.length
    const digest=createHash('sha256').update(JSON.stringify([first.request.category,first.request.leagueId,first.request.meta?.team,members.map(m=>m.dedupePrefix??m.body).sort()])).digest('hex')
    try {
     const result=await dispatchNotification({...first.request,userIds:[first.user],
      title:String(first.request.meta?.teamName??first.request.meta?.team)+': injury update',
      body:members.map(m=>m.body??m.title).join('\n'),
      dedupePrefix:'team-injury-news:'+digest,skipChannels:{...first.request.skipChannels,sms:true},
      meta:{...first.request.meta,playerName:undefined,playerCount:members.length,pushTag:'team-injury-news:'+digest,
       // The digest lists every player the batched message names.
       ...(first.request.meta?.playerNews?{playerNews:{...(first.request.meta.playerNews as object),playerName:members.map(m=>(m.meta?.playerNews as {playerName?:string}|undefined)?.playerName??m.title).join(', ')}}:{})},
     })
     for(const entry of entries) { if(result.failed) outcomes[entry.index].failed=true; else outcomes[entry.index].users.add(entry.user) }
    } catch { for(const entry of entries)outcomes[entry.index].failed=true }
   }
   for(let index=0;index<items.length;index++)await items[index].complete(outcomes[index].users,outcomes[index].failed)
   return repeatsSuppressed
  },
 }
}
