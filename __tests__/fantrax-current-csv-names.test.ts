import { expect, it } from 'vitest'
import { parseFantraxRoster } from '@/lib/fantrax-parser'
import { preserveSnapshotNames } from '@/lib/league-import/fantrax/preserveSnapshotNames'
const csv = `,Offense
ID,Pos,Player,Team,Eligible,Prim Pos,Status,Year,Age,Opponent,Fantasy Points,Bye,YDS-Pa,TD-Pa,YDS-Ru,TDRu,REC,YDS-RC,TD-Rc,FRTD,TD,2PT
*05ny7*,QB,Bryson Barnes,(N/A),QB,QB,Res,-,0,Bye,0,-,0,0,0,0,0,0,0,0,0,0
*05khp*,RB,E.J. Smith,(N/A),RB,RB,Res,-,0,Bye,0,-,0,0,0,0,0,0,0,0,0,0
*06k5m*,RB,Austyn Dendy,BGSU,RB,RB,Act,So,0,Opponent,11.14,10,0,0,53.42,0.53,1.05,8.54,0.12,0,0,0
`
it('reads the current 22-column export and matches fields by header',()=>{
 const rows=parseFantraxRoster(csv);expect(rows).toHaveLength(3)
 expect(rows[0]).toMatchObject({fantraxId:'05ny7',name:'Bryson Barnes',primaryPosition:'QB',status:'RESERVE',byeWeeks:'-'})
 expect(rows[2]).toMatchObject({byeWeeks:'10',rushingYards:53.42,rushingTDs:0.53,receptions:1.05,avgFantasyPoints:0})
})
it('preserves named omitted IDs without inventing schools or overriding the live directory',()=>{
 const live={'06k5m':{fantraxId:'06k5m',name:'Live Name',position:'RB',team:'BGSU'}}
 const merged=preserveSnapshotNames(live,parseFantraxRoster(csv))
 expect(merged['05ny7']).toEqual({fantraxId:'05ny7',name:'Bryson Barnes',position:'QB',team:''})
 expect(merged['06k5m']).toEqual(live['06k5m']);expect(live).not.toHaveProperty('05ny7')
})
it('refuses conflicting saved names and unnamed IDs',()=>{
 expect(preserveSnapshotNames({},[{fantraxId:'a',name:'One',primaryPosition:'RB'},{fantraxId:'a',name:'Two',primaryPosition:'RB'},{fantraxId:'b',name:'b'}])).toEqual({})
})
