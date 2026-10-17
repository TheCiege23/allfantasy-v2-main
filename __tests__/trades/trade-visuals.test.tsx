import {afterEach,describe,it,expect,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react'
import {ComparisonBars,LineupImpactChart} from '@/components/core-app/screens/TradeImpactCharts'
import {TradeReaction,TradeReactionSettings} from '@/components/core-app/screens/TradeReactions'
import {PlayerValueHistoryChart} from '@/components/core-app/player-card/PlayerValueHistoryChart'
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()})
describe('trade graphs and optional reactions',()=>{
  it('shows numeric zero-based comparisons and withholds an unavailable lineup',()=>{
    render(<><ComparisonBars title="Market value" rows={[{label:'A receives',value:0},{label:'B receives',value:100}]} unit="General market units"/><LineupImpactChart impact={null}/></>)
    expect(screen.getByText('0')).toBeTruthy();expect(screen.getByText('100')).toBeTruthy();expect(screen.getByText(/Lineup graph unavailable/)).toBeTruthy()
  })
  it('leaves reactions off until explicitly enabled and saves the device preference',()=>{
    render(<><TradeReactionSettings/><TradeReaction letter="A" completed/></>)
    expect(screen.queryByText(/Let Chimmy cook/)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByText(/Let Chimmy cook/)).toBeTruthy();expect(localStorage.getItem('af-trade-reactions')).toBe('on')
    fireEvent.click(screen.getByRole('checkbox'));expect(screen.queryByText(/Let Chimmy cook/)).toBeNull()
  })
  it('loads history only for verified unlocked NFL cards and names missing capture weeks',async()=>{
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({description:'dynasty · superflex',scope:'universal-market',note:'Recorded prices only.',points:[{day:'2026-09-08',value:100},{day:'2026-09-25',value:120}]})});vi.stubGlobal('fetch',fetch)
    const view=render(<PlayerValueHistoryChart sleeperId="1" sport="NBA" unlocked/>);expect(fetch).not.toHaveBeenCalled()
    view.rerender(<PlayerValueHistoryChart sleeperId="1" sport="NFL" unlocked={false}/>);expect(fetch).not.toHaveBeenCalled()
    view.rerender(<PlayerValueHistoryChart sleeperId="1" sport="NFL" unlocked/>);await waitFor(()=>expect(screen.getByText(/capture week; these are calendar/)).toBeTruthy())
    expect(screen.getByText('Unavailable')).toBeTruthy();fireEvent.change(screen.getByRole('slider',{name:'Inspect capture period'}),{target:{value:'1'}});expect(screen.getByText(/No recorded quote/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'By season'}));expect(screen.getByText(/Current season is incomplete/)).toBeTruthy()
  })
})
