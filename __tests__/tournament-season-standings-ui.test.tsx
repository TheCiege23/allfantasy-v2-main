import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SeasonStandingsPanel } from '@/components/tournament/SeasonStandingsPanel'
const setup:any={freezeId:'f1',scoringPeriods:[1,2],leagues:[{key:'pool',name:'Opening league',leagueId:'l1'}]}
const report=()=>({mode:'locked_setup',throughPeriod:1,periods:[1],scoresFinal:false,canAdvance:false,seedingReady:false,launchReady:false,blockers:['Every required league week needs a current verified finalization checkpoint.'],verifiedWeeks:1,requiredWeeks:8,weeks:[{leagueKey:'pool',period:1,state:'finalized',revision:1}],rows:Array.from({length:10},(_,i)=>({entrantId:'e'+i,displayName:'Team '+i,leagueKey:'pool',leagueName:'Opening league',rank:null,tied:false,pointsFor:null,knownFinalizedPoints:0,bestWeek:0,wins:null,missingPeriods:[2]}))})
beforeEach(()=>vi.restoreAllMocks())
it('shows unknown totals, known zeroes, missing weeks and paginated teams',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report())))
 render(<SeasonStandingsPanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Review opening standings'}))
 expect(await screen.findByRole('status')).toHaveTextContent('1 of 8 league-week checkpoints verified · 10 teams')
 expect(screen.getAllByText('Rank pending')).toHaveLength(8)
 expect(screen.getAllByText('Needs checkpoint: weeks 2')).toHaveLength(8)
 expect(screen.getAllByText('Known finalized points: 0 · Best week: 0')).toHaveLength(8)
 expect(screen.queryByText('Team 8')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Next teams'}));expect(screen.getByText('Team 8')).toBeInTheDocument()
 expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({tournamentId:'t1',freezeId:'f1',throughPeriod:1})
 expect(screen.queryByRole('button',{name:/advance|cut/i})).not.toBeInTheDocument()
})
it('changing the requested week clears old standings',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report())))
 render(<SeasonStandingsPanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Review opening standings'}));await screen.findByRole('status')
 fireEvent.change(screen.getByLabelText('Standings through'),{target:{value:'2'}})
 expect(screen.queryByText('Team 0')).not.toBeInTheDocument()
})
it('clears an old board before retry and shows safe errors',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report()))).mockResolvedValueOnce(new Response(JSON.stringify({error:'Standings verification is unavailable.'}),{status:409}))
 render(<SeasonStandingsPanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Review opening standings'}));await screen.findByRole('status')
 fireEvent.click(screen.getByRole('button',{name:'Review opening standings'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('verification is unavailable')
 expect(screen.queryByText('Team 0')).not.toBeInTheDocument()
})

it('shows verified half-win credits and distinguishes pending matchup verification',async()=>{
 const data=report() as any;data.verifiedMatchupWeeks=1
 data.rows[0]={...data.rows[0],wins:0.5,losses:0,ties:1,missingMatchupPeriods:[]}
 data.rows[1]={...data.rows[1],missingMatchupPeriods:[1]}
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(data)))
 render(<SeasonStandingsPanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Review opening standings'}))
 expect(await screen.findByText('Win credits: 0.5 · Losses: 0 · Ties: 1')).toBeInTheDocument()
 expect(screen.getByText('Matchup verification needed: weeks 1')).toBeInTheDocument()
 expect(screen.getByText('1 of 8 matchup checkpoints verified')).toBeInTheDocument()
})
