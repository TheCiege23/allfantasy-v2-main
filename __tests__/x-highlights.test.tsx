import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import RecentClips from '@/components/core-app/highlights/RecentClips'
import XPostEmbed from '@/components/core-app/highlights/XPostEmbed'
const post={id:'2109403783620857925',account:'MySportsUpdate',text:'Cam Ward postgame interview',publishedAt:new Date().toISOString(),kind:'interview' as const}
const fetchMock=vi.fn()
beforeEach(()=>{cleanup();vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();delete (window as unknown as {twttr?:unknown}).twttr})
describe('X clips UI',()=>{
 it('makes no third-party request until the user loads a post and always provides an original link',async()=>{
  const createTweet=vi.fn().mockResolvedValue(document.createElement('div'))
  ;(window as unknown as {twttr:unknown}).twttr={widgets:{createTweet}}
  render(<XPostEmbed post={post}/>)
  expect(createTweet).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled()
  expect(screen.getByRole('link',{name:/Watch on X/}).getAttribute('href')).toBe('https://x.com/MySportsUpdate/status/'+post.id)
  fireEvent.click(screen.getByRole('button',{name:'Load X post'}))
  await waitFor(()=>expect(createTweet).toHaveBeenCalledWith(post.id,expect.any(HTMLElement),expect.objectContaining({dnt:true})))
 })
 it('keeps the link available when an embed is unavailable',async()=>{
  ;(window as unknown as {twttr:unknown}).twttr={widgets:{createTweet:vi.fn().mockResolvedValue(undefined)}}
  render(<XPostEmbed post={post}/>);fireEvent.click(screen.getByRole('button',{name:'Load X post'}))
  await screen.findByText('This post could not be displayed here.')
  expect(screen.getByRole('link',{name:/Watch on X/})).toBeTruthy()
 })
 it('distinguishes interviews from plays and filters without more requests',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({status:'ready',clips:[{...post,players:[{id:'1',name:'Cam Ward'}],leagues:[]}],checkedAt:post.publishedAt})})
  render(<RecentClips title="My Team clips" request={{kind:'roster',playerIds:['1']}}/>)
  await screen.findByText('Cam Ward');expect(screen.getByText('Interview')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'play'}})
  expect(screen.queryByText('Cam Ward')).toBeNull();expect(screen.getByText('No matching clips from the last 24 hours.')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(1)
 })
 it('hides unconfigured surfaces and survives failed feed requests',async()=>{
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({status:'disabled',clips:[],checkedAt:null})})
  const view=render(<RecentClips title="Recent clips" request={{kind:'player',sport:'NFL',sleeperId:'1'}}/>)
  await waitFor(()=>expect(screen.queryByRole('heading',{name:'Recent clips'})).toBeNull())
  view.unmount();fetchMock.mockRejectedValueOnce(new Error('offline'))
  render(<RecentClips title="Recent clips" request={{kind:'player',sport:'NFL',sleeperId:'2'}}/>)
  await screen.findByRole('button',{name:'Retry'})
 })
})

