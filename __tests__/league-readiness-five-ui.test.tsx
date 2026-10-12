import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BigBrotherCommissionerPanel } from '@/components/big-brother/BigBrotherCommissionerPanel'
import { BigBrotherSchedule } from '@/components/big-brother/BigBrotherSchedule'
import { LeagueStandings } from '@/components/standings/LeagueStandings'
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}))
let fetchMock: ReturnType<typeof vi.fn>
const schedule = { paused:false, finaleReady:false, winnerPublished:false, currentWeek:2, isCommissioner:true, weeks:[
  {week:2,phase:'NOMINATION_OPEN',closed:false,events:[{key:'nomination',label:'Nominations due',deadlineAt:'2026-10-12T20:00:00Z',state:'current'},{key:'eviction',label:'Voting closes / eviction',deadlineAt:null,state:'upcoming'}]},
  {week:1,phase:'EVICTION_RESOLVED',closed:true,events:[{key:'eviction',label:'Voting closes / eviction',deadlineAt:'2026-10-05T20:00:00Z',state:'complete'}]}] }
const standings = { season:2026, scoringMode:'points', source:'native', sourcePlatform:'AllFantasy', scoredWeeks:2, viewerRosterId:'a', standings:[
  {rosterId:'a',teamName:'Team Alpha',wins:1,losses:1,ties:0,pointsFor:0,pointsAgainst:12,rank:2,streak:'L1',allPlay:'1-1-0'},
  {rosterId:'b',teamName:'Team Beta',wins:2,losses:0,ties:0,pointsFor:-2.5,pointsAgainst:0,rank:1,streak:'W2',allPlay:'2-0-0'}] }
beforeEach(()=>{fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const response=(data:unknown)=>({ok:true,json:async()=>data})
describe('house schedule',()=>{
  it('shows actual dates, missing setup, current action, history and commissioner navigation',async()=>{
    fetchMock.mockResolvedValue(response(schedule));render(<BigBrotherSchedule leagueId="l" />)
    await screen.findByText('Deadline not set')
    expect(screen.getByText('Current action')).toBeTruthy()
    expect(screen.getByRole('link',{name:'Commissioner Hub'}).getAttribute('href')).toBe('/league/l?tab=commissioner')
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-12T20:00:00Z')
    fireEvent.change(screen.getByLabelText('House week'),{target:{value:'1'}})
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.queryByText('Nominations due')).toBeNull()
  })
  it('preserves prior data on refresh failure, clears it on revoked access and recovers',async()=>{
    fetchMock.mockResolvedValue(response(schedule));render(<BigBrotherSchedule leagueId="l" />);await screen.findByText('Deadline not set')
    fetchMock.mockResolvedValueOnce({ok:false,status:500});fireEvent.click(screen.getByRole('button',{name:'Refresh schedule'}));await screen.findByRole('alert');expect(screen.getByText('Deadline not set')).toBeTruthy()
    fetchMock.mockResolvedValueOnce({ok:false,status:403});fireEvent.click(screen.getByRole('button',{name:'Refresh schedule'}));await waitFor(()=>expect(screen.queryByText('Deadline not set')).toBeNull())
    fireEvent.click(screen.getByRole('button',{name:'Refresh schedule'}));await screen.findByText('Deadline not set')
  })
})
describe('standings across formats',()=>{
  it('shows real IDP records, zero and negative points, owner highlighting and team search',async()=>{
    fetchMock.mockResolvedValue(response(standings));render(<LeagueStandings leagueId="l" title="IDP standings" />)
    await screen.findByRole('table');expect(screen.getByRole('heading',{name:'IDP standings'})).toBeTruthy()
    expect(screen.getAllByText('0.00').length).toBeGreaterThan(0);expect(screen.getByText('-2.50')).toBeTruthy()
    expect(screen.getByRole('rowheader',{name:/Team Alpha/}).textContent).toContain('You')
    fireEvent.change(screen.getByLabelText('Find a team'),{target:{value:'Beta'}})
    expect(screen.queryByRole('rowheader',{name:/Team Alpha/})).toBeNull()
    expect(screen.getByRole('rowheader',{name:'Team Beta'})).toBeTruthy()
  })
  it('renders an unavailable imported points-against total as a dash', async () => {
    fetchMock.mockResolvedValue(response({ ...standings, source: 'imported', sourcePlatform: 'fantrax', standings: [{ ...standings.standings[0], pointsAgainst: null }] }))
    render(<LeagueStandings leagueId="l" />)
    const table = await screen.findByRole('table')
    const row = within(table).getByRole('row', { name: /Team Alpha/ })
    const cells = within(row).getAllByRole('cell')
    expect(cells.at(-1)?.textContent).toBe('\u2014')
    expect(within(row).getByText('0.00')).toBeTruthy()
  })
  it.each(['roto','cumulative','category'])('renders %s without invented fields',async mode=>{
    fetchMock.mockResolvedValue(response({...standings,source:'imported',sourcePlatform:'fantrax',cumulative:mode==='cumulative',scoringMode:mode==='category'?'h2h_category':mode==='roto'?'roto':'points'}))
    render(<LeagueStandings leagueId="l" />);await screen.findByRole('table')
    expect(screen.getByText(/Published records and points from fantrax/)).toBeTruthy()
    if(mode!=='category')expect(screen.queryByRole('columnheader',{name:'W-L-T'})).toBeNull()
    else expect(screen.getByRole('columnheader',{name:'Categories W-L-T'})).toBeTruthy()
    expect(screen.queryByRole('columnheader',{name:'All-play'})).toBeNull()
  })
  it('does not carry prior-season rows into another season and ignores stale responses',async()=>{
    let resolveOld:(value:unknown)=>void=()=>{}
    fetchMock.mockResolvedValueOnce(response(standings)).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve})).mockResolvedValueOnce(response({...standings,season:2024,standings:[]}))
    render(<LeagueStandings leagueId="l" />);await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Season'),{target:{value:'2025'}});expect(screen.queryByRole('table')).toBeNull()
    fireEvent.change(screen.getByLabelText('Season'),{target:{value:'2024'}});await screen.findByText('No completed scoring results are available for this season yet.')
    resolveOld(response({...standings,season:2025}));await waitFor(()=>expect(screen.queryByRole('table')).toBeNull())
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true)
  })
  it('lets a manager type a season without fetching incomplete year digits',async()=>{
    fetchMock.mockResolvedValue(response(standings));render(<LeagueStandings leagueId="l" />);await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Season'),{target:{value:'2'}})
    expect((screen.getByLabelText('Season') as HTMLInputElement).value).toBe('2');expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Season'),{target:{value:'2025'}})
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));expect(fetchMock.mock.calls[1][0]).toContain('season=2025')
  })
  it('does not let an aborted authorization failure erase the new season response',async()=>{
    let rejectOld:(value:unknown)=>void=()=>{}
    fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{rejectOld=resolve})).mockResolvedValueOnce(response(standings))
    render(<LeagueStandings leagueId="l" />)
    fireEvent.change(screen.getByLabelText('Season'),{target:{value:'2026'}});await screen.findByRole('table')
    await act(async()=>{rejectOld({ok:false,status:403})});await waitFor(()=>expect(screen.getByRole('table')).toBeTruthy())
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })
  it('preserves data on transient error and clears it on access loss',async()=>{
    fetchMock.mockResolvedValue(response(standings));render(<LeagueStandings leagueId="l" />);await screen.findByRole('table')
    fetchMock.mockResolvedValueOnce({ok:false,status:500});fireEvent.click(screen.getByRole('button',{name:'Refresh standings'}));await screen.findByRole('alert');expect(screen.getByRole('table')).toBeTruthy()
    fetchMock.mockResolvedValueOnce({ok:false,status:401});fireEvent.click(screen.getByRole('button',{name:'Refresh standings'}));await waitFor(()=>expect(screen.queryByRole('table')).toBeNull())
  })
})

describe('commissioner tie recovery',()=>{
  it('submits the selected public nominee under the explicit commissioner action',async()=>{
    fetchMock.mockResolvedValue(response({message:'Tie resolved'}))
    render(<BigBrotherCommissionerPanel leagueId="l" nominees={[{id:'nom-a',name:'Team Alpha'},{id:'nom-b',name:'Team Beta'}]} />)
    fireEvent.change(screen.getAllByRole('combobox')[1],{target:{value:'resolve_eviction_tie'}})
    fireEvent.change(screen.getByLabelText('Evict tied nominee'),{target:{value:'nom-b'}})
    fireEvent.click(screen.getByRole('button',{name:'Run admin'}))
    await screen.findByText('Tie resolved')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({action:'resolve_eviction_tie',params:{rosterId:'nom-b'}})
  })
})
