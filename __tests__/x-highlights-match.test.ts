import { describe, expect, it } from 'vitest'
import { matchXClips, mentionsPlayer } from '@/lib/highlights/x-match'
import { classifyXPost, normalizeXResponse } from '@/lib/highlights/x-provider'
import type { XPost } from '@/lib/highlights/x-types'
const now = Date.parse('2026-10-11T19:00:00Z')
const post: XPost = { id: '2109403783620857925', account: 'NFL', text: 'Josh Allen touchdown!', publishedAt: '2026-10-11T18:00:00Z', kind: 'play' }
const allen = { id: '1', name: 'Josh Allen' }
describe('X caption matching', () => {
 it('requires a full name boundary, never a team or surname', () => {
  expect(mentionsPlayer(post, allen)).toBe(true)
  for (const text of ['Allen touchdown', 'Buffalo Bills touchdown', 'Josh Allenstown scores', 'See https://example.com/Josh-Allen']) expect(mentionsPlayer({...post,text},allen)).toBe(false)
 })
 it('supports reviewed handles without inferring arbitrary handles', () => {
  expect(mentionsPlayer({...post,text:'Brady impressed by @brockpurdy13'},{id:'2',name:'Brock Purdy'})).toBe(true)
  expect(mentionsPlayer({...post,text:'@brockpurdy13fan'},{id:'2',name:'Brock Purdy'})).toBe(false)
  expect(mentionsPlayer({...post,text:'@joshallen' },allen)).toBe(false)
 })
 it('normalizes punctuation, accents and suffixes while rejecting single names', () => {
  expect(mentionsPlayer({...post,text:'Odell Beckham makes a catch'},{id:'2',name:'Odell Beckham Jr.'})).toBe(true)
  expect(mentionsPlayer({...post,text:'Josh Allen!'},{id:'2',name:'Allen'})).toBe(false)
 })
 it('rejects expired and future clips and deduplicates posts across players', () => {
  const second={id:'2',name:'Cam Ward'}
  const clips=matchXClips([{...post,text:'Josh Allen and Cam Ward highlights'},post,{...post,id:'2109403783620857926',publishedAt:'2026-10-10T18:00:00Z'},{...post,id:'2109403783620857927',publishedAt:'2026-10-12T18:00:00Z'}],[{players:[allen,second]}],now)
  expect(clips).toHaveLength(1);expect(clips[0].players).toEqual([allen,second])
 })
 it('shows one spotlight per league and merges the same clip across leagues', () => {
  const clips=matchXClips([post,{...post,id:'2109403783620857926',publishedAt:'2026-10-11T17:00:00Z'}],[{players:[allen],league:{id:'a',name:'A'}},{players:[allen],league:{id:'b',name:'B'}}],now,true)
  expect(clips).toHaveLength(1);expect(clips[0].leagues.map(l=>l.id)).toEqual(['a','b'])
 })
})
describe('X response normalization', () => {
 const response={data:[{id:post.id,text:post.text,author_id:'a',created_at:post.publishedAt,attachments:{media_keys:['v']}}],includes:{users:[{id:'a',username:'NFL',protected:false}],media:[{media_key:'v',type:'video'}]}}
 it('keeps allowlisted public video posts without exposing media URLs', () => {expect(normalizeXResponse(response)).toEqual([{...post,publishedAt:new Date(post.publishedAt).toISOString()}])})
 it('rejects unknown, private, withheld, and non-video posts', () => {
  expect(normalizeXResponse({...response,includes:{...response.includes,users:[{id:'a',username:'Other'}]}})).toEqual([])
  expect(normalizeXResponse({...response,includes:{...response.includes,users:[{id:'a',username:'NFL',protected:true}]}})).toEqual([])
  expect(normalizeXResponse({...response,data:[{...response.data[0],withheld:{country_codes:['US']}}]})).toEqual([])
  expect(normalizeXResponse({...response,includes:{...response.includes,media:[{media_key:'v',type:'photo'}]}})).toEqual([])
 })
 it('does not treat a partial error response as a successful empty catalog', () => {expect(()=>normalizeXResponse({...response,errors:[{title:'Unavailable'}]})).toThrow()})
 it('separates interviews and commentary from plays', () => {
  expect(classifyXPost('Cam Ward postgame interview')).toBe('interview')
  expect(classifyXPost('Tom Brady impressed by @brockpurdy13')).toBe('commentary')
  expect(classifyXPost('Cam Little kicks a game winner')).toBe('play')
 })
})

