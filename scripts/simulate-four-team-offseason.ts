/** Offline four-team offseason models; production pure rule functions, no database lifecycle claims. */
import { buildKeeperLocks } from '../lib/live-draft-engine/keeper/KeeperDraftOrder'
import { validateKeeperSelection, validateRosterKeeperSelections } from '../lib/live-draft-engine/keeper/KeeperRuleEngine'
import { resolvePickOwner } from '../lib/live-draft-engine/PickOwnershipResolver'
import { writeFileSync } from 'node:fs'
const check=(condition:unknown,label:string)=>{if(!condition)throw new Error(label)}
const teams=Array.from({length:4},(_,i)=>({slot:i+1,rosterId:'team-'+(i+1),displayName:'Team '+(i+1)}))
const startup=teams.map(t=>Array.from({length:15},(_,i)=>({playerId:t.rosterId+'-player-'+i,playerName:t.displayName+' Player '+i,position:i===0?'QB':'WR'})))
const selections=teams.flatMap((t,i)=>[0,1].map((p)=>({...startup[i][p],rosterId:t.rosterId,roundCost:p+2,team:null})))
const config={maxKeepers:2}
for(const selection of selections) check(validateKeeperSelection({config,existingSelections:selections.filter(s=>s!==selection),newSelection:selection,rounds:15,teamCount:4}).valid,'VALID_KEEPER')
check(validateRosterKeeperSelections(config,selections,15).valid,'KEEPER_ROSTER')
check(!validateKeeperSelection({config,existingSelections:selections,newSelection:{...selections[0],playerName:'Another',roundCost:5},rounds:15,teamCount:4}).valid,'MAXIMUM_KEEPERS')
const locks=buildKeeperLocks(selections,teams,[],4,15,'snake',false)
check(locks.length===8 && new Set(locks.map(l=>l.overall)).size===8,'UNIQUE_LOCKS')
const excluded=new Set(locks.map(l=>l.playerId))
const available=startup.flat().filter(p=>!excluded.has(p.playerId))
check(available.length===52,'KEEPER_POOL')
const trades=[{round:1,originalRosterId:teams[0].rosterId,previousOwnerName:teams[0].displayName,newRosterId:teams[1].rosterId,newOwnerName:teams[1].displayName}]
const rookies=Array.from({length:12},(_,i)=>({playerId:'rookie-'+i,round:Math.floor(i/4)+1,slot:i%4+1}))
const rookieDraft=rookies.map(p=>({...p,owner:resolvePickOwner(p.round,p.slot,teams,trades)!.rosterId}))
check(rookieDraft[0].owner===teams[1].rosterId,'TRADED_FUTURE_PICK')
const retained=startup.map(r=>[...r])
for(const pick of rookieDraft)retained[teams.findIndex(t=>t.rosterId===pick.owner)].push({playerId:pick.playerId,playerName:pick.playerId,position:'WR'})
check(retained.reduce((n,r)=>n+r.length,0)===72 && startup.flat().every(p=>retained.flat().some(r=>r.playerId===p.playerId)),'DYNASTY_RETENTION')
const report={scope:'Offline four-team offseason rule models; native specialty creation is still separately checked and may reject four teams.',keeper:{startupPlayers:60,keptPlayers:8,availablePlayers:52,lockedOverallPicks:locks.map(l=>l.overall),maximumEnforced:true},dynasty:{startupPlayers:60,retainedPlayers:60,rookiePicks:12,rosterSizesAfterRookieDraft:retained.map(r=>r.length),tradedFirstRoundPickApplied:true}}
writeFileSync('artifacts/four-team-offseason-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
