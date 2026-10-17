import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MyTeamHighlights from '@/components/core-app/MyTeamHighlights'
import { mergeRosterHighlights } from '@/lib/highlights/roster'
import type { MyTeamData } from '@/lib/core-app/myTeam'

const video = { videoId: 'abcdefghijk', title: 'Bills vs Jets highlights', channelTitle: 'NFL', channelId: 'official', publishedAt: '2026-10-11T12:00:00Z', thumbnailUrl: '/test.jpg', kind: 'game' as const }
const player = (sleeperId: string, name: string) => ({ sleeperId, name, sport: 'NFL' })
const data = { league: { id: 'league' }, starters: { available: true, data: [{ player: player('1','Josh Allen') }] }, bench: { available: true, data: [player('2','James Cook')] }, ir: { available: false }, taxi: { available: false } } as unknown as MyTeamData
afterEach(() => {cleanup();vi.unstubAllGlobals()})
describe('My Team Highlights', () => {
  it('deduplicates shared recaps, retains attribution and prefers a player match', () => {
    const result = mergeRosterHighlights([
      { sleeperId: '1', name: 'Josh Allen', result: { status: 'ready', videos: [video], message: null, checkedAt: null } },
      { sleeperId: '2', name: 'James Cook', result: { status: 'ready', videos: [{...video,kind:'player'}], message: null, checkedAt: null } },
    ])
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].players.map(p=>p.name)).toEqual(['Josh Allen','James Cook'])
    expect(result.videos[0].kind).toBe('player')
  })
  it('discovers once on demand and filters without extra provider requests', async () => {
    const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'ready',message:null,videos:[{...video,players:[{sleeperId:'1',name:'Josh Allen'}]}]})})
    vi.stubGlobal('fetch',fetcher)
    const {rerender}=render(<MyTeamHighlights data={data}/>)
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Find team highlights'}))
    await screen.findByText('Josh Allen')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({playerIds:['1','2']})
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'bench'}})
    expect(screen.queryByText(video.title)).not.toBeInTheDocument()
    expect(screen.getByText('No recent highlights for this roster filter.')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    rerender(<MyTeamHighlights data={{...data,league:{...data.league,id:'another'}}}/>)
    expect(screen.getByRole('button',{name:'Find team highlights'})).toBeInTheDocument()
  })
  it('clears and aborts a request when the roster changes', () => {
    const fetcher=vi.fn().mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher)
    const {rerender}=render(<MyTeamHighlights data={data}/>)
    fireEvent.click(screen.getByRole('button',{name:'Find team highlights'}))
    const signal=fetcher.mock.calls[0][1].signal as AbortSignal
    rerender(<MyTeamHighlights data={{...data,league:{...data.league,id:'new'}}}/>)
    expect(signal.aborted).toBe(true)
  })
})
