// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {WeeklyXPublisher} from '@/components/core-app/WeeklyXPublisher'
const fetchMock=vi.fn()
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();fetchMock.mockResolvedValue({ok:true,json:async()=>({configured:true,connected:true,handle:'manager',expiresAt:null})})})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('reviewed connected X publishing',()=>{
 it('requires explicit review before publishing, and sends only the reviewed caption',async()=>{
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({configured:true,connected:true,handle:'manager'})}).mockResolvedValueOnce({ok:true,json:async()=>({url:'https://x.com/i/status/12345'})})
  render(<WeeklyXPublisher post="My week" leagueId="A"/>)
  await screen.findByLabelText('Text to publish on X')
  const button=screen.getByRole('button',{name:'Publish now on X'})
  expect((button as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Text to publish on X'),{target:{value:'Reviewed caption'}})
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button)
  await screen.findByRole('link',{name:'View post'})
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({action:'publish',text:'Reviewed caption'})
  expect(sessionStorage.getItem('af-weekly-x:pending')).toBeNull()
 })
 it('blocks an ambiguous result across closing and reopening the publisher',async()=>{
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({configured:true,connected:true,handle:'manager'})}).mockRejectedValueOnce(new Error('network'))
  const first=render(<WeeklyXPublisher post="My week" leagueId="A"/>)
  await screen.findByLabelText('Text to publish on X');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Publish now on X'}))
  await screen.findByRole('button',{name:'I checked X; allow another post'})
  expect(sessionStorage.getItem('af-weekly-x:pending')).not.toBeNull()
  first.unmount();render(<WeeklyXPublisher post="My week" leagueId="A"/>)
  await screen.findByLabelText('Text to publish on X')
  expect((screen.getByRole('button',{name:'Publish now on X'}) as HTMLButtonElement).disabled).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(3)
 })
 it('shows the existing draft option as the available path when server configuration is missing',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({configured:false,connected:false,handle:null})})
  render(<WeeklyXPublisher post="My week" leagueId={null}/>)
  await screen.findByText(/Connected X publishing isn’t available yet/)
  expect(screen.queryByRole('button',{name:'Publish now on X'})).toBeNull()
 })
})
