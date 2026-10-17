import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SeasonMatchupSchedulePanel } from '@/components/tournament/SeasonMatchupSchedulePanel'
const setup:any={freezeId:'f1',scoringPeriods:[1,2],leagues:[{key:'pool',name:'Opening league',leagueId:'l1'}]}
const report=(state='draft')=>({key:'pool',period:1,state,source:'commissioner_round_robin_v1',previewToken:'a'.repeat(64),pairs:[{home:{entryId:'e1',displayName:'Team One'},away:{entryId:'e2',displayName:'Team Two'}}],publishBefore:'2026-10-20T00:00:00Z',timezone:'America/New_York',canPublish:state==='draft',launchReady:false})
beforeEach(()=>vi.restoreAllMocks())
it('previews pairings without publishing and uses the reviewed token for publication',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report()))).mockResolvedValueOnce(new Response(JSON.stringify({repeated:false}))).mockResolvedValueOnce(new Response(JSON.stringify(report('published'))))
 render(<SeasonMatchupSchedulePanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Preview matchups'}))
 expect(await screen.findByText('Team One')).toBeInTheDocument();expect(screen.getByText('Team Two')).toBeInTheDocument();expect(fetch).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'Publish week 1 matchups'}))
 expect(await screen.findByRole('status')).toHaveTextContent('Matchups published and locked')
 expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({action:'publish',tournamentId:'t1',freezeId:'f1',key:'pool',period:1,previewToken:'a'.repeat(64)})
 expect(screen.queryByRole('button',{name:'Publish week 1 matchups'})).not.toBeInTheDocument()
})
it('changing weeks discards the old preview and publication token',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report())))
 render(<SeasonMatchupSchedulePanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Preview matchups'}));await screen.findByText('Team One')
 fireEvent.change(screen.getByLabelText('Matchup week'),{target:{value:'2'}})
 expect(screen.queryByText('Team One')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Publish week/})).not.toBeInTheDocument()
})
it('closed weeks show suggestions without a publication action',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report('closed'))))
 render(<SeasonMatchupSchedulePanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Preview matchups'}))
 expect(await screen.findByRole('status')).toHaveTextContent('Publication closed · no schedule saved')
 expect(screen.queryByRole('button',{name:/Publish week/})).not.toBeInTheDocument()
})
it('ambiguous publication failure clears the stale preview and permits a fresh check',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify(report()))).mockRejectedValueOnce(new Error('Network unavailable'))
 render(<SeasonMatchupSchedulePanel tournamentId="t1" setup={setup}/>);fireEvent.click(screen.getByRole('button',{name:'Preview matchups'}));await screen.findByText('Team One');fireEvent.click(screen.getByRole('button',{name:'Publish week 1 matchups'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
 expect(screen.queryByRole('button',{name:/Publish week/})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Preview matchups'})).toBeEnabled()
})
