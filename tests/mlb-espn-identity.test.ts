import {it,expect} from 'vitest'
import {planMlbEspnIdentityLinks} from '@/lib/player-identity/mlbEspnIdentityPlan'
it('requires exact name, recognized same team and role; does not overwrite or guess',()=>{
 const refs=[{id:'1',name:'Joe Test',team:'NYY',position:'SP'},{id:'2',name:'Sam Test',team:'NYM',position:'OF'},{id:'3',name:'Dan Test',team:'NYY',position:'OF'}]
 const rows=[{id:'ri1',canonicalName:'Joe Test',currentTeam:'New York Yankees',position:'P',espnId:null,rollingInsightsId:'native1'},{id:'ri2',canonicalName:'Sam Test',currentTeam:'NYY',position:'OF',espnId:null,rollingInsightsId:'native2'},{id:'ri3',canonicalName:'Dan Test',currentTeam:'NYY',position:'OF',espnId:'existing',rollingInsightsId:'native3'}]
 expect(planMlbEspnIdentityLinks(refs,rows)).toMatchObject({links:[{id:'ri1',espnId:'1',rollingInsightsId:'native1'}],unmatched:1,conflicts:1})
})
